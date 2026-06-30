import { screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeAll, describe, expect, it, vi } from 'vitest';

import { renderWithProviders } from '~/test-utils';

import { ConnectionUrls } from './index';

const origin = window.location.origin;
const syncUrl = `${origin}/kosync`;
const opdsUrl = `${origin}/opds`;

beforeAll(() => {
  Object.assign(navigator, { clipboard: { writeText: vi.fn().mockResolvedValue(undefined) } });
});

afterEach(() => vi.clearAllMocks());

describe('ConnectionUrls', () => {
  it('shows the sync URL built from the current origin', () => {
    renderWithProviders(<ConnectionUrls />);
    expect(screen.getByText(syncUrl)).toBeInTheDocument();
  });

  it('shows the OPDS URL built from the current origin', () => {
    renderWithProviders(<ConnectionUrls />);
    expect(screen.getByText(opdsUrl)).toBeInTheDocument();
  });

  it('copies the sync URL when its Copy button is clicked', async () => {
    const user = userEvent.setup();
    const writeText = vi.spyOn(navigator.clipboard, 'writeText').mockResolvedValue(undefined);
    renderWithProviders(<ConnectionUrls />);

    const row = screen.getByText(syncUrl).parentElement!;
    await user.click(within(row).getByRole('button', { name: /copy/i }));

    expect(writeText).toHaveBeenCalledWith(syncUrl);
  });

  it('copies the OPDS URL when its Copy button is clicked', async () => {
    const user = userEvent.setup();
    const writeText = vi.spyOn(navigator.clipboard, 'writeText').mockResolvedValue(undefined);
    renderWithProviders(<ConnectionUrls />);

    const row = screen.getByText(opdsUrl).parentElement!;
    await user.click(within(row).getByRole('button', { name: /copy/i }));

    expect(writeText).toHaveBeenCalledWith(opdsUrl);
  });
});
