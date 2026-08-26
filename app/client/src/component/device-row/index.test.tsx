import type { ApolloClient, NormalizedCacheObject } from '@apollo/client';
import type { MockedResponse } from '@apollo/client/testing';
import { screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeAll, describe, expect, it, vi } from 'vitest';

import { makeFragmentData } from '~/gql';
import type {
  DeviceDeleteMutation,
  DeviceDeleteMutationVariables,
  DeviceRowFragmentFragment,
} from '~/gql/graphql';
import { DeviceDeleteDocument } from '~/graphql/device';
import { DeviceListDocument } from '~/page/device-list';
import { renderWithApollo } from '~/test-utils';

import { DeviceRow, DeviceRowFragment } from './index';

// DeviceRow renders a ConfirmModal (for delete), which calls the native
// <dialog> showModal/close methods jsdom does not implement.
beforeAll(() => {
  HTMLDialogElement.prototype.showModal = vi.fn(function (this: HTMLDialogElement) {
    this.setAttribute('open', '');
  });
  HTMLDialogElement.prototype.close = vi.fn(function (this: HTMLDialogElement) {
    this.removeAttribute('open');
  });
});

/**
 * A typed `DeviceRowFragmentFragment` VARIABLE, never an inline object
 * literal at a call site — see `component/my-progress-row/index.test.tsx`'s
 * identical note on why a fresh literal fails TypeScript's excess-property
 * check against `DeviceRow`'s MASKED `device` prop, and why
 * `makeFragmentData` is the sanctioned cast back to that masked type.
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
  // `??` would collapse an explicit `null` override back to the default —
  // `'coverWidth' in overrides` is what lets a test opt into `null`.
  coverWidth: 'coverWidth' in overrides ? overrides.coverWidth! : 300,
  coverHeight: 'coverHeight' in overrides ? overrides.coverHeight! : 400,
  coverFit: overrides.coverFit ?? 'CONTAIN',
  bwCover: overrides.bwCover ?? false,
  simplify: overrides.simplify ?? true,
});

// Writes the row into a REAL, normalized `InMemoryCache` (via `writeQuery`,
// not a bare `writeFragment` shortcut) so `Device:<id>` genuinely exists as
// an entity before a delete test runs — otherwise `cache.evict` would be
// evicting nothing, and an assertion that the entity is gone would pass
// vacuously whether or not the eviction code ran at all.
const seedDeviceEntity = (client: ApolloClient, row: DeviceRowFragmentFragment) =>
  client.writeQuery({
    query: DeviceListDocument,
    data: { __typename: 'Query', viewer: { __typename: 'Viewer', devices: [row] } },
  });

const deleteSuccessMock = (
  deviceId: string
): MockedResponse<DeviceDeleteMutation, DeviceDeleteMutationVariables> => ({
  request: { query: DeviceDeleteDocument, variables: { input: { deviceId } } },
  result: {
    data: {
      __typename: 'Mutation',
      deviceDelete: { __typename: 'DeviceDeletePayload', deletedDeviceId: deviceId },
    },
  },
});

const clickConfirmDelete = async (user: ReturnType<typeof userEvent.setup>) => {
  await user.click(screen.getByRole('button', { name: /^delete$/i }));
  const deleteButtons = screen.getAllByRole('button', { name: /^delete$/i });
  await user.click(deleteButtons[deleteButtons.length - 1]);
};

describe('DeviceRow', () => {
  it('renders the device metadata, including the formatted cover fit', () => {
    renderWithApollo(<DeviceRow device={makeFragmentData(device(), DeviceRowFragment)} />);

    // "Kindle" appears twice (the Card title AND the always-rendered
    // confirm modal's body text), so this asserts on the count rather than
    // a single unambiguous match.
    expect(screen.getAllByText('Kindle').length).toBeGreaterThanOrEqual(1);
    expect(screen.getByText('kindle')).toBeInTheDocument();
    expect(screen.getByText('300×400')).toBeInTheDocument();
    // The hazard this task exists to guard: `coverFit` arrives SCREAMING_CASE
    // (`'CONTAIN'`) off the unmasked fragment — a naive title-case formatter
    // would render it unchanged instead of `Contain`.
    expect(screen.getByText('Contain')).toBeInTheDocument();
    expect(screen.getByText('No')).toBeInTheDocument(); // Grayscale Cover
    expect(screen.getByText('Yes')).toBeInTheDocument(); // Simplify
  });

  it('shows "Auto" for cover size when width/height are null', () => {
    renderWithApollo(
      <DeviceRow
        device={makeFragmentData(
          device({ coverWidth: null, coverHeight: null }),
          DeviceRowFragment
        )}
      />
    );
    expect(screen.getByText('Auto')).toBeInTheDocument();
  });

  it('switches to the edit form, pre-filled, when Edit is clicked', async () => {
    const user = userEvent.setup();
    renderWithApollo(<DeviceRow device={makeFragmentData(device(), DeviceRowFragment)} />);

    await user.click(screen.getByRole('button', { name: /edit/i }));

    const nameInput = screen.getByDisplayValue('Kindle') as HTMLInputElement;
    expect(nameInput).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Save' })).toBeInTheDocument();
  });

  it('opens the confirm modal when Delete is clicked, without sending a mutation', async () => {
    const user = userEvent.setup();
    renderWithApollo(<DeviceRow device={makeFragmentData(device(), DeviceRowFragment)} />);

    await user.click(screen.getByRole('button', { name: /^delete$/i }));
    expect(screen.getByText(/delete device permanently\?/i)).toBeInTheDocument();
  });

  // Fixture-gap requirement: the entity is seeded into a REAL InMemoryCache
  // and `DeviceDeleteDocument` is sent for real (via `MockLink`) — so this
  // proves the row wires its unmasked `unmasked.id` into the mutation, and
  // that the `update` callback evicts the entity from the cache. `MockLink`
  // throws on an unmatched operation, so a call carrying the wrong id would
  // fail to match `deleteSuccessMock` and surface as an error here.
  it('sends DeviceDelete with the device id and evicts it from the cache when confirmed', async () => {
    const user = userEvent.setup();
    const row = device({ id: 'd1' });
    const { client } = renderWithApollo(
      <DeviceRow device={makeFragmentData(row, DeviceRowFragment)} />,
      { mocks: [deleteSuccessMock('d1')] }
    );
    seedDeviceEntity(client, row);

    await clickConfirmDelete(user);

    await waitFor(() => {
      const extracted = client.cache.extract() as NormalizedCacheObject;
      expect(Object.keys(extracted)).not.toContain('Device:d1');
    });
  });
});
