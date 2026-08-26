import type { MockedResponse } from '@apollo/client/testing';
import { screen, waitFor } from '@testing-library/react';
import { beforeAll, describe, expect, it, vi } from 'vitest';

import { DeviceRowFragment } from '~/component/device-row';
import { makeFragmentData } from '~/gql';
import type { DeviceListQuery, UserListQuery } from '~/gql/graphql';
import { UserListDocument } from '~/graphql/user';
import { renderWithApollo } from '~/test-utils';

import { DeviceListDocument, DeviceListPage } from './index';

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

// The device row is spread through `...DeviceRowFragment` in
// `DeviceListDocument`, so `DeviceListQuery`'s `devices` entries are the
// MASKED type — a raw field literal fails TypeScript's excess-property
// check against it (see `component/my-progress-row/index.test.tsx`'s note
// on why `makeFragmentData` is the sanctioned cast back to that masked
// type).
const kindleRow = {
  // The query's document-transform adds an explicit sibling `__typename` to
  // every selection set, `devices` included — so the masked entry type is
  // `{ __typename: 'Device' } & FragmentType<...>`, not the bare masked
  // type `makeFragmentData` alone returns.
  __typename: 'Device' as const,
  ...makeFragmentData(
    {
      __typename: 'Device' as const,
      id: 'DEV-1',
      name: 'Kobo Clara',
      slug: 'kobo-clara',
      coverWidth: 300,
      coverHeight: 400,
      coverFit: 'CONTAIN' as const,
      bwCover: true,
      simplify: false,
    },
    DeviceRowFragment
  ),
};

const deviceListMock = (): MockedResponse<DeviceListQuery> => ({
  request: { query: DeviceListDocument },
  result: {
    data: {
      __typename: 'Query',
      viewer: { __typename: 'Viewer', devices: [kindleRow] },
    },
  },
});

// The always-present create `<DeviceForm />` calls `useUserList()`
// unconditionally (gated only by `isAdmin`, not by create/edit mode), which
// fires this query for the admin viewer this test renders as.
const userListMock = (): MockedResponse<UserListQuery> => ({
  request: { query: UserListDocument },
  result: {
    data: {
      __typename: 'Query',
      viewer: { __typename: 'Viewer', users: [] },
    } satisfies UserListQuery,
  },
});

describe('DeviceListPage', () => {
  it('renders a device row from the composed query', async () => {
    renderWithApollo(<DeviceListPage />, {
      mocks: [deviceListMock(), userListMock()],
      user: { username: 'a', isAdmin: true },
    });

    // "Kobo Clara" appears twice: the row's Card title AND the always-
    // rendered (but hidden) confirm-delete modal's body text.
    expect((await screen.findAllByText('Kobo Clara')).length).toBeGreaterThanOrEqual(1);
    // The enum map must survive colocation: raw `CONTAIN` would fail here.
    // This is the ONE real regression guard for this task's headline hazard
    // at the composed-query level (device-row/index.test.tsx covers it in
    // isolation too). "Contain" ALSO appears as the always-present create
    // form's default Cover Fit selection, which is why this asserts >= 2,
    // not >= 1 (task-1 review round, Finding 4): a bare >= 1 would still
    // pass off the create form's own "Contain" alone even if `DeviceRow`
    // rendered the raw, un-mapped `CONTAIN` — >= 2 requires BOTH the create
    // form's default AND the row's own formatted value to be present.
    await waitFor(() => expect(screen.getAllByText('Contain').length).toBeGreaterThanOrEqual(2));
    expect(screen.getByText('300×400')).toBeInTheDocument();
  });
});
