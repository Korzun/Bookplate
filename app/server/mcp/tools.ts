/**
 * The Bookplate MCP server: one `McpServer` per request (the endpoint is
 * stateless — see `routes/mcp.ts`), acting as one reader on their own library.
 *
 * Tools that touch the library run GraphQL operations (`mcp/operations.ts`)
 * through `runOperation` — see `mcp/graphql.ts` for why. The two transfer tools
 * only mint signed URLs (`mcp/transfer-ticket.ts`); the bytes move through
 * `routes/mcp.ts`.
 */
import * as path from 'path';

import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import type { CallToolResult } from '@modelcontextprotocol/sdk/types.js';
import { decodeGlobalID } from '@pothos/plugin-relay';
import mime from 'mime-types';
import { z } from 'zod';

import type { ContextDeps, Viewer } from '../graphql/context';
import { decodeCompoundGlobalId } from '../graphql/schema/node-scope';
import { logger } from '../logger';
import { fixKey } from '../services/epub-import-pipeline';
import { APP_VERSION } from '../utils/app-version';
import { McpToolError, runOperation } from './graphql';
import * as ops from './operations';
import {
  signTransferTicket,
  TRANSFER_TICKET_TTL_SECONDS,
  type UploadKind,
} from './transfer-ticket';

const log = logger('MCP');

/** Who is calling and how to build URLs back to this server. */
export type McpSession = {
  /** Always a reader (never the config admin), with no pending credential gates. */
  readonly viewer: Viewer & { readonly userId: string };
  /** The `mcp_tokens` row the request authenticated with. */
  readonly tokenId: string;
  /** Absolute origin for transfer URLs, e.g. `https://books.example.com`. */
  readonly baseUrl: string;
};

/** Byte caps for `PUT /mcp/upload/:ticket` — the web upload's own (exclusive) caps. */
export type UploadLimits = { readonly epub: number; readonly cover: number };

const INSTRUCTIONS = `
Bookplate is a self-hosted EPUB library. These tools act on the signed-in reader's own library.

- Ids are opaque strings. Use them exactly as returned.
- A book's id is a hash of its file, so it CHANGES whenever the file changes: after update_book_metadata or replace_book, use the id in the tool result, not the old one.
- Moving files: get_book_download_url and create_upload_url return short-lived URLs. Transfer the bytes with a shell command (curl), never through tool arguments.
- Adding a book: create_upload_url (kind "epub"), PUT the file, then add_book with the stagedUploadId.
- Replacing a book's file: create_upload_url (kind "epub"), PUT the file, optionally analyze_book_replacement (read-only), then replace_book.
- Changing a cover: create_upload_url (kind "cover"), PUT the image, then update_book_metadata with coverStagedUploadId.
- A book that failed validation cannot have its metadata edited until it passes (validate_book, or replace its file).
`.trim();

// ── Results ─────────────────────────────────────────────────────────────────

const json = (value: unknown): CallToolResult['content'] => [
  { type: 'text', text: JSON.stringify(value, null, 2) },
];
const ok = (value: unknown): CallToolResult => ({ content: json(value) });
const failed = (value: unknown): CallToolResult => ({ isError: true, content: json(value) });

/**
 * A domain failure reported with structured detail — a typed GraphQL error
 * member, rendered by `formatUserError`.
 */
class McpDomainError extends McpToolError {
  constructor(readonly detail: Record<string, unknown>) {
    super(String(detail.error));
  }
}

/**
 * Every tool body runs inside this. Expected failures (`McpToolError`) become
 * `isError` results the agent can read and act on; anything else is a server
 * fault, logged in full and reported generically.
 */
const guard =
  <A>(handler: (args: A) => Promise<CallToolResult>) =>
  async (args: A): Promise<CallToolResult> => {
    try {
      return await handler(args);
    } catch (err: unknown) {
      if (err instanceof McpDomainError) return failed(err.detail);
      if (err instanceof McpToolError) return failed({ error: err.message });
      log.error(
        `MCP tool failed: ${err instanceof Error ? (err.stack ?? err.message) : String(err)}`
      );
      return failed({ error: 'The server failed to complete this request.' });
    }
  };

