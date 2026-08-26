import { ApolloClient, ApolloLink, InMemoryCache } from '@apollo/client';
import { ApolloProvider } from '@apollo/client/react';
import { MockLink, MockSubscriptionLink } from '@apollo/client/testing';
import { render, waitFor } from '@testing-library/react';
import { describe, expect, it } from 'vitest';

import { LibraryScanStatusDocument, ScanProgressDocument } from '~/graphql/scan';
import { cacheConfig } from '~/provider/apollo';
import { renderWithApollo } from '~/test-utils';

import { useScanProgress } from './use-scan-progress';

const LIBRARY_ID = 'LIB-1';

const status = (overrides: Record<string, unknown>) => ({
  __typename: 'ScanStatus' as const,
  id: 'job-1',
  state: 'RUNNING',
  phase: 'IMPORTING',
  processed: 0,
  total: 10,
  currentFile: null,
  startedAt: '2026-08-03T00:00:00.000Z',
  error: null,
  result: null,
  ...overrides,
});

/** A `node(id:)` result carrying the Library arm, its user bridge, and a scan status. */
const libraryNode = (scanStatus: ReturnType<typeof status> | null, id: string = LIBRARY_ID) => ({
  node: {
    __typename: 'Library' as const,
    id,
    user: { __typename: 'User' as const, id: 'USER-1' },
    scanStatus,
  },
});

const renderScanProgress = (
  mocks: NonNullable<Parameters<typeof renderWithApollo>[1]>['mocks']
) => {
  const result: { current?: ReturnType<typeof useScanProgress> } = {};
  const Probe = () => {
    result.current = useScanProgress(LIBRARY_ID);
    return null;
  };
  renderWithApollo(<Probe />, { mocks });
  return result;
};

