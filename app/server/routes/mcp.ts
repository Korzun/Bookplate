/**
 * The MCP (Model Context Protocol) endpoint: lets an AI agent search, read and
 * edit one reader's library. Three routes, all under `/mcp`:
 *
 *  - `POST /mcp` — the MCP Streamable HTTP endpoint. Authenticated per request
 *    with an OAuth access token a reader approved (`routes/mcp-oauth.ts`; see
 *    `mcpBearerAuth` below). The tools live in `mcp/tools.ts`.
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
import { getBookById } from '../services/book-catalog';
import { oauthGrantIsLive, type OAuthGrantIdentity } from '../services/mcp-oauth';
import { asyncHandler } from '../utils/async-handler';
import { publicOrigin } from '../utils/public-origin';
import { protectedResourceMetadataUrl } from './mcp-oauth';
import { COVER_UPLOAD_MAX_BYTES, EPUB_UPLOAD_MAX_BYTES } from './ui';

const log = logger('MCP');

/** The web upload routes' own caps — see their doc comment in `routes/ui.ts`. */
const UPLOAD_LIMITS: UploadLimits = { epub: EPUB_UPLOAD_MAX_BYTES, cover: COVER_UPLOAD_MAX_BYTES };

const BAD_TICKET =
  'This URL is invalid, has expired, or its agent was disconnected. Ask for a new one.';

/**
 * OAuth bearer authentication for `POST /mcp` (MCP authorization spec, RFC
 * 6750). Accepts only an access token from a grant a reader approved
 * (`services/mcp-oauth.ts`) — never a web session token, the login password
 * or the sync password. Attaches `req.mcpIdentity` on success.
 *
 * Every 401 carries `resource_metadata` (RFC 9728 §5.1): that link is how an
 * agent with no token, or an expired one, discovers where to sign in. A
 * missing token gets a bare challenge; a bad one gets `invalid_token`, which is
 * what tells a client to refresh rather than start over.
 */
function mcpBearerAuth(
  verify: (token: string) => Promise<OAuthGrantIdentity | null>,
  publicUrl: string | null | undefined
) {
  return async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    try {
      const header = req.headers.authorization;
      const token = header?.startsWith('Bearer ') ? header.slice(7).trim() : null;
      const identity = token ? await verify(token) : null;
      if (identity === null) {
        const metadata = protectedResourceMetadataUrl(publicOrigin(req, publicUrl));
        const challenge =
          token === null
            ? `Bearer resource_metadata="${metadata}"`
            : `Bearer error="invalid_token", error_description="The access token is invalid or expired", resource_metadata="${metadata}"`;
        res.set('WWW-Authenticate', challenge);
        res.status(401).json({
          error: token === null ? 'unauthorized' : 'invalid_token',
          error_description:
            token === null ? 'Authorization required' : 'The access token is invalid or expired',
        });
        return;
      }
      req.mcpIdentity = identity;
      next();
    } catch (err) {
      next(err);
    }
  };
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

export type CreateMcpRouterDeps = {
  contextDeps: ContextDeps;
  /** Resolves an access token to its grant (`mcp/oauth-provider.ts`'s `verifyGrant`). */
  verifyAccessToken: (token: string) => Promise<OAuthGrantIdentity | null>;
};

export function createMcpRouter({ contextDeps, verifyAccessToken }: CreateMcpRouterDeps): Router {
  const { prisma, config, jwtSecret, replaceStaging } = contextDeps;
  const router = Router();

  router.post(
    '/',
    express.json({ limit: '1mb' }),
    mcpBearerAuth(verifyAccessToken, config.publicUrl),
    asyncHandler(async (req: Request, res: Response) => {
      const identity = req.mcpIdentity!;
      const session: McpSession = {
        // A grant acts as its reader with no credential-setup gates: the reader
        // cleared them to approve it (the consent API runs behind both), and
        // like the sync password it is its own credential from then on. Never
        // admin — the consent API refuses the config admin, and token
        // verification refuses a grant pointing at it.
        viewer: {
          userId: identity.userId,
          username: identity.username,
          isAdmin: false,
          mustChangePassword: false,
          mustSetEmail: false,
        },
        grantId: identity.grantId,
        baseUrl: publicOrigin(req, config.publicUrl),
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
      if (ticket === null || !(await oauthGrantIsLive(prisma, ticket))) {
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
      if (ticket === null || !(await oauthGrantIsLive(prisma, ticket))) {
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