// ── Formatting ──────────────────────────────────────────────────────────────

const percent = (fraction: number | null | undefined): number | null =>
  fraction == null ? null : Math.round(fraction * 1000) / 10;

const formatBookSummary = (b: ops.BookSummary) => ({
  type: 'book' as const,
  id: b.id,
  title: b.title,
  author: b.author,
  ...(b.series ? { series: b.series.name, seriesId: b.series.id, seriesIndex: b.seriesIndex } : {}),
  publishDate: b.publishDate || null,
  pageCount: b.pageCount,
  readingProgressPercent: percent(b.progress?.percentage),
});

const formatSeriesSummary = (s: ops.SeriesSummary) => ({
  type: 'series' as const,
  id: s.id,
  name: s.name,
  author: s.author,
  bookCount: s.bookCount,
  readingProgressPercent: percent(s.progressPercentage),
});

const formatFix = (f: ops.MetadataFix) => ({
  key: fixKey(f),
  field: f.field,
  kind: f.kind,
  from: f.from,
  to: f.to,
  ...(f.reason ? { reason: f.reason } : {}),
});

const formatMessage = (m: ops.ValidationMessage) => ({
  severity: m.severity,
  code: m.code,
  message: m.message,
  ...(m.path ? { location: [m.path, m.line, m.column].filter((x) => x != null).join(':') } : {}),
});

const formatValidation = (v: ops.Validation) => ({
  valid: v.valid,
  validatedAt: v.validatedAt,
  threshold: v.threshold,
  counts: Object.fromEntries(v.counts.map((c) => [c.severity, c.count])),
  messages: v.messages.edges.map((e) => formatMessage(e.node)),
  moreMessages: v.messages.pageInfo.hasNextPage,
});

const formatBookDetail = (b: ops.BookDetail) => ({
  id: b.id,
  title: b.title,
  titleSort: b.titleSort,
  author: b.author,
  authorSort: b.authorSort,
  series: b.series ? { id: b.series.id, name: b.series.name, index: b.seriesIndex } : null,
  publisher: b.publisher,
  publishDate: b.publishDate,
  description: b.description,
  subjects: b.subjects,
  identifiers: b.identifiers,
  pageCount: b.pageCount,
  chapterCount: b.chapterCount,
  sizeBytes: b.size,
  hasCover: b.hasCover,
  addedAt: b.addedAt,
  modifiedAt: b.mtime,
  readingProgress: b.progress
    ? {
        percent: percent(b.progress.percentage),
        currentChapter: b.progress.currentChapter,
        device: b.progress.device,
        updatedAt: b.progress.timestamp,
      }
    : null,
  validation: b.validation ? formatValidation(b.validation) : null,
  pendingMetadataProposals: (b.pendingFix?.state.proposals ?? []).map(formatFix),
});

const formatBookRequest = (r: ops.BookRequest) => ({
  id: r.id,
  title: r.title,
  author: r.author,
  ...(r.note ? { note: r.note } : {}),
  status: r.status,
  ...(r.declineReason ? { declineReason: r.declineReason } : {}),
  createdAt: r.createdAt,
  resolvedAt: r.resolvedAt,
  book: r.book,
});

const formatUserError = (e: ops.UserError): Record<string, unknown> => ({
  error: e.message,
  errorType: e.__typename,
  ...(e.issues
    ? { issues: e.issues.map((i) => ({ field: i.path.join('.'), message: i.message })) }
    : {}),
  ...(e.messages ? { validationMessages: e.messages.map(formatMessage) } : {}),
  ...(e.collidingBook ? { existingBook: e.collidingBook } : {}),
  ...(e.limit !== undefined ? { limit: e.limit } : {}),
});

/**
 * Narrows a mutation's union result to its payload, or throws the typed error
 * member as an `McpDomainError`. `null` is the schema's "no such row" answer.
 */
