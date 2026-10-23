/**
 * Runs a GraphQL operation in-process, as the MCP caller.
 *
 * EVERY MCP TOOL THAT READS OR CHANGES THE LIBRARY GOES THROUGH HERE, so the
 * GraphQL schema stays the single place that decides what a reader may see and
 * do: ownership (`ownerOf`), input validation, staged-upload identity, side
 * effects (thumbnails, notifications) and typed errors are all the resolvers'
 * — the MCP layer only chooses operations and reshapes their results. A tool
 * that called services directly would be a second, unreviewed copy of those
 * rules.
 *
 * In-process `execute`, not an HTTP round trip to `/graphql`: same schema and
 * resolvers, no JWT to mint. The yoga plugins (depth/cost limits, schema
 * concealment) do not run, which is safe because the documents are fixed
 * strings in `mcp/operations.ts` — an agent supplies variables, never a query.
 */
import {
  execute,
  GraphQLError,
  parse,
  validate,
  type DocumentNode,
  type ExecutionResult,
} from 'graphql';

import { buildContext, type ContextDeps, type Viewer } from '../graphql/context';
import { schema } from '../graphql/schema';
import { logger } from '../logger';

const log = logger('MCP');

/**
 * A failure whose message is safe and useful to show the agent. Tool handlers
 * turn it into an `isError` result; anything else is logged and reported
 * generically (`mcp/tools.ts`'s `guard`).
 */
export class McpToolError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'McpToolError';
  }
}

/**
 * Parses and validates a document once, at module load. A typo in an operation
 * fails the server at startup (and `mcp/operations.test.ts`) instead of on the
 * first tool call that uses it.
 */
export function operation(source: string): DocumentNode {
  const document = parse(source);
  const errors = validate(schema, document);
  if (errors.length > 0) {
    throw new Error(`Invalid MCP operation: ${errors.map((e) => e.message).join('; ')}`);
  }
  return document;
}

/**
 * Errors without a `path` were raised before execution — variable coercion,
 * e.g. a malformed global id — and describe the agent's own input, so their
 * message is shown. Errors with a path came from a resolver: an auth refusal
 * is reported as not-found (the same indistinguishability `node-scope.ts`
 * keeps), and anything else is a server fault whose message may carry
 * internals, so it is logged and replaced.
 */
function toToolError(errors: readonly GraphQLError[]): McpToolError {
  const first = errors[0];
  if (first.path === undefined) return new McpToolError(first.message);
  const code = first.extensions?.code;
  if (code === 'FORBIDDEN' || code === 'UNAUTHENTICATED') {
    return new McpToolError('Not found, or not accessible with this token.');
  }
  for (const error of errors) {
    const cause = error.originalError ?? error;
    log.error(`MCP operation failed: ${cause.stack ?? cause.message}`);
  }
  return new McpToolError('The server failed to complete this request.');
}

export async function runOperation<TData>(
  deps: ContextDeps,
  viewer: Viewer,
  document: DocumentNode,
  variables: Record<string, unknown> = {}
): Promise<TData> {
  const result = (await execute({
    schema,
    document,
    variableValues: variables,
    contextValue: buildContext(deps, viewer),
  })) as ExecutionResult;
  if (result.errors !== undefined && result.errors.length > 0) throw toToolError(result.errors);
  return result.data as TData;
}
