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

  // Round 1 of this test tried a WALL-CLOCK race: a scoped
  // `process.on('unhandledRejection', ...)` listener, given a fixed delay to
  // observe whether Node ever fired the event. That discriminated correctly
  // on this machine at the tuned delay, but it FAILS OPEN: for the correct
  // implementation `.catch()` is attached synchronously so the event never
  // fires regardless of delay (no false-red risk) — but for the BROKEN
  // implementation, the event fires after a real, environment-dependent
  // delay. A delay too short for THAT reason (a slower/more loaded CI
  // runner, not merely "we didn't tune the constant high enough") lets
  // `seenRejections` stay empty and the assertion PASS on a real regression.
  // That is the unsafe failure direction — the opposite of Task 3's
  // precedent, whose timing-dependent test fails CLOSED (a missed window
  // times out to red, a spurious-red CI nuisance at worst).
  //
  // This version asserts the actual invariant directly instead of racing
  // Node's async detector: the hook's own doc comment already claims
  // `.catch()` is attached SYNCHRONOUSLY, in the same call stack as
  // `client.query()` itself. That is a same-tick property, provable without
  // any timer — `client.query` is mocked to return a promise this test
  // controls, spied on its OWN `.catch` method; firing the intent event and
  // then immediately (same synchronous stack, no `await`) asserting the spy
  // was called proves the handler was registered before this function even
  // returns, let alone before any microtask/timer could run. If `.catch()`
  // ever regresses to a bare `void client.query(...)`, `catchSpy` is never
  // invoked and this assertion fails deterministically, every time, on every
  // machine — not "usually", not "if the delay was long enough".
  it('swallows a prefetch failure without an unhandled rejection', () => {
    const client = new ApolloClient({
      link: new MockLink([]),
      cache: new InMemoryCache(cacheConfig),
    });

    // Stands in for a real network failure. Spying on ITS OWN `.catch`
    // (not `Promise.prototype.catch`, which would also catch every other
    // promise in this test/render) keeps the assertion scoped to exactly
    // the one promise the hook is handed.
    const rejected = Promise.reject(new Error('boom'));
    const catchSpy = vi.spyOn(rejected, 'catch');
    const querySpy = vi.spyOn(client, 'query').mockReturnValue(rejected as never);

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

    result.current?.intentProps.onMouseEnter();

    expect(querySpy).toHaveBeenCalledTimes(1);
    // Deterministic — see this test's own leading comment. No `await`, no
    // timer: `.catch()` is either already attached by the time this line
    // runs, or the implementation is broken.
    expect(catchSpy).toHaveBeenCalledTimes(1);
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
