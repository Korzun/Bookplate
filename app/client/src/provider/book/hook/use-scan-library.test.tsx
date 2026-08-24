import { act, waitFor } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';

import type { LibraryEntriesQueryVariables } from '~/gql/graphql';
import { LibraryEntriesDocument } from '~/graphql/library';
import {
  LibraryScanDocument,
  LibraryScanStatusDocument,
  ScanProgressDocument,
} from '~/graphql/scan';
import { renderWithApollo } from '~/test-utils';

import { useScanLibrary } from './use-scan-library';
import { useScanProgress } from './use-scan-progress';

const LIBRARY_ID = 'LIB-1';
const USER_ID = 'USER-1';

vi.mock('~/provider/library-target', () => ({
  useCurrentLibraryId: () => ({ libraryId: LIBRARY_ID, loading: false }),
}));

// Matches `use-library-entries.ts`'s `PAGE_SIZE` default and its
// `filter: undefined` when no filter is applied — the exact variables the
// live grid reads `Library.entries` with.
const ENTRIES_VARS: LibraryEntriesQueryVariables = {
  libraryId: LIBRARY_ID,
  first: 20,
  filter: undefined,
};

// Deliberately UNANNOTATED: `LibraryEntriesQuery`'s `Book` node member is
// masked (its fields sit behind `BookRowFragment`'s `$fragmentRefs`), so an
// explicitly typed literal here fails `tsc`'s excess-property check on
// `id`/`title`/etc. Letting this infer, then passing it through
// `seedLibraryEntries` below via a variable reference (not a literal),
// sidesteps that check — same idiom `use-delete-book.test.tsx`'s
// `standaloneBook` uses.
const seededBook = {
  __typename: 'Book' as const,
  id: 'SEEDED-BOOK',
  title: 'Seeded',
  author: 'Someone',
  seriesIndex: 0,
  hasCover: false,
  thumbnailUrl: '',
  progress: null,
};

/** Writes DIRECTLY into the cache (no network mock), synchronously, right
 * after render — a `client.query()` network seed would race the
 * `LibraryScanStatusDocument` mock's own resolution: this test's `COMPLETED`
 * status arrives over the SAME kind of timer-scheduled mock response, and
 * whichever timer fires first is not guaranteed. Seeding synchronously
 * before any `await` yields to the event loop sidesteps the race entirely —
 * same idiom as `use-delete-book.test.tsx`'s `seedLibraryEntries`. */
const seedLibraryEntries = (client: ReturnType<typeof renderWithApollo>['client']) =>
  client.writeQuery({
    query: LibraryEntriesDocument,
    variables: ENTRIES_VARS,
    data: {
      __typename: 'Query',
      node: {
        __typename: 'Library',
        id: LIBRARY_ID,
        entries: {
          __typename: 'LibraryEntriesConnection',
          edges: [{ __typename: 'LibraryEntriesConnectionEdge', cursor: 'c1', node: seededBook }],
          pageInfo: { __typename: 'PageInfo', hasNextPage: false, endCursor: null },
        },
      },
    },
  });

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

const libraryNode = (scanStatus: ReturnType<typeof status> | null) => ({
  node: {
    __typename: 'Library' as const,
    id: LIBRARY_ID,
    user: { __typename: 'User' as const, id: USER_ID },
    scanStatus,
  },
});

const statusMock = (scanStatus: ReturnType<typeof status> | null) => ({
  request: { query: LibraryScanStatusDocument, variables: { libraryId: LIBRARY_ID } },
  result: { data: libraryNode(scanStatus) },
});

/** No `node(id:)` result at all — the shape `useScanProgress` sees for the
 * config-based admin, for whom `Library.user.id` can never be resolved. */
const noOwnerMock = {
  request: { query: LibraryScanStatusDocument, variables: { libraryId: LIBRARY_ID } },
  result: { data: { node: null } },
};

/** The stream stays silent unless a test supplies its own event mock. */
const silentStream = {
  request: { query: ScanProgressDocument, variables: { libraryId: LIBRARY_ID } },
  result: { data: { scanProgress: status({}) } },
  delay: 100_000,
};

const renderScanLibrary = (mocks: NonNullable<Parameters<typeof renderWithApollo>[1]>['mocks']) => {
  const result: { current?: ReturnType<typeof useScanLibrary> } = {};
  // Test-only readiness signal: `useScanLibrary`'s tuple never exposes the
  // resolved owner userId, but the mutation guard reads it, so a test that
  // invokes `scanLibrary()` before the `LibraryScanStatusDocument` mock has
  // resolved races a real `userId === undefined` window. `useScanProgress`
  // is the exact same hook `useScanLibrary` calls internally for that read,
  // and Apollo dedupes the identical in-flight query, so calling it again
  // here to observe readiness does not consume a second mock response.
  const ready: { current?: string } = {};
  const Probe = () => {
    result.current = useScanLibrary();
    ready.current = useScanProgress(LIBRARY_ID).userId;
    return null;
  };
  const { client } = renderWithApollo(<Probe />, { mocks });
  return { result, ready, client };
};

