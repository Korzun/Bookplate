import type { RequestHandler } from 'express';
import { createYoga } from 'graphql-yoga';

import { logger } from '../logger';
import { createContext, type ContextDeps } from './context';
import { schema } from './schema';

const log = logger('GraphQL');

export type GraphqlHandlerDeps = ContextDeps & { isProduction: boolean };

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
    logging: {
      debug: (...args) => log.debug(args.map(String).join(' ')),
      info: (...args) => log.info(args.map(String).join(' ')),
      warn: (...args) => log.warn(args.map(String).join(' ')),
      error: (...args) => log.error(args.map(String).join(' ')),
    },
  }) as unknown as RequestHandler;
