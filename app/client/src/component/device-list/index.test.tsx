import { screen } from '@testing-library/react';
import { beforeAll, describe, expect, it, vi } from 'vitest';

import { DeviceRowFragment } from '~/component/device-row';
import { makeFragmentData } from '~/gql';
import type { DeviceRowFragmentFragment } from '~/gql/graphql';
import { renderWithApollo } from '~/test-utils';

import { DeviceList } from './index';

// DeviceRow renders a ConfirmModal (for delete), which calls the native
// <dialog> showModal/close methods jsdom does not implement. Stub them the
// same way control/confirm-modal/index.test.tsx does.
beforeAll(() => {
  HTMLDialogElement.prototype.showModal = vi.fn();
  HTMLDialogElement.prototype.close = vi.fn();
});

/**
 * A typed `DeviceRowFragmentFragment` VARIABLE, never an inline object
 * literal at a call site — see `component/my-progress-row/index.test.tsx`'s
 * note on why a fresh literal fails TypeScript's excess-property check
 * against `DeviceList`'s MASKED `devices` prop.
 */
const device = (
  overrides: Partial<{
    id: string;
    name: string;
    slug: string;
    coverWidth: number | null;
    coverHeight: number | null;
    coverFit: DeviceRowFragmentFragment['coverFit'];
    bwCover: boolean;
    simplify: boolean;
  }> = {}
): DeviceRowFragmentFragment => ({
  __typename: 'Device',
  id: overrides.id ?? 'd1',
  name: overrides.name ?? 'Kindle',
  slug: overrides.slug ?? 'kindle',
  coverWidth: overrides.coverWidth ?? null,
  coverHeight: overrides.coverHeight ?? null,
  coverFit: overrides.coverFit ?? 'CONTAIN',
  bwCover: overrides.bwCover ?? false,
  simplify: overrides.simplify ?? true,
});

describe('DeviceList', () => {
  it('shows the device slug in the metadata list', () => {
    renderWithApollo(
      <DeviceList
        devices={[makeFragmentData(device(), DeviceRowFragment)]}
        loading={false}
        error={undefined}
      />
    );
    expect(screen.getByText('Slug:')).toBeInTheDocument();
    expect(screen.getByText('kindle')).toBeInTheDocument();
  });

  it('sorts devices by name', () => {
    const devices = [
      makeFragmentData(
        device({ id: 'd1', name: 'Zebra reader', slug: 'zebra' }),
        DeviceRowFragment
      ),
      makeFragmentData(
        device({ id: 'd2', name: 'Alpha reader', slug: 'alpha' }),
        DeviceRowFragment
      ),
    ];
    renderWithApollo(<DeviceList devices={devices} loading={false} error={undefined} />);
    // Each device name also appears a second time (the confirm-delete
    // modal's always-rendered body text), so this asserts on the SLUGS —
    // each unique to one row — which determines the render order.
    const slugs = [screen.getByText('alpha'), screen.getByText('zebra')];
    const [alphaSlug, zebraSlug] = slugs;
    expect(
      alphaSlug.compareDocumentPosition(zebraSlug) & Node.DOCUMENT_POSITION_FOLLOWING
    ).toBeTruthy();
  });

  it('shows a loading message while the query is in flight', () => {
    renderWithApollo(<DeviceList devices={[]} loading error={undefined} />);
    expect(screen.getByText('Loading…')).toBeInTheDocument();
  });

  // Carried finding from task 2: an empty array is also what a failed read
  // returns, so without checking `error` this would render identically to
  // "No devices yet" and hide a real GraphQL error from the user.
  it('shows the error message instead of "No devices yet" when the read fails', () => {
    renderWithApollo(<DeviceList devices={[]} loading={false} error="device list query failed" />);
    expect(screen.getByText('device list query failed')).toBeInTheDocument();
    expect(screen.queryByText('No devices yet')).not.toBeInTheDocument();
  });

  it('shows "No devices yet" when the list is empty', () => {
    renderWithApollo(<DeviceList devices={[]} loading={false} error={undefined} />);
    expect(screen.getByText('No devices yet')).toBeInTheDocument();
  });
});
