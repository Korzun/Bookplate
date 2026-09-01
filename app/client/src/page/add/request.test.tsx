import type { MockedResponse } from '@apollo/client/testing';
import { screen } from '@testing-library/react';
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
import { LibraryTargetProvider } from '~/provider/library-target';
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
// opinion on.
const userRequestListMock = (
  userId: string,
  rows: BookRequestRowFragmentFragment[]
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
        username: 'bob',
        library: { __typename: 'Library', id: 'TGliOmJvYg==' },
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
    renderAddRequest({ isAdmin: true, targetLibraryId: undefined });
    expect(screen.queryByRole('list')).not.toBeInTheDocument();
  });
});
