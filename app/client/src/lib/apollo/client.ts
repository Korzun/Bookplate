import { ApolloClient, ApolloLink, HttpLink, InMemoryCache } from '@apollo/client';
import { getMainDefinition } from '@apollo/client/utilities';

import { ensureFreshToken } from '~/lib/api-fetch';

import { cacheConfig } from './cache';
import { createAuthLink, createRefreshLink } from './links';
import { SSELink } from './sse-link';

const isSubscription = (operation: Parameters<ApolloLink['request']>[0]): boolean => {
  const definition = getMainDefinition(operation.query);
  return definition.kind === 'OperationDefinition' && definition.operation === 'subscription';
};

/**
 * `refreshLink` BEFORE `authLink` so a retry re-reads the freshly stored token.
 *
 * Subscriptions bypass both: SSELink carries its own auth via `ensureFreshToken`
 * (graphql-sse's headers callback may be async), and the one-shot HTTP retry
 * has no meaning for a long-lived stream.
 *
 * No `credentials` option: everything is same-origin (the Vite dev proxy already
 * forwards `/graphql`), and the refresh call is plain REST outside Apollo.
 */
export const createApolloClient = (): ApolloClient =>
  new ApolloClient({
    link: ApolloLink.split(
      isSubscription,
      new SSELink({ url: '/graphql', getToken: ensureFreshToken }),
      ApolloLink.from([createRefreshLink(), createAuthLink(), new HttpLink({ uri: '/graphql' })])
    ),
    cache: new InMemoryCache(cacheConfig),
  });
