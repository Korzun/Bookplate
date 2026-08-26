import { ApolloClient, InMemoryCache } from '@apollo/client';
import { ApolloProvider } from '@apollo/client/react';
import { MockLink, type MockedResponse } from '@apollo/client/testing';
import { render, waitFor } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';

import type { LibrarySubjectsQuery } from '~/gql/graphql';
import { LibrarySubjectsDocument } from '~/graphql/library';
import { cacheConfig } from '~/provider/apollo';
import { renderHookWithApollo } from '~/test-utils';

import { usePrefetchOnIntent } from './use-prefetch-on-intent';

/**
 * `LibrarySubjectsDocument` is reused as this generic helper's test fixture
 * rather than a bespoke document — it is the simplest single-variable query
 * document already in the codebase (`node(id:)` plus one inline fragment,
 * no connection shape to mock), and codegen excludes `*.test.{ts,tsx}` from
 * its `documents` glob (`use-paginated-connection.test.tsx`'s own note), so
 * reusing it here adds no new document for codegen/cost-budget tooling to
 * pick up.
 */
const LIBRARY_ID = 'LIB-1';

const subjectsMock = (
  libraryId: string,
  subjects: string[]
): MockedResponse<LibrarySubjectsQuery> => ({
  request: { query: LibrarySubjectsDocument, variables: { libraryId } },
  result: {
    data: {
      __typename: 'Query',
      node: { __typename: 'Library', id: libraryId, subjects },
    },
  },
});

const subjectsErrorMock = (libraryId: string): MockedResponse<LibrarySubjectsQuery> => ({
  request: { query: LibrarySubjectsDocument, variables: { libraryId } },
  error: new Error('boom'),
});

