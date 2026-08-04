import { waitFor } from '@testing-library/react';
import type { ReactNode } from 'react';
import { describe, expect, it, vi } from 'vitest';

import {
  LibraryScanDocument,
  LibraryScanStatusDocument,
  ScanProgressDocument,
} from '~/graphql/scan';
import { renderWithApollo } from '~/test-utils';

import { Context } from '../context';
import { useScanLibrary } from './use-scan-library';

const LIBRARY_ID = 'LIB-1';
const USER_ID = 'USER-1';

vi.mock('~/provider/library-target', () => ({
  useCurrentLibraryId: () => ({ libraryId: LIBRARY_ID, loading: false }),
}));

const fetchBookList = vi.fn();
vi.mock('./use-fetch-book-list', () => ({ useFetchBookList: () => fetchBookList }));

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

/** The stream stays silent unless a test supplies its own event mock. */
const silentStream = {
  request: { query: ScanProgressDocument, variables: { libraryId: LIBRARY_ID } },
  result: { data: { scanProgress: status({}) } },
  delay: 100_000,
};

const clearCompleteBookIds = vi.fn();

const renderScanLibrary = (mocks: NonNullable<Parameters<typeof renderWithApollo>[1]>['mocks']) => {
  const result: { current?: ReturnType<typeof useScanLibrary> } = {};
  const Probe = () => {
    result.current = useScanLibrary();
    return null;
  };
  const Wrapper = ({ children }: { children: ReactNode }) => (
    <Context.Provider value={{ clearCompleteBookIds } as never}>{children}</Context.Provider>
  );
  renderWithApollo(
    <Wrapper>
      <Probe />
    </Wrapper>,
    { mocks }
  );
  return result;
};

describe('useScanLibrary', () => {
  it('reports a running scan on first render, with no mutation sent', async () => {
    const result = renderScanLibrary([statusMock(status({ state: 'RUNNING' })), silentStream]);

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
    const result = renderScanLibrary([statusMock(null), silentStream, scanMock]);

    await waitFor(() => expect(result.current).toBeDefined());
    await result.current?.[0]();

    // MockLink throws on an unmatched request, so reaching here without an
    // error proves `userId` (not libraryId) was sent.
    await waitFor(() => expect(result.current?.[3]).toBe(false));
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
    const result = renderScanLibrary([statusMock(null), silentStream, scanMock]);

    await waitFor(() => expect(result.current).toBeDefined());
    await result.current?.[0]();

    expect(result.current?.[3]).toBe(false);
  });

  it('refreshes the book list once when a scan completes', async () => {
    fetchBookList.mockClear();
    clearCompleteBookIds.mockClear();

    renderScanLibrary([
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

    await waitFor(() => expect(fetchBookList).toHaveBeenCalledTimes(1));
    expect(clearCompleteBookIds).toHaveBeenCalledTimes(1);
  });

  it('surfaces a failed scan with its message', async () => {
    const result = renderScanLibrary([
      statusMock(status({ state: 'FAILED', error: 'disk full' })),
      silentStream,
    ]);

    await waitFor(() => expect(result.current?.[3]).toBe(true));
    expect(result.current?.[4]).toBe('disk full');
  });
});
