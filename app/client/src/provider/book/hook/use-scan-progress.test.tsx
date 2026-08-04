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
});