describe('useScanLibrary', () => {
  it('reports a running scan on first render, with no mutation sent', async () => {
    const { result } = renderScanLibrary([statusMock(status({ state: 'RUNNING' })), silentStream]);

    // The old hook needed a mount-time "attach" effect for this; it is now
    // structural, because the status read runs alongside the stream.
    await waitFor(() => expect(result.current?.[2]).toBe(true));
  });

  it('starts a scan with the library owner userId, not the library id', async () => {
    const scanMock = {
      request: { query: LibraryScanDocument, variables: { userId: USER_ID } },
      result: {
        data: {
          libraryScan: {
            __typename: 'LibraryScanPayload' as const,
            scanStatus: status({ state: 'RUNNING' }),
          },
        },
      },
    };
    const { result, ready } = renderScanLibrary([statusMock(null), silentStream, scanMock]);

    // Wait for the owner userId to resolve before invoking the mutation:
    // calling it while the read is still in flight would hit the `!userId`
    // guard instead of exercising the mutation this test is about.
    await waitFor(() => expect(ready.current).toBe(USER_ID));
    await result.current?.[0]();

    // MockLink throws on an unmatched request, so reaching here without an
    // error proves `userId` (not libraryId) was sent.
    // `[3]` starts `false`, so `waitFor` on it directly can never meaningfully
    // fail; flush on `[2]` (which does transition true -> false as the
    // mutation resolves) first, then assert `[3]` directly.
    await waitFor(() => expect(result.current?.[2]).toBe(false));
    expect(result.current?.[3]).toBe(false);
  });

  it('treats ScanAlreadyRunningError as attach, not failure', async () => {
    const scanMock = {
      request: { query: LibraryScanDocument, variables: { userId: USER_ID } },
      result: {
        data: {
          libraryScan: {
            __typename: 'ScanAlreadyRunningError' as const,
            message: 'A scan is already running',
            scanStatus: status({ state: 'RUNNING' }),
          },
        },
      },
    };
    const { result, ready } = renderScanLibrary([statusMock(null), silentStream, scanMock]);

    // Wait for the owner userId to resolve before invoking the mutation, for
    // the same reason as the previous test.
    await waitFor(() => expect(ready.current).toBe(USER_ID));
    await result.current?.[0]();
    await waitFor(() => expect(result.current?.[2]).toBe(false)); // forces the flush
    expect(result.current?.[3]).toBe(false);
    expect(result.current?.[4]).toBeUndefined();
  });

  it('invalidates the LibraryEntries connection when a scan completes, so the grid refetches', async () => {
    const { client } = renderScanLibrary([
      statusMock(
        status({
          state: 'COMPLETED',
          result: {
            __typename: 'ScanResult',
            imported: [],
            importedFilenames: ['dune.epub'],
            removed: [],
          },
        })
      ),
      silentStream,
    ]);

    // Seed the connection synchronously, before the `LibraryScanStatusDocument`
    // mock's own timer has a chance to fire (see `seedLibraryEntries`'s doc
    // comment), then prove it is really in the cache — otherwise a broken
    // assertion below could "pass" against a cache that was empty all along.
    act(() => seedLibraryEntries(client));
    expect(
      client.cache.readQuery({ query: LibraryEntriesDocument, variables: ENTRIES_VARS })
    ).not.toBeNull();

    await waitFor(() =>
      expect(
        client.cache.readQuery({ query: LibraryEntriesDocument, variables: ENTRIES_VARS })
      ).toBeNull()
    );
  });

  it('surfaces a failed scan with its message', async () => {
    const { result } = renderScanLibrary([
      statusMock(status({ state: 'FAILED', error: 'disk full' })),
      silentStream,
    ]);

    await waitFor(() => expect(result.current?.[3]).toBe(true));
    expect(result.current?.[4]).toBe('disk full');
  });

  it('surfaces a bootstrap query error as a failure instead of freezing silently', async () => {
    // No `result`, an `error` instead: MockLink resolves this as a network
    // error on `LibraryScanStatusDocument`. Without I-3's fix this hook drops
    // it on the floor and looks identical to "no scan is running".
    const { result } = renderScanLibrary([
      {
        request: { query: LibraryScanStatusDocument, variables: { libraryId: LIBRARY_ID } },
        error: new Error('bootstrap query failed'),
      },
      silentStream,
    ]);

    await waitFor(() => expect(result.current?.[3]).toBe(true));
    expect(result.current?.[4]).toBe('bootstrap query failed');
    expect(result.current?.[2]).toBe(false); // not stuck "running" either
  });

  it('surfaces a failure instead of hanging silently when no library owner can be resolved', async () => {
    // No `LibraryScanDocument` mock supplied: reaching a failure here without
    // MockLink throwing on an unmatched request proves the mutation was never
    // sent — the guard short-circuited on the missing userId, not on a failed
    // network call.
    const { result } = renderScanLibrary([noOwnerMock, silentStream]);

    await waitFor(() => expect(result.current).toBeDefined());
    expect(result.current?.[2]).toBe(false); // not running — nothing hangs

    await result.current?.[0]();

    await waitFor(() => expect(result.current?.[3]).toBe(true));
    expect(result.current?.[2]).toBe(false);
    expect(result.current?.[4]).toBe('No library to scan');
  });
});
