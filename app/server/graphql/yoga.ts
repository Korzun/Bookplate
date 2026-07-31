import type { RequestHandler } from 'express';
import { GraphQLError, NoSchemaIntrospectionCustomRule } from 'graphql';
import { createYoga, type Plugin } from 'graphql-yoga';

import { logger } from '../logger';
import { createContext, type ContextDeps } from './context';
import { schema } from './schema';

const log = logger('GraphQL');

export type GraphqlHandlerDeps = ContextDeps & { isProduction: boolean };

/**
 * Formats one yoga log argument. Mirrors server.ts's Express error handler:
 * with masked errors on this bridge is the only channel by which a real
 * failure reaches an operator, and `String(err)` would drop the stack.
 */
const formatLogArg = (arg: unknown): string =>
  arg instanceof Error ? (arg.stack ?? arg.message) : String(arg);

const formatLogArgs = (args: unknown[]): string => args.map(formatLogArg).join(' ');

/** graphql-js appends `Did you mean "…"?` to unknown field/type/argument errors. */
const SUGGESTION_PATTERN = /\s*Did you mean[\s\S]*$/;

const stripSuggestion = (error: unknown): unknown => {
  if (!(error instanceof GraphQLError) || !SUGGESTION_PATTERN.test(error.message)) return error;
  return new GraphQLError(error.message.replace(SUGGESTION_PATTERN, ''), {
    nodes: error.nodes,
    source: error.source,
    positions: error.positions,
    path: error.path,
    originalError: error.originalError,
    extensions: error.extensions,
  });
};

/**
 * Closes the two ways an unauthenticated caller could still read the schema.
 * Pothos's field wrapping cannot gate graphql-js meta-fields, so
 * `{ __schema { … } }` answers in full despite every field carrying the
 * `authenticated` scope; and a misspelled field name leaks real field names
 * back through validation's "Did you mean" suggestions. Installed only when
 * `isProduction` — dev keeps both so GraphiQL works.
 */
const useSchemaConcealment = (): Plugin => ({
  onValidate: ({ addValidationRule }) => {
    addValidationRule(NoSchemaIntrospectionCustomRule);
    return ({ result, setResult }) => {
      const errors: readonly unknown[] = result;
      const stripped = errors.map(stripSuggestion);
      if (stripped.some((error, index) => error !== errors[index])) setResult(stripped);
    };
  },
});

/**
 * Builds the yoga handler. Returned as an Express-compatible request handler
 * so server.ts can mount it without knowing anything about yoga or Prisma.
 *
 * The cast bridges yoga's Node request/response types to Express's. It is
 * structural only — yoga's instance is callable as (req, res) — but the two
 * declarations do not line up nominally. Drop the cast if it typechecks
 * without it on the installed version; do NOT reach for `any`, which is a
 * lint error in this workspace.
 */
export const createGraphqlHandler = ({
  isProduction,
  ...deps
}: GraphqlHandlerDeps): RequestHandler =>
  createYoga({
    schema,
    context: createContext(deps),
    graphqlEndpoint: '/graphql',
    graphiql: !isProduction,
    maskedErrors: isProduction,
    landingPage: false,
    plugins: isProduction ? [useSchemaConcealment()] : [],
    logging: {
      debug: (...args: unknown[]) => log.debug(formatLogArgs(args)),
      info: (...args: unknown[]) => log.info(formatLogArgs(args)),
      warn: (...args: unknown[]) => log.warn(formatLogArgs(args)),
      error: (...args: unknown[]) => log.error(formatLogArgs(args)),
    },
  }) as unknown as RequestHandler;
