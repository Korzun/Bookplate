import { screen } from '@testing-library/react';
import { beforeAll, describe, expect, it, vi } from 'vitest';

import { renderWithProviders } from '~/test-utils';

import { DeviceList } from './index';

// DeviceRow renders a ConfirmModal (for delete), which calls the native
// <dialog> showModal/close methods jsdom does not implement. Stub them the
// same way control/confirm-modal/index.test.tsx does.
beforeAll(() => {
  HTMLDialogElement.prototype.showModal = vi.fn();
  HTMLDialogElement.prototype.close = vi.fn();
});

vi.mock('~/provider/device', async (importOriginal) => {
  const actual = await importOriginal<typeof import('~/provider/device')>();
  return {
    ...actual,
    useDeviceList: () => [
      [
        {
          id: 'd1',
          name: 'Kindle',
          slug: 'kindle',
          coverWidth: null,
          coverHeight: null,
          coverFit: 'contain',
          bwCover: false,
          simplify: true,
        },
      ],
      false,
    ],
    useDeleteDevice: () => [vi.fn(), false],
  };
});

describe('DeviceList', () => {
  it('shows the device slug in the metadata list', () => {
    renderWithProviders(<DeviceList />);
    expect(screen.getByText('Slug:')).toBeInTheDocument();
    expect(screen.getByText('kindle')).toBeInTheDocument();
  });
});
