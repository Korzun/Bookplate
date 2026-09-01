import type { MockedResponse } from '@apollo/client/testing';
import { screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeAll, describe, expect, it, vi } from 'vitest';

import { UserRowFragment } from '~/component/user-row';
import { makeFragmentData } from '~/gql';
import type {
  BookRequestRowFragmentFragment,
  MyBookRequestListQuery,
  UserListQuery,
  UserRequestListQuery,
} from '~/gql/graphql';
import { MyBookRequestListDocument, UserRequestListDocument } from '~/graphql/book-request';
import { UserListDocument } from '~/graphql/user';
import { LibraryTargetProvider, useLibraryTarget } from '~/provider/library-target';
import { renderWithApollo } from '~/test-utils';

import { AddRequestView } from './request';

// `UserRequestList` (the admin branch) mounts `BookRequestRow` with
// `canResolve`, which mounts `ConfirmModal`/`LinkExistingBookModal`
// unconditionally — both `<dialog>`-backed (`control/use-modal-dialog`).
// jsdom has no real `<dialog>` implementation; same stub
// `component/user-request-list/index.test.tsx` installs for the identical
// reason.
beforeAll(() => {
  HTMLDialogElement.prototype.showModal = vi.fn(function (this: HTMLDialogElement) {
    this.setAttribute('open', '');
  });
  HTMLDialogElement.prototype.close = vi.fn(function (this: HTMLDialogElement) {
    this.removeAttribute('open');
  });
});

// Mirrors `provider/library-target/hook/use-with-target-user.test.tsx`'s own
// `STORAGE_KEY` — that hook's test file is the canonical place this literal
// is explained; not exported from the provider, so duplicated here the same
// way that file duplicates it rather than reaching into `provider.tsx`.
const STORAGE_KEY = 'library-target-id';

// Same shape as `component/book-requests-content/index.test.tsx`'s own
// fixtures — this view mounts that component unchanged, so its query
// contract (and the mocking pattern for it) is identical here.
const requestRow = (
  overrides: Partial<BookRequestRowFragmentFragment> = {}
): BookRequestRowFragmentFragment => ({
  __typename: 'BookRequest',
  id: overrides.id ?? 'req-1',
  title: overrides.title ?? 'Dune',
  author: overrides.author ?? 'Frank Herbert',
  note: overrides.note ?? '',
  status: overrides.status ?? 'PENDING',
  declineReason: overrides.declineReason ?? '',
  createdAt: '2026-01-01T00:00:00.000Z',
  resolvedAt: null,
  book: overrides.book ?? null,
});

const listMock = (
  rows: BookRequestRowFragmentFragment[]
): MockedResponse<MyBookRequestListQuery> => ({
  request: { query: MyBookRequestListDocument },
  result: {
    data: {
      __typename: 'Query',
      viewer: {
        __typename: 'Viewer',
        user: {
          __typename: 'User',
          id: 'user-1',
          bookRequests: {
            __typename: 'UserBookRequestsConnection',
            edges: rows.map((node, index) => ({
              __typename: 'UserBookRequestsConnectionEdge' as const,
              cursor: `c${index}`,
              node,
            })),
            pageInfo: { __typename: 'PageInfo', hasNextPage: false, endCursor: null },
          },
        },
      },
    },
  },
});

// Same factory as `use-with-target-user.test.tsx`'s own `user` (a raw field
// literal fails TypeScript's excess-property check against the masked type
// `UserListDocument` produces, so `makeFragmentData` is the sanctioned cast
// back to it).
const user = (overrides: { id?: string; username?: string; libraryId?: string }) => ({
  __typename: 'User' as const,
  ...makeFragmentData(
    {
      __typename: 'User' as const,
      id: overrides.id ?? 'u1',
      username: overrides.username ?? 'alice',
      progressCount: 0,
      pendingBookRequestCount: 0,
    },
    UserRowFragment
  ),
  library: { __typename: 'Library' as const, id: overrides.libraryId ?? 'LIB-ALICE' },
});

const userListMock = (users: ReturnType<typeof user>[]): MockedResponse<UserListQuery> => ({
  request: { query: UserListDocument },
  result: {
    data: { __typename: 'Query', viewer: { __typename: 'Viewer', users } },
  },
});

// `component/user-request-list/index.test.tsx`'s own `connection` shape.
// `variables` as a matcher function (always `true`) rather than an object —
// `usePaginatedConnection` also sends `after`, which this test has no
// opinion on. `username`/`libraryId` are overridable (defaulting to the
// original hardcoded 'bob'/`TGliOmJvYg==`): this response's `user` normalizes
// into the SAME cache entity `UserListDocument`'s own `viewer.users` entries
// reference (both keyed by `User:<id>`), so a hardcoded username/library
// would silently corrupt a DIFFERENT user's already-cached row when this
// mock is used for more than one `userId` in the same test (as the
// switcher-target test below does).
const userRequestListMock = (
  userId: string,
  rows: BookRequestRowFragmentFragment[],
  { username = 'bob', libraryId = 'TGliOmJvYg==' }: { username?: string; libraryId?: string } = {}
): MockedResponse<UserRequestListQuery> => ({
  request: {
    query: UserRequestListDocument,
    variables: () => true,
  },
  result: {
    data: {
      __typename: 'Query',
      user: {
        __typename: 'User',
        id: userId,
        username,
        library: { __typename: 'Library', id: libraryId },
        bookRequests: {
          __typename: 'UserBookRequestsConnection',
          edges: rows.map((node, index) => ({
            __typename: 'UserBookRequestsConnectionEdge' as const,
            cursor: `c${index}`,
            node,
          })),
          pageInfo: { __typename: 'PageInfo', hasNextPage: false, endCursor: null },
        },
      },
    },
  },
});

