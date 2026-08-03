import type { RequestHandler } from 'express';
import { createYoga } from 'graphql-yoga';

import { logger } from '../logger';
import { createContext, type ContextDeps } from './context';
import { schema } from './schema';
import {
  useCostLimit,
  useDepthLimit,
  useOperationLogging,
  useSchemaConcealment,
} from './yoga-plugins';

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

/**
 * Builds the yoga handler. Returned as an Express-compatible request handler
 * so server.ts can mount it without knowing anything about yoga or Prisma.
 *
 * The cast bridges yoga's Node request/response types to Express's. It is
 * structural only — yoga's instance is callable as (req, res) — but the two
 * declarations do not line up nominally. Drop the cast if it typechecks
 * without it on the installed version; do NOT reach for `any`, which is a
 * lint error in this workspace.
 *
 * Plugin implementations (schema concealment, depth limiting, cost
 * limiting, per-operation logging) live in `yoga-plugins.ts` — this file's
 * own size otherwise grows past the point a single-glance read stays
 * useful.
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
    // The SPA is same-origin only (vite's dev proxy and the production build
    // both serve `/graphql` from the same host the page loaded from — see
    // vite.config.ts's `/graphql` proxy entry). Yoga's default CORS plugin
    // reflects whatever `Origin` a request sends back in
    // `Access-Control-Allow-Origin` (plus `Access-Control-Allow-Credentials:
    // true`) — fine for a public API, wrong for one gated entirely by a
    // bearer token this schema trusts. `false` turns the plugin off
    // entirely, so a foreign Origin gets no CORS headers at all and the
    // browser's own same-origin policy is what protects the endpoint.
    cors: false,
    plugins: [
      useDepthLimit(),
      useCostLimit(),
      useOperationLogging(deps.jwtSecret),
      ...(isProduction ? [useSchemaConcealment()] : []),
    ],
    logging: {
      debug: (...args: unknown[]) => log.debug(formatLogArgs(args)),
      info: (...args: unknown[]) => log.info(formatLogArgs(args)),
      warn: (...args: unknown[]) => log.warn(formatLogArgs(args)),
      error: (...args: unknown[]) => log.error(formatLogArgs(args)),
    },
  }) as unknown as RequestHandler;
