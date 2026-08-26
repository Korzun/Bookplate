import { screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeAll, describe, expect, it, vi } from 'vitest';

import { makeFragmentData } from '~/gql';
import type { ConnectionUrlsFragmentFragment } from '~/gql/graphql';
import { renderWithProviders } from '~/test-utils';

import { ConnectionUrls, ConnectionUrlsFragment } from './index';

const origin = window.location.origin;
const syncUrl = `${origin}/sync`;
const opdsUrl = `${origin}/opds`;

/**
 * A typed `ConnectionUrlsFragmentFragment` VARIABLE, never an inline object
 * literal at a call site — see `component/my-progress-row/index.test.tsx`'s
 * note on why a fresh literal fails TypeScript's excess-property check
 * against `ConnectionUrls`' MASKED `devices` prop, and why
 * `makeFragmentData` is the sanctioned cast back to that masked type.
 */
const device = (
  overrides: Partial<{ id: string; name: string; slug: string }> = {}
): ConnectionUrlsFragmentFragment => ({
  __typename: 'Device',
  id: overrides.id ?? 'd1',
  name: overrides.name ?? 'Kindle',
  slug: overrides.slug ?? 'kindle',
});

beforeAll(() => {
  Object.assign(navigator, { clipboard: { writeText: vi.fn().mockResolvedValue(undefined) } });
});

afterEach(() => {
  vi.clearAllMocks();
});

describe('ConnectionUrls', () => {
  it('shows the sync URL in its own card', () => {
    renderWithProviders(<ConnectionUrls devices={[]} />);
    expect(screen.getByText('Sync URL')).toBeInTheDocument();
    expect(screen.getByText(syncUrl)).toBeInTheDocument();
  });

  it('shows the base library URL with no "Default" label under a singular card when there are no devices', () => {
    renderWithProviders(<ConnectionUrls devices={[]} />);
    expect(screen.getByText('Library URL')).toBeInTheDocument();
    expect(screen.queryByText('Library URLs')).not.toBeInTheDocument();
    expect(screen.getByText(opdsUrl)).toBeInTheDocument();
    // With nothing to distinguish it from, the base URL is unlabelled.
    expect(screen.queryByText('Default')).not.toBeInTheDocument();
  });

  it('labels the base URL "Default" and each device URL with its device name when devices exist', () => {
    const devices = [
      makeFragmentData(
        device({ id: 'd1', name: 'Kindle', slug: 'kindle' }),
        ConnectionUrlsFragment
      ),
      makeFragmentData(device({ id: 'd2', name: 'Kobo', slug: 'kobo' }), ConnectionUrlsFragment),
    ];
    renderWithProviders(<ConnectionUrls devices={devices} />);
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
    renderWithProviders(<ConnectionUrls devices={[]} />);

    const row = screen.getByText(syncUrl).parentElement!;
    await user.click(within(row).getByRole('button', { name: /copy/i }));

    expect(writeText).toHaveBeenCalledWith(syncUrl);
  });

  it('copies the base library URL when its Copy button is clicked', async () => {
    const user = userEvent.setup();
    const writeText = vi.spyOn(navigator.clipboard, 'writeText').mockResolvedValue(undefined);
    renderWithProviders(<ConnectionUrls devices={[]} />);

    const row = screen.getByText(opdsUrl).parentElement!;
    await user.click(within(row).getByRole('button', { name: /copy/i }));

    expect(writeText).toHaveBeenCalledWith(opdsUrl);
  });
});
