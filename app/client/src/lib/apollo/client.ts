import { ApolloClient, HttpLink, InMemoryCache, ApolloLink } from '@apollo/client';

import { cacheConfig } from './cache';
import { createAuthLink, createRefreshLink } from './links';

/**
 * `refreshLink` BEFORE `authLink` so a retry re-reads the freshly stored token.
 *
 * No `credentials` option: everything is same-origin (the Vite dev proxy
 * already forwards `/graphql`), and the refresh call is plain REST outside
 * Apollo, riding the existing httpOnly cookie.
 */
export const createApolloClient = (): ApolloClient =>
  new ApolloClient({
    link: ApolloLink.from([
      createRefreshLink(),
      createAuthLink(),
      new HttpLink({ uri: '/graphql' }),
    ]),
    cache: new InMemoryCache(cacheConfig),
  });
