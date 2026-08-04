import { act, fireEvent, screen, waitFor } from '@testing-library/react';
import { useState } from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { renderWithProviders } from '~/test-utils';

type ScanResult = { imported: string[]; removed: string[] } | undefined;
type ScanTuple = [() => Promise<void>, ScanResult, boolean, boolean];

const scanLibrary = vi.fn<() => Promise<void>>();
let applyResult: ((result: ScanResult) => void) | undefined;
let applyFailed: ((failed: boolean) => void) | undefined;

// Only useScanLibrary is consumed by the component; return the hook's tuple
// shape, with just enough internal state to simulate the terminal status
// arriving asynchronously over the subscription, the way the real hook does.
vi.mock('~/provider/book', () => ({
  useScanLibrary: (): ScanTuple => {
    const [result, setResult] = useState<ScanResult>(undefined);
    const [failed, setFailed] = useState(false);
    applyResult = setResult;
    applyFailed = setFailed;
    return [scanLibrary, result, false, failed];
  },
}));

// Imported lazily so the mock is registered before the module graph loads.
async function mount() {
  const { ScanLibrarySetting } = await import('./index');
  renderWithProviders(<ScanLibrarySetting />);
}

beforeEach(() => {
  scanLibrary.mockReset().mockResolvedValue(undefined);
  applyResult = undefined;
  applyFailed = undefined;
});
afterEach(() => {
  vi.clearAllMocks();
});

describe('ScanLibrarySetting', () => {
  it('renders the card title and description', async () => {
    await mount();
    expect(screen.getByText('Scan library')).toBeInTheDocument();
    expect(
      screen.getByText(
        'Check the library folder for books added or removed outside Bookplate and sync the catalog.'
      )
    ).toBeInTheDocument();
  });

  it('runs a scan and toasts the result when the terminal status lands', async () => {
    await mount();

    fireEvent.click(screen.getByRole('button', { name: /^scan$/i }));

    expect(scanLibrary).toHaveBeenCalledTimes(1);
    expect(screen.getByText('Scanning library…')).toBeInTheDocument();

    // Simulate the scan-progress subscription delivering the completed status.
    act(() => applyResult?.({ imported: ['a'], removed: [] }));

    await waitFor(() =>
      expect(screen.getByText('Scan complete: 1 imported, 0 removed')).toBeInTheDocument()
    );
  });

  it('toasts a failure when the scan reports a terminal failure', async () => {
    await mount();
    fireEvent.click(screen.getByRole('button', { name: /^scan$/i }));

    act(() => applyFailed?.(true));

    await waitFor(() => expect(screen.getByText('Scan failed')).toBeInTheDocument());
  });

  it('does not toast on mount for a scan completed before this page loaded', async () => {
    await mount();
    // No click happened — this instance never started a scan — so populating
    // `scanResult`/`failed` (e.g. from a query read on mount) must stay silent.
    act(() => applyResult?.({ imported: ['a'], removed: [] }));
    expect(screen.queryByText(/Scan complete/)).not.toBeInTheDocument();
  });

  it('does not toast for a later terminal status once this click has already reported', async () => {
    await mount();
    fireEvent.click(screen.getByRole('button', { name: /^scan$/i }));

    act(() => applyResult?.({ imported: ['a'], removed: [] }));
    await waitFor(() =>
      expect(screen.getByText('Scan complete: 1 imported, 0 removed')).toBeInTheDocument()
    );

    // A scan started from anywhere else (another tab, another device, the
    // REST route) streams a distinct terminal status into this page next.
    // Having already reported for the click above, this must stay silent.
    act(() => applyResult?.({ imported: ['b', 'c'], removed: [] }));
    expect(screen.queryByText('Scan complete: 2 imported, 0 removed')).not.toBeInTheDocument();
  });
});
