import { ApolloProvider } from '@apollo/client/react';
import type { ReactNode } from 'react';

import { createApolloClient } from './client';
import { useResetApolloStoreOnIdentityChange } from './identity-reset';

// Created once at module scope: a client rebuilt on every render would discard
// the normalized cache each time.
const client = createApolloClient();

/**
 * The app's Apollo root, shaped as a `{ children }`-only component so it can be
 * registered in `buildProvidersTree` alongside every other provider —
 * `ApolloProvider` itself takes a required `client` prop, which the tree has no
 * way to supply.
 *
 * Deliberately owns the store's identity lifecycle as well as the client, so
 * the two cannot be wired up in separate places and drift apart: a client
 * mounted without `useResetApolloStoreOnIdentityChange` serves the previous
 * user's cached data after a purely client-side identity change. See that
 * hook's own doc comment for the full reasoning.
 *
 * Register it FIRST in the providers tree — `buildProvidersTree` renders the
 * first entry outermost, and later migrations will move providers onto Apollo
 * hooks, which requires this to sit above them.
 */
export const ApolloRoot = ({ children }: { children: ReactNode }) => {
  useResetApolloStoreOnIdentityChange(client);

  return <ApolloProvider client={client}>{children}</ApolloProvider>;
};
