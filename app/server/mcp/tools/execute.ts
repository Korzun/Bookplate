/**
 * The seam between MCP tools and the GraphQL schema. A tool is a fixed
 * document plus a formatter; this module runs the document in-process with
 * the request's `Context`, so every field resolves under the same scope-auth
 * and owner-scoped loaders the SPA gets. Yoga's cost/depth plugins do not run
 * here — the documents are ours, not a caller's.
 *
 * Errors a tool wants the assistant to read (`ToolError`) become an
 * `isError` result with the message as its text; anything else propagates to
 * the transport as a JSON-RPC error, the same way yoga would mask it.
 */
import type { CallToolResult } from '@modelcontextprotocol/sdk/types.js';
import { graphql, GraphQLError } from 'graphql';

import type { Context } from '../../graphql/context';
import { schema } from '../../graphql/schema';
import { decodeCompoundGlobalId } from '../../graphql/schema/node-scope';
import { logger } from '../../logger';
import type { McpScope } from '../tokens';
import { SETUP_REQUIRED_MESSAGE } from '../viewer';
import type { ToolDeps } from './deps';

export class ToolError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'ToolError';
  }
}

const log = logger('MCP');

export const NOT_FOUND_BOOK = 'No book with that id in your library';
export const READ_ONLY_MESSAGE = 'This connection is read only';
/**
 * What an assistant sees for any failure that is not one of ours. The SDK
 * forwards a thrown error's message verbatim as an `isError` result and the
 * in-process `graphql()` call applies none of yoga's masking, so without this
 * a Prisma or filesystem failure would hand the assistant SQL fragments and
 * absolute paths. The real message goes to the log.
 */
export const INTERNAL_ERROR_MESSAGE =
  'Something went wrong on the server; the error has been logged.';

const describe = (err: unknown): string =>
  err instanceof Error ? (err.stack ?? err.message) : String(err);

export async function executeDocument<T>(
  context: Context,
  source: string,
  variables?: Record<string, unknown>
): Promise<T> {
  const result = await graphql({
    schema,
    source,
    contextValue: context,
    variableValues: variables,
  });
  if (result.errors !== undefined && result.errors.length > 0) {
    const error = result.errors[0];
    // Errors the schema MEANT to send — parse/validation errors (no
    // `originalError`) and `GraphQLError`s a resolver or the auth plugin
    // threw on purpose — are the assistant's to read. Anything else is an
    // unexpected failure wearing a GraphQL envelope.
    const intended =
      error.originalError === undefined || error.originalError instanceof GraphQLError;
    if (intended) throw new ToolError(error.message);
    log.error(`Tool document failed: ${describe(error.originalError)}`);
    throw new ToolError(INTERNAL_ERROR_MESSAGE);
  }
  // Scalars such as DateTime serialize to strings on the way out; a JSON
  // round-trip gives tools the same values a network client would see.
  return JSON.parse(JSON.stringify(result.data)) as T;
}

export const ok = (text: string, structured: Record<string, unknown>): CallToolResult => ({
  content: [{ type: 'text', text }],
  structuredContent: structured,
});

export const fail = (message: string): CallToolResult => ({
  content: [{ type: 'text', text: message }],
  isError: true,
});

export const requireScope = (deps: ToolDeps, scope: McpScope): void => {
  if (!deps.scopes.includes(scope)) throw new ToolError(READ_ONLY_MESSAGE);
};

/**
 * A `Book` global id → its raw id, only when the id names a book in THIS
 * viewer's library. Another reader's id, a `Series` id, or any string that is
 * not a global id all collapse to null, which every tool renders as
 * `NOT_FOUND_BOOK` — same "indistinguishable from nonexistent" rule
 * `node-scope.ts` applies.
 */
export const decodeBookId = (deps: ToolDeps, id: string): string | null => {
  const parsed = decodeCompoundGlobalId(id, 'Book');
  if (parsed === null || parsed[0] !== deps.viewer.userId) return null;
  return parsed[1];
};

/** Wraps a tool body with the setup gate, the write-scope check and `ToolError` rendering. */
export async function guarded(
  deps: ToolDeps,
  options: { write?: boolean },
  run: () => Promise<CallToolResult>
): Promise<CallToolResult> {
  if (!deps.setupComplete) return fail(SETUP_REQUIRED_MESSAGE);
  try {
    if (options.write === true) requireScope(deps, 'library:write');
    return await run();
  } catch (err) {
    if (err instanceof ToolError) return fail(err.message);
    log.error(`Tool failed: ${describe(err)}`);
    return fail(INTERNAL_ERROR_MESSAGE);
  }
}
