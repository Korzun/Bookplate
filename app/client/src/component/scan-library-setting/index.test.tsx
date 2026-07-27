import { fireEvent, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { renderWithProviders } from '~/test-utils';

const scanLibrary = vi.fn();
// Only useScanLibrary is consumed by the component; return the hook's tuple shape.
vi.mock('~/provider/book', () => ({
  useScanLibrary: () => [scanLibrary, undefined, false],
}));

// Imported lazily so the mock is registered before the module graph loads.
async function mount() {
  const { ScanLibrarySetting } = await import('./index');
  renderWithProviders(<ScanLibrarySetting />);
}

beforeEach(() => {
  scanLibrary.mockReset();
});
afterEach(() => {
  vi.clearAllMocks();
});

describe('ScanLibrarySetting', () => {
  it('renders the card title and description', async () => {
    scanLibrary.mockResolvedValue({ imported: [], removed: [] });
    await mount();
    expect(screen.getByText('Scan library')).toBeInTheDocument();
    expect(
      screen.getByText(
        'Check the library folder for books added or removed outside Bookplate and sync the catalog.'
      )
    ).toBeInTheDocument();
  });

  it('runs a scan and toasts the result when Scan is clicked', async () => {
    scanLibrary.mockResolvedValue({ imported: ['a'], removed: [] });
    await mount();

    fireEvent.click(screen.getByRole('button', { name: /^scan$/i }));

    expect(scanLibrary).toHaveBeenCalledTimes(1);
    expect(screen.getByText('Scanning library…')).toBeInTheDocument();
    await waitFor(() =>
      expect(screen.getByText('Scan complete: 1 imported, 0 removed')).toBeInTheDocument()
    );
  });

  it('toasts a failure when the scan resolves null', async () => {
    scanLibrary.mockResolvedValue(null);
    await mount();
    fireEvent.click(screen.getByRole('button', { name: /^scan$/i }));
    await waitFor(() => expect(screen.getByText('Scan failed')).toBeInTheDocument());
  });
});
