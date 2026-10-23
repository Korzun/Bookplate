/**
 * The MCP (Model Context Protocol) endpoint: lets an AI agent search, read and
 * edit one reader's library. Three routes, all under `/mcp`:
 *
 *  - `POST /mcp` — the MCP Streamable HTTP endpoint. Authenticated per request
 *    with a reader's agent token (`middleware/auth.ts`'s `mcpAuth`). The tools
 *    live in `mcp/tools.ts`.
 *  - `PUT /mcp/upload/:ticket` and `GET /mcp/download/:ticket` — where an agent
 *    moves file bytes, using the short-lived URLs two of those tools hand out.
 *    The ticket in the path is the credential; see `mcp/transfer-ticket.ts` for
 *    why these exist and why they authorize themselves.
 *
 * STATELESS: no MCP session is kept between requests. Each POST builds a fresh
 * `McpServer` + transport for the authenticated reader and answers with plain
 * JSON (`enableJsonResponse`) rather than an SSE stream. No tool here streams or
 * calls back into the client, so sessions would buy nothing but state to keep
 * — and a long-lived SSE stream would sit badly behind `requestTimeout` and the
 * Cloudflare proxies this add-on is often reached through. `GET`/`DELETE /mcp`
 * (stream resume / session teardown) are therefore 405s, which the spec allows.
 *
 * Mounted ahead of `express.json()` in `server.ts`, like `/graphql`: the upload
 * route needs the raw body, so each route below brings its own body parser.
 */
import * as fs from 'fs';

import { StreamableHTTPServerTransport } from '@modelcontextprotocol/sdk/server/streamableHttp.js';
import express, { Router, type NextFunction, type Request, type Response } from 'express';
import mime from 'mime-types';

import type { ContextDeps } from '../graphql/context';
import { logger } from '../logger';
import { createBookplateMcpServer, type McpSession, type UploadLimits } from '../mcp/tools';
import { verifyTransferTicket } from '../mcp/transfer-ticket';
import { mcpAuth } from '../middleware/auth';
import { getBookById } from '../services/book-catalog';
import { mcpTokenIsLive } from '../services/mcp-token';
import { asyncHandler } from '../utils/async-handler';
import { COVER_UPLOAD_MAX_BYTES, EPUB_UPLOAD_MAX_BYTES } from './ui';

const log = logger('MCP');

/** The web upload routes' own caps — see their doc comment in `routes/ui.ts`. */
const UPLOAD_LIMITS: UploadLimits = { epub: EPUB_UPLOAD_MAX_BYTES, cover: COVER_UPLOAD_MAX_BYTES };

const BAD_TICKET =
  'This URL is invalid, has expired, or its agent token was revoked. Ask for a new one.';

/**
 * The origin transfer URLs are built on: `config.publicUrl` when the operator
 * set one, otherwise the origin this very request arrived at.
 *
 * Deriving from `Host`/`X-Forwarded-Proto` is exactly what `AppConfig.publicUrl`'s
 * doc comment warns against for EMAIL links, and the reason does not apply
 * here: a poisoned email link reaches a victim, whereas these URLs go back only
 * in the response to the request that carried the header. A client that lies
 * about its own Host only misdirects itself. `X-Forwarded-Proto` is honoured so
 * an instance behind an HTTPS proxy or Cloudflare Tunnel hands out `https`
 * URLs without having to set `public_url`.
 */
export function transferBaseUrl(req: Request, publicUrl: string | null | undefined): string {
  if (publicUrl) return publicUrl;
  const forwarded = req.headers['x-forwarded-proto'];
  const first = (Array.isArray(forwarded) ? forwarded[0] : forwarded)?.split(',')[0]?.trim();
  const proto = first === 'https' || first === 'http' ? first : req.protocol;
  return `${proto}://${req.get('host') ?? 'localhost'}`;
}

/** JSON-RPC error body for a non-POST verb on the MCP endpoint. */
const methodNotAllowed = (_req: Request, res: Response): void => {
  res
    .status(405)
    .set('Allow', 'POST')
    .json({
      jsonrpc: '2.0',
      error: { code: -32000, message: 'Method not allowed. This MCP server is stateless.' },
      id: null,
    });
};

/**
 * Raw-body parser for uploads that answers an oversized body with a clean 413,
 * the MCP counterpart of `routes/ui.ts`'s `withUploadLimit`. `limit` is set one
 * byte under the cap because raw-body's limit is inclusive while multer's (and
 * so the web upload's) is exclusive — the two then admit exactly the same sizes.
 */