afterEach(() => {
  localStorage.clear();
});

function renderAddRequest({
  isAdmin,
  requests = [],
  targetLibraryId,
  targetUserId,
}: {
  isAdmin: boolean;
  requests?: Partial<BookRequestRowFragmentFragment>[];
  /** Seeds `LibraryTargetProvider`'s `localStorage`-backed state — the real
   *  provider, not a mock, since `AddRequestView` now reaches it through
   *  `useWithTargetUser`. */
  targetLibraryId?: string;
  /** The row in `UserListDocument`'s response whose `library.id` matches
   *  `targetLibraryId` — only meaningful (and only mocked) alongside it. */
  targetUserId?: string;
}) {
  const rows = requests.map((r) => requestRow(r));

  if (targetLibraryId === undefined) {
    localStorage.removeItem(STORAGE_KEY);
  } else {
    localStorage.setItem(STORAGE_KEY, targetLibraryId);
  }

  const mocks: MockedResponse[] = [];
  if (!isAdmin) {
    mocks.push(listMock(rows));
  } else {
    const users =
      targetLibraryId !== undefined && targetUserId !== undefined
        ? [user({ id: targetUserId, username: 'bob', libraryId: targetLibraryId })]
        : [];
    mocks.push(userListMock(users));
    if (targetUserId !== undefined) {
      mocks.push(userRequestListMock(targetUserId, rows));
    }
  }

  return renderWithApollo(
    <LibraryTargetProvider>
      <AddRequestView />
    </LibraryTargetProvider>,
    { user: { username: 'reader', isAdmin }, mocks }
  );
}

describe('AddRequestView', () => {
  it("renders the reader's own request form and list", async () => {
    renderAddRequest({ isAdmin: false, requests: [{ title: 'Dune' }] });
    expect(await screen.findByText('Dune')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /request/i })).toBeInTheDocument();
  });

  it("renders the selected library's requests for an admin", async () => {
    renderAddRequest({
      isAdmin: true,
      targetLibraryId: 'TGliOmJvYg==',
      targetUserId: 'VXNlcjpib2I=',
      requests: [{ title: 'Neuromancer' }],
    });
    expect(await screen.findByText('Neuromancer')).toBeInTheDocument();
  });

  it('renders nothing for an admin with no library selected', () => {
    // Neither branch of `AddRequestView`/`UserRequestList` ever renders a
    // `list` role (rows and the empty state are plain divs), so
    // `queryByRole('list')` passes identically whether or not this guard
    // exists. `AddRequestView`'s admin branch returns `null` outright here
    // (`withTargetUser.userId === undefined`), so nothing at all mounts —
    // in particular `UserRequestList` never mounts, so none of its own
    // possible renders ("Loading…", "No requests yet", or a row) ever
    // appear. Asserting the container has NO text content is what actually
    // distinguishes this from the two tests above, both of which assert
    // real text DOES appear.
    const { container } = renderAddRequest({ isAdmin: true, targetLibraryId: undefined });
    expect(container).toHaveTextContent('');
  });

  it("shows the newly-selected user's requests when the switcher's target changes", async () => {
    // Spec §7: "changing the library changes whose requests appear, which is
    // the one genuinely new behaviour in this design and the test most worth
    // having." `renderAddRequest` above only ever mounts `AddRequestView` at
    // a FIXED target, so this test mounts a small harness alongside it, both
    // sharing one real `LibraryTargetProvider`, and drives the switch through
    // the same `useLibraryTarget` setter the real `LibrarySwitcher` calls —
    // proving the change actually reaches `UserRequestList` (its own
    // `resetKey` of `userId:skip` is what re-fetches on a new `userId`), not
    // just that `useWithTargetUser` recomputes in isolation.
    const bobId = 'VXNlcjpib2I=';
    const bobLibrary = 'TGliOmJvYg==';
    const carolId = 'VXNlcjpjYXJvbA==';
    const carolLibrary = 'TGliOmNhcm9s';

    localStorage.setItem(STORAGE_KEY, bobLibrary);

    const mocks: MockedResponse[] = [
      userListMock([
        user({ id: bobId, username: 'bob', libraryId: bobLibrary }),
        user({ id: carolId, username: 'carol', libraryId: carolLibrary }),
      ]),
      userRequestListMock(bobId, [requestRow({ title: 'Dune' })], {
        username: 'bob',
        libraryId: bobLibrary,
      }),
      userRequestListMock(carolId, [requestRow({ title: 'Neuromancer' })], {
        username: 'carol',
        libraryId: carolLibrary,
      }),
    ];

    function Harness() {
      const [, setTargetLibraryId] = useLibraryTarget();
      return (
        <>
          <button onClick={() => setTargetLibraryId(carolLibrary)}>Switch to carol</button>
          <AddRequestView />
        </>
      );
    }

    renderWithApollo(
      <LibraryTargetProvider>
        <Harness />
      </LibraryTargetProvider>,
      { user: { username: 'reader', isAdmin: true }, mocks }
    );

    expect(await screen.findByText('Dune')).toBeInTheDocument();

    await userEvent.click(screen.getByRole('button', { name: 'Switch to carol' }));

    expect(await screen.findByText('Neuromancer')).toBeInTheDocument();
    expect(screen.queryByText('Dune')).not.toBeInTheDocument();
  });
});