describe('useScanProgress', () => {
  // SEEN-TO-FAIL: must fail if the reconnect read is dropped. There is an
  // inherent gap between subscribing and the server publishing, so a hook that
  // ONLY subscribes shows nothing for an already-running scan.
  it('reads current scanStatus immediately, without waiting for an event', async () => {
    const result = renderScanProgress([
      {
        request: { query: LibraryScanStatusDocument, variables: { libraryId: LIBRARY_ID } },
        result: { data: libraryNode(status({ processed: 4 })) },
      },
      {
        request: { query: ScanProgressDocument, variables: { libraryId: LIBRARY_ID } },
        // Deliberately a DIFFERENT value than the query mock's `processed: 4`:
        // if the delay below were ever removed/shortened and this event slipped
        // through, the assertion below would then fail (9 !== 4) instead of
        // passing for the wrong reason.
        result: { data: { scanProgress: status({ processed: 9 }) } },
        delay: 100_000, // never arrives within the test
      },
    ]);

    await waitFor(() => expect(result.current?.status?.processed).toBe(4));
  });

  it('merges a streamed event over the initial read', async () => {
    const result = renderScanProgress([
      {
        request: { query: LibraryScanStatusDocument, variables: { libraryId: LIBRARY_ID } },
        result: { data: libraryNode(status({ processed: 1 })) },
      },
      {
        request: { query: ScanProgressDocument, variables: { libraryId: LIBRARY_ID } },
        result: { data: { scanProgress: status({ processed: 7 }) } },
      },
    ]);

    await waitFor(() => expect(result.current?.status?.processed).toBe(7));
  });

  // SEEN-TO-FAIL class: proves a query error surfaces on `error` rather than
  // being dropped. Without reading `error` off `useQuery`, this hook returns
  // `{ status: undefined }` — indistinguishable from "no scan running".
  it('surfaces a query error instead of dropping it silently', async () => {
    const result = renderScanProgress([
      {
        request: { query: LibraryScanStatusDocument, variables: { libraryId: LIBRARY_ID } },
        error: new Error('bootstrap query failed'),
      },
      {
        request: { query: ScanProgressDocument, variables: { libraryId: LIBRARY_ID } },
        result: { data: { scanProgress: status({}) } },
        delay: 100_000,
      },
    ]);

    await waitFor(() => expect(result.current?.error).toBeDefined());
    expect(result.current?.error?.message).toBe('bootstrap query failed');
    expect(result.current?.status).toBeUndefined();
  });

  it('surfaces a subscription error instead of dropping it silently', async () => {
    const result = renderScanProgress([
      {
        request: { query: LibraryScanStatusDocument, variables: { libraryId: LIBRARY_ID } },
        result: { data: libraryNode(null) },
      },
      {
        request: { query: ScanProgressDocument, variables: { libraryId: LIBRARY_ID } },
        error: new Error('stream refused'),
      },
    ]);

    await waitFor(() => expect(result.current?.error).toBeDefined());
    expect(result.current?.error?.message).toBe('stream refused');
  });

  it('reports no status when the library has never been scanned', async () => {
    const result = renderScanProgress([
      {
        request: { query: LibraryScanStatusDocument, variables: { libraryId: LIBRARY_ID } },
        result: { data: libraryNode(null) },
      },
      {
        request: { query: ScanProgressDocument, variables: { libraryId: LIBRARY_ID } },
        result: { data: { scanProgress: status({}) } },
        delay: 100_000,
      },
    ]);

    await waitFor(() => expect(result.current?.loading).toBe(false));
    expect(result.current?.status).toBeUndefined();
  });

  describe('across a libraryId change', () => {
    const LIBRARY_A = 'LIB-A';
    const LIBRARY_B = 'LIB-B';

    // RESOLVES spec §14.6 (previously unverified): Apollo v4's `useSubscription`
    // recreates its tracking object — with a fresh `{ loading: true, data:
    // undefined }` result — synchronously in the SAME render that notices the
    // variables changed (see `useSubscription.js`: the `recreate()` call and
    // its `setObservable` both happen in the render body, not an effect, and
    // the new object is what `useSyncExternalStore`'s snapshot already reads
    // for that render). Measured here rather than trusted: mount against
    // `MockSubscriptionLink`, push an event for library A, switch to B, and
    // check `status` in the very next render — before B's bootstrap query has
    // even had a tick to resolve. Confirmed: `status` is `undefined` there,
    // and stays that way since no event for B is ever emitted. No production
    // change follows from this — see this task's report for why.
    it("clears status when libraryId changes, rather than keeping the old library's last event", async () => {
      const subscriptionLink = new MockSubscriptionLink();
      const queryLink = new MockLink([
        {
          request: { query: LibraryScanStatusDocument, variables: { libraryId: LIBRARY_A } },
          result: { data: libraryNode(null, LIBRARY_A) },
        },
        {
          request: { query: LibraryScanStatusDocument, variables: { libraryId: LIBRARY_B } },
          result: { data: libraryNode(null, LIBRARY_B) },
        },
      ]);
      const link = ApolloLink.split(
        (operation) => operation.query === ScanProgressDocument,
        subscriptionLink,
        queryLink
      );
      const client = new ApolloClient({ link, cache: new InMemoryCache(cacheConfig) });

      const result: { current?: ReturnType<typeof useScanProgress> } = {};
      const Probe = ({ libraryId }: { libraryId: string }) => {
        result.current = useScanProgress(libraryId);
        return null;
      };

      const { rerender } = render(
        <ApolloProvider client={client}>
          <Probe libraryId={LIBRARY_A} />
        </ApolloProvider>
      );

      // Let library A's bootstrap query settle (its scanStatus is null — only
      // the subscription event below carries a status), then push an event
      // for A's in-flight scan.
      await waitFor(() => expect(result.current?.loading).toBe(false));
      subscriptionLink.simulateResult({
        result: { data: { scanProgress: status({ processed: 4 }) } },
      });
      await waitFor(() => expect(result.current?.status?.processed).toBe(4));

      // Switch to library B. No event for B is ever emitted in this test, and
      // B's bootstrap query also resolves to a null scanStatus, so B's read
      // contributes nothing — isolating what the SUBSCRIPTION alone is still
      // holding onto.
      rerender(
        <ApolloProvider client={client}>
          <Probe libraryId={LIBRARY_B} />
        </ApolloProvider>
      );

      // Measured, not assumed: A's event does NOT survive the switch, in the
      // very next render — before B's bootstrap query has had a tick to
      // resolve either.
      expect(result.current?.status).toBeUndefined();

      // Stays cleared once B's own (empty) read settles too.
      await waitFor(() => expect(result.current?.loading).toBe(false));
      expect(result.current?.status).toBeUndefined();
    });
  });
});