function unwrap<P extends { __typename: string }>(
  result: ops.MutationResult<P> | null,
  payloadTypename: P['__typename'],
  notFound: string
): P {
  if (result === null) throw new McpToolError(notFound);
  if (result.__typename !== payloadTypename) {
    throw new McpDomainError(formatUserError(result as ops.UserError));
  }
  return result as P;
}

// ── Inputs ──────────────────────────────────────────────────────────────────

const BOOK_NOT_FOUND = 'No book with that id in your library. Ids change when a book is edited.';

const bookId = z.string().min(1).describe('A book id, as returned by another tool.');
const stagedUploadId = z
  .string()
  .min(1)
  .describe('The stagedUploadId returned when the file was PUT to a create_upload_url URL.');
const pageSize = (max: number, fallback: number) =>
  z.number().int().min(1).max(max).default(fallback).describe(`Page size (1-${max}).`);
const cursor = z
  .string()
  .optional()
  .describe("Pass the previous result's nextCursor to fetch the next page.");
const messageLimit = z
  .number()
  .int()
  .min(0)
  .max(100)
  .default(20)
  .describe('How many validation messages to include (0-100).');

/**
 * Rejects a non-book id up front. Relay decodes `t.globalID` inputs inside the
 * resolver, so a malformed id would otherwise surface as a server fault.
 */
function requireBookId(id: string): string {
  if (decodeCompoundGlobalId(id, 'Book') === null) {
    throw new McpToolError(`"${id}" is not a book id.`);
  }
  return id;
}

/** `Series` ids are plain (not compound) global ids, so only the type is checked. */
function requireGlobalIdOf(typename: string, id: string, what: string): void {
  let decoded: { typename: string };
  try {
    decoded = decodeGlobalID(id);
  } catch {
    throw new McpToolError(`"${id}" is not ${what}.`);
  }
  if (decoded.typename !== typename) throw new McpToolError(`"${id}" is not ${what}.`);
}

const nextCursor = (pageInfo: ops.PageInfo): string | null =>
  pageInfo.hasNextPage ? pageInfo.endCursor : null;

const STATUS_TO_ENUM = {
  'not-started': 'NOT_STARTED',
  'in-progress': 'IN_PROGRESS',
  completed: 'COMPLETED',
} as const;

const REQUEST_STATUS_TO_ENUM = {
  pending: 'PENDING',
  fulfilled: 'FULFILLED',
  declined: 'DECLINED',
} as const;

/** The same file-type rules the web upload routes apply, checked before minting a URL. */
function checkUploadName(kind: UploadKind, filename: string): void {
  if (kind === 'epub' && path.extname(filename).toLowerCase() !== '.epub') {
    throw new McpToolError('An EPUB upload\'s filename must end in ".epub".');
  }
  if (kind === 'cover') {
    const type = mime.lookup(filename);
    if (type === false || !type.startsWith('image/')) {
      throw new McpToolError(
        "A cover upload's filename must have an image extension (.jpg, .png, .webp, ...)."
      );
    }
  }
}

// ── Server ──────────────────────────────────────────────────────────────────

