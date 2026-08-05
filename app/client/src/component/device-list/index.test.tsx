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

const mockDeviceList = vi.fn();

vi.mock('~/provider/device', async (importOriginal) => {
  const actual = await importOriginal<typeof import('~/provider/device')>();
  return {
    ...actual,
    useDeviceList: () => mockDeviceList(),
    useDeleteDevice: () => [vi.fn(), false],
  };
});

describe('DeviceList', () => {
  it('shows the device slug in the metadata list', () => {
    mockDeviceList.mockReturnValue([
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
      false,
      undefined,
    ]);

    renderWithProviders(<DeviceList />);
    expect(screen.getByText('Slug:')).toBeInTheDocument();
    expect(screen.getByText('kindle')).toBeInTheDocument();
  });

  // Carried finding from task 2: an empty array is also what a failed read
  // returns, so without checking `hasError` this would render identically to
  // "No devices yet" and hide a real GraphQL error from the user.
  it('shows the error message instead of "No devices yet" when the read fails', () => {
    mockDeviceList.mockReturnValue([[], false, true, 'device list query failed']);

    renderWithProviders(<DeviceList />);
    expect(screen.getByText('device list query failed')).toBeInTheDocument();
    expect(screen.queryByText('No devices yet')).not.toBeInTheDocument();
  });
});