function rawUpload(limit: number) {
  const parse = express.raw({ type: () => true, limit: limit - 1 });
  return (req: Request, res: Response, next: NextFunction): void => {
    parse(req, res, (err: unknown) => {
      if (err && (err as { type?: string }).type === 'entity.too.large') {
        res.status(413).json({ error: 'File too large' });
        return;
      }
      next(err);
    });
  };
}

export function createMcpRouter(contextDeps: ContextDeps): Router {
  const { prisma, config, jwtSecret, replaceStaging } = contextDeps;
  const router = Router();

  router.post(
    '/',
    express.json({ limit: '1mb' }),
    mcpAuth(prisma),
    asyncHandler(async (req: Request, res: Response) => {
      const identity = req.mcpIdentity!;
      const session: McpSession = {
        // An agent token acts as its reader with no credential-setup gates:
        // like the sync password, it is its own credential, independent of a
        // pending login-password change or email setup. Never admin — tokens
        // are only issued to readers (`viewerCreateMcpToken`).
        viewer: {
          userId: identity.userId,
          username: identity.username,
          isAdmin: false,
          mustChangePassword: false,
          mustSetEmail: false,
        },
        tokenId: identity.tokenId,
        baseUrl: transferBaseUrl(req, config.publicUrl),
      };
      const server = createBookplateMcpServer(contextDeps, session, UPLOAD_LIMITS);
      const transport = new StreamableHTTPServerTransport({
        sessionIdGenerator: undefined,
        enableJsonResponse: true,
      });
      res.on('close', () => {
        void transport.close();
        void server.close();
      });
      await server.connect(transport);
      await transport.handleRequest(req, res, req.body);
    })
  );
  router.get('/', methodNotAllowed);
  router.delete('/', methodNotAllowed);

  router.put(
    '/upload/:ticket',
    rawUpload(UPLOAD_LIMITS.epub),
    asyncHandler(async (req: Request, res: Response) => {
      const ticket = verifyTransferTicket(jwtSecret, req.params.ticket, 'upload');
      if (ticket === null || !(await mcpTokenIsLive(prisma, ticket))) {
        res.status(403).json({ error: BAD_TICKET });
        return;
      }
      const bytes = Buffer.isBuffer(req.body) ? req.body : Buffer.alloc(0);
      if (bytes.length === 0) {
        res.status(400).json({ error: 'Empty upload. Send the file as the request body.' });
        return;
      }
      if (bytes.length >= UPLOAD_LIMITS[ticket.kind]) {
        res.status(413).json({ error: 'File too large' });
        return;
      }
      // Covers carry the MIME type their name implies; the upload tool only
      // mints a cover ticket for a name that maps to `image/*`.
      const mimeType = ticket.kind === 'cover' ? mime.lookup(ticket.filename) || null : null;
      // A reader's staging identity is their own userId (`stagingIdentityOf`),
      // which is what `bookAdd`/`bookReplace`/`bookUpdateMetadata` resolve with.
      const stagedUploadId = replaceStaging.stage(
        bytes,
        ticket.userId,
        ticket.filename,
        ticket.kind,
        mimeType
      );
      log.info(`Agent staged ${ticket.kind} "${ticket.filename}" (${bytes.length} bytes)`);
      res.json({
        stagedUploadId,
        kind: ticket.kind,
        filename: ticket.filename,
        sizeBytes: bytes.length,
      });
    })
  );

  router.get(
    '/download/:ticket',
    asyncHandler(async (req: Request, res: Response) => {
      const ticket = verifyTransferTicket(jwtSecret, req.params.ticket, 'download');
      if (ticket === null || !(await mcpTokenIsLive(prisma, ticket))) {
        res.status(403).json({ error: BAD_TICKET });
        return;
      }
      const user = await prisma.user.findUnique({
        where: { id: ticket.userId },
        select: { id: true, username: true },
      });
      const book =
        user === null
          ? null
          : await getBookById(
              prisma,
              config.booksDir,
              { userId: user.id, username: user.username },
              ticket.bookId
            );
      if (book === null || !fs.existsSync(book.path)) {
        // The book was deleted, or edited (which changes its id) since the URL
        // was handed out.
        res
          .status(404)
          .json({ error: 'Book not found. It may have changed since this URL was made.' });
        return;
      }
      log.info(`Agent for "${user!.username}" downloaded "${book.filename}"`);
      // `attachment()` rather than the web route's hand-built `filename*=`-only
      // header: it also emits a plain `filename=` fallback, which is the only
      // form `curl -J` (the tool's suggested command) reads.
      res.attachment(book.filename);
      res.set('Content-Type', 'application/epub+zip');
      res.sendFile(book.path);
    })
  );

  return router;
}