export function createBookplateMcpServer(
  deps: ContextDeps,
  session: McpSession,
  uploadLimits: UploadLimits
): McpServer {
  const server = new McpServer(
    { name: 'bookplate', title: deps.config.libraryName, version: APP_VERSION },
    { instructions: INSTRUCTIONS }
  );
  const run = <T>(document: ops.Operation, variables?: Record<string, unknown>) =>
    runOperation<T>(deps, session.viewer, document, variables);
  const expiresAt = () => new Date(Date.now() + TRANSFER_TICKET_TTL_SECONDS * 1000).toISOString();

  // ── Browse ──

  server.registerTool(
    'search_library',
    {
      title: 'Search library',
      description:
        'Searches and lists the library. With no filters, lists everything in display order. ' +
        'Entries are books or series (a series groups its books; use get_series to list them). ' +
        'Paginated: pass nextCursor back as cursor for more.',
      inputSchema: {
        query: z.string().optional().describe('Free-text search over titles, authors and series.'),
        author: z.string().optional().describe('Only entries by this author (exact name).'),
        series: z.string().optional().describe('Only books in this series (exact name).'),
        subjects: z.array(z.string()).optional().describe('Only entries with all these subjects.'),
        status: z.enum(['not-started', 'in-progress', 'completed']).optional(),
        entryType: z
          .enum(['series', 'standalone'])
          .optional()
          .describe('Only series, or only books that are not in a series.'),
        limit: pageSize(100, 20),
        cursor,
      },
      annotations: { readOnlyHint: true, openWorldHint: false },
    },
    guard(async (args) => {
      const filter = {
        ...(args.query ? { query: args.query } : {}),
        ...(args.author ? { author: args.author } : {}),
        ...(args.series ? { seriesName: args.series } : {}),
        ...(args.subjects?.length ? { subjects: args.subjects } : {}),
        ...(args.status ? { status: STATUS_TO_ENUM[args.status] } : {}),
        ...(args.entryType ? { entryType: args.entryType.toUpperCase() } : {}),
      };
      const data = await run<ops.SearchLibraryData>(ops.SEARCH_LIBRARY, {
        first: args.limit,
        after: args.cursor ?? null,
        filter,
      });
      const entries = data.viewer.library?.entries;
      if (!entries) throw new McpToolError('This account has no library.');
      return ok({
        entries: entries.edges.map(({ node }) =>
          node.__typename === 'Series' ? formatSeriesSummary(node) : formatBookSummary(node)
        ),
        nextCursor: nextCursor(entries.pageInfo),
      });
    })
  );

  server.registerTool(
    'get_book',
    {
      title: 'Get book',
      description:
        'Full metadata for one book: series, subjects, identifiers, reading progress, its last ' +
        'validation report, and any pending metadata-fix proposals.',
      inputSchema: { bookId, validationMessageLimit: messageLimit },
      annotations: { readOnlyHint: true, openWorldHint: false },
    },
    guard(async (args) => {
      const data = await run<ops.GetBookData>(ops.GET_BOOK, {
        id: requireBookId(args.bookId),
        messageLimit: args.validationMessageLimit,
      });
      if (data.node?.__typename !== 'Book') throw new McpToolError(BOOK_NOT_FOUND);
      return ok(formatBookDetail(data.node as ops.BookDetail));
    })
  );

  server.registerTool(
    'get_series',
    {
      title: 'Get series',
      description:
        'One series and its books in reading order. Give either seriesId or the exact series name.',
      inputSchema: {
        seriesId: z.string().optional().describe('A series id, as returned by another tool.'),
        name: z.string().optional().describe('The exact series name.'),
        limit: pageSize(100, 50),
        cursor,
      },
      annotations: { readOnlyHint: true, openWorldHint: false },
    },
    guard(async (args) => {
      if ((args.seriesId === undefined) === (args.name === undefined)) {
        throw new McpToolError('Give exactly one of seriesId or name.');
      }
      const page = { first: args.limit, after: args.cursor ?? null };
      let series: ops.SeriesDetail | null;
      if (args.seriesId !== undefined) {
        requireGlobalIdOf('Series', args.seriesId, 'a series id');
        const data = await run<ops.GetSeriesByIdData>(ops.GET_SERIES_BY_ID, {
          id: args.seriesId,
          ...page,
        });
        series = data.node?.__typename === 'Series' ? (data.node as ops.SeriesDetail) : null;
      } else {
        const data = await run<ops.GetSeriesByNameData>(ops.GET_SERIES_BY_NAME, {
          name: args.name,
          ...page,
        });
        series = data.viewer.library?.seriesByName ?? null;
      }
      if (series === null) throw new McpToolError('No such series in your library.');
      return ok({
        ...formatSeriesSummary(series),
        publisher: series.publisher,
        subjects: series.subjects,
        totalPages: series.totalPages,
        books: series.books.edges.map(({ node }) => formatBookSummary(node)),
        nextCursor: nextCursor(series.books.pageInfo),
      });
    })
  );

  // ── Edit ──

  server.registerTool(
    'update_book_metadata',
    {
      title: 'Edit book metadata',
      description:
        "Edits a book's metadata, writing it into the EPUB file itself. Only the fields you pass " +
        'change; pass an empty string to clear a text field. subjects and identifiers replace the ' +
        'whole list. The file is re-validated, and the book gets a NEW id, returned in the result. ' +
        'Fails if the book has not passed validation.',
      inputSchema: {
        bookId,
        title: z.string().optional(),
        titleSort: z.string().optional().describe('Sort form of the title, e.g. "Hobbit, The".'),
        author: z.string().optional(),
        authorSort: z
          .string()
          .optional()
          .describe('Sort form of the author, e.g. "Tolkien, J. R. R.".'),
        series: z
          .string()
          .optional()
          .describe('Series name; an empty string takes the book out of its series.'),
        seriesIndex: z.number().optional().describe('Position within the series, e.g. 1 or 2.5.'),
        publisher: z.string().optional(),
        publishDate: z.string().optional().describe('ISO 8601 date: YYYY, YYYY-MM or YYYY-MM-DD.'),
        description: z.string().optional(),
        subjects: z.array(z.string()).optional(),
        identifiers: z
          .array(z.object({ scheme: z.string(), value: z.string() }))
          .optional()
          .describe('For example [{"scheme": "ISBN", "value": "9780261103344"}].'),
        coverStagedUploadId: z
          .string()
          .optional()
          .describe('Set the cover from an image uploaded via create_upload_url (kind "cover").'),
        validationMessageLimit: messageLimit,
      },
      annotations: { readOnlyHint: false, destructiveHint: false, openWorldHint: false },
    },
    guard(async ({ bookId: id, coverStagedUploadId, validationMessageLimit, ...fields }) => {
      const data = await run<ops.UpdateBookMetadataData>(ops.UPDATE_BOOK_METADATA, {
        input: {
          id: requireBookId(id),
          ...fields,
          ...(coverStagedUploadId !== undefined ? { stagedCoverId: coverStagedUploadId } : {}),
        },
        messageLimit: validationMessageLimit,
      });
      const payload = unwrap(data.bookUpdateMetadata, 'BookUpdateMetadataPayload', BOOK_NOT_FOUND);
      return ok({ previousId: id, book: formatBookDetail(payload.book) });
    })
  );

  server.registerTool(
    'validate_book',
    {
      title: 'Validate book',
      description:
        'Re-runs the EPUB checker on a book and stores the report. A book that fails is still ' +
        'kept; it just cannot have its metadata edited until it passes.',
      inputSchema: { bookId, messageLimit },
      annotations: {
        readOnlyHint: false,
        destructiveHint: false,
        idempotentHint: true,
        openWorldHint: false,
      },
    },
    guard(async (args) => {
      const data = await run<ops.ValidateBookData>(ops.VALIDATE_BOOK, {
        input: { id: requireBookId(args.bookId) },
        messageLimit: args.messageLimit,
      });
      if (data.bookValidate === null) throw new McpToolError(BOOK_NOT_FOUND);
      return ok({
        book: data.bookValidate.book,
        validation: formatValidation(data.bookValidate.validation),
      });
    })
  );

  // ── Files ──

  server.registerTool(
    'get_book_download_url',
    {
      title: 'Get book download URL',
      description:
        "Returns a short-lived URL that downloads the book's EPUB file. Fetch it with a shell " +
        'command, e.g. curl --fail -OJ "<url>" (saves it under the book\'s file name).',
      inputSchema: { bookId },
      annotations: { readOnlyHint: true, openWorldHint: false },
    },
    guard(async (args) => {
      const id = requireBookId(args.bookId);
      // `node(id:)` is owner-scoped, so a ticket is only ever minted for a
      // book this viewer can already read.
      const data = await run<ops.BookFileInfoData>(ops.BOOK_FILE_INFO, { id });
      if (data.node?.__typename !== 'Book') throw new McpToolError(BOOK_NOT_FOUND);
      const book = data.node as ops.BookFileInfo;
      const [, rawBookId] = decodeCompoundGlobalId(id, 'Book')!;
      const ticket = signTransferTicket(deps.jwtSecret, {
        type: 'download',
        userId: session.viewer.userId,
        tokenId: session.tokenId,
        bookId: rawBookId,
      });
      const downloadUrl = `${session.baseUrl}/mcp/download/${ticket}`;
      return ok({
        bookId: book.id,
        title: book.title,
        sizeBytes: book.size,
        downloadUrl,
        expiresAt: expiresAt(),
        example: `curl --fail -OJ "${downloadUrl}"`,
      });
    })
  );

  server.registerTool(
    'create_upload_url',
    {
      title: 'Create upload URL',
      description:
        'Returns a short-lived URL to PUT a file to: the first step of adding a book, replacing ' +
        'a book\'s file, or changing a cover. Upload with e.g. curl --fail-with-body -T "<file>" "<url>". ' +
        'The response is JSON with a stagedUploadId for add_book, analyze_book_replacement or ' +
        'replace_book (kind "epub"), or update_book_metadata (kind "cover"). Staged uploads are ' +
        'kept for 30 minutes.',
      inputSchema: {
        kind: z.enum(['epub', 'cover']).describe('"epub" for a book file, "cover" for an image.'),
        filename: z
          .string()
          .min(1)
          .max(255)
          .describe(
            "The file's name, with extension. For an EPUB it is the title fallback and an input " +
              'to metadata detection, so prefer the real name.'
          ),
      },
      annotations: { readOnlyHint: true, openWorldHint: false },
    },
    guard(async (args) => {
      const filename = path.basename(args.filename);
      checkUploadName(args.kind, filename);
      const ticket = signTransferTicket(deps.jwtSecret, {
        type: 'upload',
        userId: session.viewer.userId,
        tokenId: session.tokenId,
        kind: args.kind,
        filename,
      });
      const uploadUrl = `${session.baseUrl}/mcp/upload/${ticket}`;
      return ok({
        uploadUrl,
        method: 'PUT',
        maxBytes: uploadLimits[args.kind] - 1,
        expiresAt: expiresAt(),
        example: `curl --fail-with-body -T "<path to ${filename}>" "${uploadUrl}"`,
        next:
          args.kind === 'epub'
            ? 'Pass the stagedUploadId from the response to add_book, or to analyze_book_replacement / replace_book.'
            : 'Pass the stagedUploadId from the response to update_book_metadata as coverStagedUploadId.',
      });
    })
  );

  server.registerTool(
    'add_book',
    {
      title: 'Add book',
      description:
        'Adds an uploaded EPUB (see create_upload_url) to the library. It is validated, and is ' +
        'refused if it fails or if the same file is already in the library. High-confidence ' +
        'metadata fixes are applied automatically; others are returned as proposals.',
      inputSchema: { stagedUploadId, validationMessageLimit: messageLimit },
      annotations: { readOnlyHint: false, destructiveHint: false, openWorldHint: false },
    },
    guard(async (args) => {
      const data = await run<ops.AddBookData>(ops.ADD_BOOK, {
        input: { stagedUploadId: args.stagedUploadId },
        messageLimit: args.validationMessageLimit,
      });
      const payload = unwrap(data.bookAdd, 'BookAddPayload', 'Upload not found.');
      return ok({
        book: formatBookDetail(payload.book),
        autoAppliedFixes: payload.autoFixes.map(formatFix),
        proposals: payload.proposals.map(formatFix),
      });
    })
  );

  server.registerTool(
    'analyze_book_replacement',
    {
      title: 'Analyze book replacement',
      description:
        "Read-only preview of replacing a book's file with an uploaded EPUB: whether it passes " +
        'validation, which metadata fixes would be applied automatically, and which are ' +
        'proposals you may accept (by key) in replace_book. Does not use up the upload.',
      inputSchema: { bookId, stagedUploadId },
      annotations: { readOnlyHint: true, openWorldHint: false },
    },
    guard(async (args) => {
      const data = await run<ops.AnalyzeReplacementData>(ops.ANALYZE_REPLACEMENT, {
        input: { id: requireBookId(args.bookId), stagedUploadId: args.stagedUploadId },
      });
      const payload = unwrap(data.bookAnalyzeReplace, 'BookAnalyzeReplacePayload', BOOK_NOT_FOUND);
      return ok({
        valid: payload.valid,
        validationMessages: payload.messages.map(formatMessage),
        autoFixes: payload.autoFixes.map(formatFix),
        proposals: payload.proposals.map(formatFix),
      });
    })
  );

  server.registerTool(
    'replace_book',
    {
      title: 'Replace book file',
      description:
        "Replaces a book's EPUB file with an uploaded one, keeping its reading-progress " +
        'history. The new file must pass validation. Its metadata comes from the NEW file, so ' +
        'series or other edits the new file lacks are dropped; re-apply them with ' +
        'update_book_metadata. Automatic fixes are applied, plus any proposals named in ' +
        'acceptedFixKeys. The book gets a NEW id, returned in the result.',
      inputSchema: {
        bookId,
        stagedUploadId,
        acceptedFixKeys: z
          .array(z.string())
          .default([])
          .describe('Keys of proposals (from analyze_book_replacement) to apply as well.'),
        validationMessageLimit: messageLimit,
      },
      annotations: { readOnlyHint: false, destructiveHint: true, openWorldHint: false },
    },
    guard(async (args) => {
      const data = await run<ops.ReplaceBookData>(ops.REPLACE_BOOK, {
        input: {
          id: requireBookId(args.bookId),
          stagedUploadId: args.stagedUploadId,
          acceptedFixKeys: args.acceptedFixKeys,
        },
        messageLimit: args.validationMessageLimit,
      });
      const payload = unwrap(data.bookReplace, 'BookReplacePayload', BOOK_NOT_FOUND);
      return ok({ previousId: args.bookId, book: formatBookDetail(payload.book) });
    })
  );

  // ── Requests ──

  server.registerTool(
    'request_book',
    {
      title: 'Request book',
      description:
        'Asks the library admin to add a book that is not in the library yet. Check ' +
        'search_library first. Each reader may only have a limited number of open requests.',
      inputSchema: {
        title: z.string().min(1).max(500),
        author: z.string().min(1).max(500),
        note: z
          .string()
          .max(2000)
          .optional()
          .describe('Anything that helps, e.g. the edition wanted.'),
      },
      annotations: { readOnlyHint: false, destructiveHint: false, openWorldHint: false },
    },
    guard(async (args) => {
      const data = await run<ops.RequestBookData>(ops.REQUEST_BOOK, {
        input: { title: args.title, author: args.author, note: args.note ?? null },
      });
      const payload = unwrap(data.bookRequestCreate, 'BookRequestCreatePayload', 'Request failed.');
      return ok(formatBookRequest(payload.bookRequest));
    })
  );

  server.registerTool(
    'list_book_requests',
    {
      title: 'List book requests',
      description: "The reader's own book requests, newest first, with their status.",
      inputSchema: {
        status: z.enum(['pending', 'fulfilled', 'declined']).optional(),
        limit: pageSize(100, 20),
        cursor,
      },
      annotations: { readOnlyHint: true, openWorldHint: false },
    },
    guard(async (args) => {
      const data = await run<ops.ListBookRequestsData>(ops.LIST_BOOK_REQUESTS, {
        first: args.limit,
        after: args.cursor ?? null,
        status: args.status ? REQUEST_STATUS_TO_ENUM[args.status] : null,
      });
      const user = data.viewer.user;
      if (user === null) throw new McpToolError('This account has no library.');
      return ok({
        pendingCount: user.pendingBookRequestCount,
        requests: user.bookRequests.edges.map(({ node }) => formatBookRequest(node)),
        nextCursor: nextCursor(user.bookRequests.pageInfo),
      });
    })
  );

  return server;
}
