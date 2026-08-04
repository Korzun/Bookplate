import { ApolloClient, ApolloLink, InMemoryCache, Observable, gql } from '@apollo/client';
import { CombinedGraphQLErrors } from '@apollo/client/errors';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { setToken } from '~/lib/token';

import { cacheConfig } from './cache';
import { createAuthLink, createRefreshLink } from './links';

vi.mock('~/lib/api-fetch', () => ({
  refreshAccessToken: vi.fn(async () => {
    // A real refresh stores a new token; the retry must pick THIS one up.
    const { setToken: set } = await import('~/lib/token');
    set('refreshed-token');
    return true;
  }),
  ensureFreshToken: vi.fn(async () => 'refreshed-token'),
}));

const QUERY = gql`
  query V {
    viewer {
      username
    }
  }
`;

const unauthenticated = () =>
  new CombinedGraphQLErrors({
    errors: [{ message: 'Not authenticated', extensions: { code: 'UNAUTHENTICATED' } }],
  });

/** Terminating link that 401s the first N attempts, then succeeds. */
const flakyLink = (failures: number) => {
  const seenAuthHeaders: (string | undefined)[] = [];
  let attempts = 0;
  const link = new ApolloLink(
    (operation) =>
      new Observable((sink) => {
        attempts += 1;
        const headers = operation.getContext()['headers'] as Record<string, string> | undefined;
        seenAuthHeaders.push(headers?.['authorization']);
        if (attempts <= failures) {
          sink.error(unauthenticated());
          return;
        }
        sink.next({ data: { viewer: { __typename: 'Viewer', username: 'alice' } } });
        sink.complete();
      })
  );
  return { link, seenAuthHeaders, attemptCount: () => attempts };
};

const clientWith = (terminating: ApolloLink) =>
  new ApolloClient({
    link: ApolloLink.from([createRefreshLink(), createAuthLink(), terminating]),
    cache: new InMemoryCache(cacheConfig),
  });

afterEach(() => {
  localStorage.clear();
  vi.clearAllMocks();
});

describe('auth link chain', () => {
  it('attaches the stored bearer token', async () => {
    setToken('first-token');
    const { link, seenAuthHeaders } = flakyLink(0);
    await clientWith(link).query({ query: QUERY, fetchPolicy: 'no-cache' });

    expect(seenAuthHeaders[0]).toBe('Bearer first-token');
  });

  // Asserts a genuinely valuable property: against a permanently-401ing
  // server, the chain retries exactly once and then gives up rather than
  // hanging or retrying unboundedly.
  //
  // NOT a seen-to-fail test for the `retried` guard: removing that guard does
  // NOT make this fail. Verified against @apollo/client 4.2.9 — `ErrorLink`
  // does not re-enter this handler for an error raised by its own retry, so
  // attemptCount() stays at 2 either way. The guard is kept as
  // belt-and-braces (see the comment on `createRefreshLink`), but this test
  // does not exercise it. The file's real seen-to-fail test is the
  // link-order test below ("re-reads the freshly stored token on the
  // retry"), which does fail if `createAuthLink()` is composed before
  // `createRefreshLink()`.
  it('retries exactly once on UNAUTHENTICATED, then gives up', async () => {
    setToken('stale-token');
    const { link, attemptCount } = flakyLink(Number.POSITIVE_INFINITY);

    await expect(
      clientWith(link).query({ query: QUERY, fetchPolicy: 'no-cache' })
    ).rejects.toThrow();

    // One original attempt + exactly one retry. Never more.
    expect(attemptCount()).toBe(2);
  });

  // SEEN-TO-FAIL (this file's real one): must fail if the link order is
  // flipped (authLink before refreshLink), because the retry would then
  // re-send the STALE token. Verified — see the fix report in
  // task-3-report.md.
  it('re-reads the freshly stored token on the retry', async () => {
    setToken('stale-token');
    const { link, seenAuthHeaders } = flakyLink(1);

    const result = await clientWith(link).query({ query: QUERY, fetchPolicy: 'no-cache' });

    expect(result.data).toEqual({ viewer: { __typename: 'Viewer', username: 'alice' } });
    expect(seenAuthHeaders).toEqual(['Bearer stale-token', 'Bearer refreshed-token']);
  });

  it('does not retry a non-auth error', async () => {
    setToken('good-token');
    let attempts = 0;
    const link = new ApolloLink(
      () =>
        new Observable((sink) => {
          attempts += 1;
          sink.error(
            new CombinedGraphQLErrors({
              errors: [
                {
                  message: 'Cannot query field "nope"',
                  extensions: { code: 'GRAPHQL_VALIDATION_FAILED' },
                },
              ],
            })
          );
        })
    );

    await expect(
      clientWith(link).query({ query: QUERY, fetchPolicy: 'no-cache' })
    ).rejects.toThrow();
    expect(attempts).toBe(1);
  });
});