describe('usePrefetchOnIntent', () => {
  it('fires the query on hover, before any click', async () => {
    const { result, client } = renderHookWithApollo(
      () => usePrefetchOnIntent(LibrarySubjectsDocument, { libraryId: LIBRARY_ID }),
      [subjectsMock(LIBRARY_ID, ['sci-fi'])]
    );

    // Nothing has hit the cache yet — no click, no hover, has happened.
    expect(client.cache.extract()).toEqual({});

    result.current?.intentProps.onMouseEnter();

    await waitFor(() => expect(client.cache.extract()).toHaveProperty(`Library:${LIBRARY_ID}`));
  });

  // The trap this codebase has hit before (`use-paginated-connection
  // .test.tsx`'s own re-entrancy test, and its inline note): Apollo's
  // `queryDeduplication` defaults to `true` and silently collapses two
  // concurrent identical in-flight requests on its own, so a test that only
  // observes the NETWORK LAYER (e.g. via `MockLink`'s own bookkeeping)
  // passes whether or not this hook's own once-per-variables guard exists.
  // This hook's guard sits one layer ABOVE the network — it decides whether
  // to call `client.query` at all — so the direct, un-trappable way to
  // prove it exists is to spy on `client.query` itself and count
  // invocations, independent of anything Apollo's transport does
  // afterwards. `queryDeduplication` is left at its default here on
  // purpose: this test does not depend on it either way.
  it('does not fire twice for the same variables', async () => {
    const client = new ApolloClient({
      link: new MockLink([subjectsMock(LIBRARY_ID, ['sci-fi'])]),
      cache: new InMemoryCache(cacheConfig),
    });
    const querySpy = vi.spyOn(client, 'query');

    const result: { current: ReturnType<typeof usePrefetchOnIntent> | undefined } = {
      current: undefined,
    };
    function Probe() {
      result.current = usePrefetchOnIntent(LibrarySubjectsDocument, { libraryId: LIBRARY_ID });
      return null;
    }
    render(
      <ApolloProvider client={client}>
        <Probe />
      </ApolloProvider>
    );

    // A sweep across the trigger: several intent events for the SAME
    // variables, before the first has any chance to settle.
    result.current?.intentProps.onMouseEnter();
    result.current?.intentProps.onFocus();
    result.current?.intentProps.onTouchStart();
    result.current?.intentProps.onMouseEnter();

    await waitFor(() => expect(client.cache.extract()).toHaveProperty(`Library:${LIBRARY_ID}`));
    expect(querySpy).toHaveBeenCalledTimes(1);
  });

  // A whole-file run already fails if the rejection escapes unhandled
  // (vitest reports it as a run-level "Unhandled Rejection" — the same
  // mechanism `device-row/index.test.tsx`, `link-progress-modal
  // /index.test.tsx`, and `use-replace-book.test.tsx` all lean on), but
  // that alone gives a FALSE PASS to a `-t`-filtered run of just this test:
  // the rejection is detected asynchronously, after this test has already
  // reported green, so a filtered run never observes it. Every one of the
  // three precedents above carries its own independent, in-test assertion
  // that fails on the same regression by itself (e.g. `findByText('Network
  // error')` timing out) — this test needs the equivalent. A
  // process-level `unhandledRejection` listener, scoped to this test and
  // removed in `finally`, is that independent assertion here: if the
  // hook's `.catch()` regresses, `seenRejections` is non-empty and the
  // `toEqual([])` below fails on its own, with no dependency on vitest's
  // own run-level detection.
  it('swallows a prefetch failure without an unhandled rejection', async () => {
    const seenRejections: unknown[] = [];
    const onUnhandledRejection = (reason: unknown) => {
      seenRejections.push(reason);
    };
    process.on('unhandledRejection', onUnhandledRejection);

    try {
      const { result, client } = renderHookWithApollo(
        () => usePrefetchOnIntent(LibrarySubjectsDocument, { libraryId: LIBRARY_ID }),
        [subjectsErrorMock(LIBRARY_ID)]
      );

      result.current?.intentProps.onMouseEnter();

      // Waiting a beat gives the rejected `client.query` promise a chance to
      // actually settle, and gives Node a chance to fire `unhandledRejection`
      // for it if nothing caught it, before this test asserts and ends. 100ms
      // is not a stylistic round number — with the `.catch()` removed as a
      // deliberate probe, Node's `unhandledRejection` fires well after this
      // promise settles (routed through several of Apollo's own internal
      // microtask hops); empirically, 20ms was NOT enough for this listener
      // to observe it (a false pass), 100ms reliably was (checked across
      // repeated runs), so 100ms is the margin, not a guess.
      await new Promise((resolve) => setTimeout(resolve, 100));

      expect(seenRejections).toEqual([]);
      // The failure never reaches the cache either — a second, independent
      // signal that it was actually caught and discarded, not just
      // unobserved.
      expect(client.cache.extract()).toEqual({});
    } finally {
      process.off('unhandledRejection', onUnhandledRejection);
    }
  });

  it('does nothing when skip is true', async () => {
    const client = new ApolloClient({
      link: new MockLink([subjectsMock(LIBRARY_ID, ['sci-fi'])]),
      cache: new InMemoryCache(cacheConfig),
    });
    const querySpy = vi.spyOn(client, 'query');

    const result: { current: ReturnType<typeof usePrefetchOnIntent> | undefined } = {
      current: undefined,
    };
    function Probe() {
      result.current = usePrefetchOnIntent(
        LibrarySubjectsDocument,
        { libraryId: LIBRARY_ID },
        { skip: true }
      );
      return null;
    }
    render(
      <ApolloProvider client={client}>
        <Probe />
      </ApolloProvider>
    );

    result.current?.intentProps.onMouseEnter();
    result.current?.intentProps.onFocus();
    result.current?.intentProps.onTouchStart();
    result.current?.prefetch();

    await new Promise((resolve) => setTimeout(resolve, 20));

    expect(querySpy).not.toHaveBeenCalled();
    expect(client.cache.extract()).toEqual({});
  });
});
