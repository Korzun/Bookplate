import { screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeAll, describe, expect, it, vi } from 'vitest';

import { renderWithProviders } from '~/test-utils';

import { ConnectionUrls } from './index';

const origin = window.location.origin;
const syncUrl = `${origin}/sync`;
const opdsUrl = `${origin}/opds`;

// ConnectionUrls reads the device list to build per-device catalog URLs. Drive it
// directly so tests control how many devices exist. `mock`-prefixed name is required
// for the reference inside the hoisted vi.mock factory.
let mockDevices: { id: string; name: string; slug: string }[] = [];
vi.mock('~/provider/device', async (importOriginal) => {
  const actual = await importOriginal<typeof import('~/provider/device')>();
  return {
    ...actual,
    useDeviceList: () => [mockDevices, false, false, undefined],
  };
});

beforeAll(() => {
  Object.assign(navigator, { clipboard: { writeText: vi.fn().mockResolvedValue(undefined) } });
});

afterEach(() => {
  vi.clearAllMocks();
  mockDevices = [];
});

describe('ConnectionUrls', () => {
  it('shows the sync URL in its own card', () => {
    renderWithProviders(<ConnectionUrls />);
    expect(screen.getByText('Sync URL')).toBeInTheDocument();
    expect(screen.getByText(syncUrl)).toBeInTheDocument();
  });

  it('shows the base library URL with no "Default" label under a singular card when there are no devices', () => {
    renderWithProviders(<ConnectionUrls />);
    expect(screen.getByText('Library URL')).toBeInTheDocument();
    expect(screen.queryByText('Library URLs')).not.toBeInTheDocument();
    expect(screen.getByText(opdsUrl)).toBeInTheDocument();
    // With nothing to distinguish it from, the base URL is unlabelled.
    expect(screen.queryByText('Default')).not.toBeInTheDocument();
  });

  it('labels the base URL "Default" and each device URL with its device name when devices exist', () => {
    mockDevices = [
      { id: 'd1', name: 'Kindle', slug: 'kindle' },
      { id: 'd2', name: 'Kobo', slug: 'kobo' },
    ];
    renderWithProviders(<ConnectionUrls />);
    expect(screen.getByText('Library URLs')).toBeInTheDocument();
    expect(screen.queryByText('Library URL')).not.toBeInTheDocument();
    expect(screen.getByText(opdsUrl)).toBeInTheDocument();
    expect(screen.getByText('Default')).toBeInTheDocument();
    expect(screen.getByText(`${origin}/opds/device/kindle`)).toBeInTheDocument();
    expect(screen.getByText('Kindle')).toBeInTheDocument();
    expect(screen.getByText(`${origin}/opds/device/kobo`)).toBeInTheDocument();
    expect(screen.getByText('Kobo')).toBeInTheDocument();
  });

  it('copies the sync URL when its Copy button is clicked', async () => {
    const user = userEvent.setup();
    const writeText = vi.spyOn(navigator.clipboard, 'writeText').mockResolvedValue(undefined);
    renderWithProviders(<ConnectionUrls />);

    const row = screen.getByText(syncUrl).parentElement!;
    await user.click(within(row).getByRole('button', { name: /copy/i }));

    expect(writeText).toHaveBeenCalledWith(syncUrl);
  });

  it('copies the base library URL when its Copy button is clicked', async () => {
    const user = userEvent.setup();
    const writeText = vi.spyOn(navigator.clipboard, 'writeText').mockResolvedValue(undefined);
    renderWithProviders(<ConnectionUrls />);

    const row = screen.getByText(opdsUrl).parentElement!;
    await user.click(within(row).getByRole('button', { name: /copy/i }));

    expect(writeText).toHaveBeenCalledWith(opdsUrl);
  });
});
