import { waitFor } from '@testing-library/react';
import { describe, expect, it } from 'vitest';

import { LibraryScanStatusDocument, ScanProgressDocument } from '~/graphql/scan';
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
const libraryNode = (scanStatus: ReturnType<typeof status> | null) => ({
  node: {
    __typename: 'Library' as const,
    id: LIBRARY_ID,
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
        result: { data: { scanProgress: status({ processed: 4 }) } },
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
});
