import type { MockedResponse } from '@apollo/client/testing';
import { screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, beforeAll, beforeEach, vi } from 'vitest';

import type { BookRequestRowFragmentFragment, UserRequestListQuery } from '~/gql/graphql';
import { BookRequestDeleteDocument, UserRequestListDocument } from '~/graphql/book-request';
import { renderWithApollo } from '~/test-utils';

import { UserRequestList } from './index';

let queryCallCount = 0;
let capturedVariables: { userId?: string; after?: string | null } | undefined;

// `BookRequestRow` (Task 14) mounts `ConfirmModal`/`LinkExistingBookModal`
// unconditionally once `canResolve` is true — both `<dialog>`-backed
// (`control/use-modal-dialog`). jsdom has no real `<dialog>` implementation;
// same stub `link-progress-modal/index.test.tsx` installs.
beforeAll(() => {
  HTMLDialogElement.prototype.showModal = vi.fn(function (this: HTMLDialogElement) {
    this.setAttribute('open', '');
  });
  HTMLDialogElement.prototype.close = vi.fn(function (this: HTMLDialogElement) {
    this.removeAttribute('open');
  });
});

beforeEach(() => {
  queryCallCount = 0;
  capturedVariables = undefined;
});

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

const connection = (
  userId: string,
  rows: BookRequestRowFragmentFragment[],
  { libraryId = 'lib-1', username = 'reader' }: { libraryId?: string; username?: string } = {}
): UserRequestListQuery => ({
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
});

// The counting VARIABLE-MATCHER form (`test-utils.tsx`'s own standing note:
// "MockLink does NOT throw on an unmatched request" — a synchronous
// assertion after a QUERY fires observes nothing on its own, so "this
// operation must not fire" has to be pinned by counting matcher
// invocations, not by omitting a mock). The mock stays QUEUED even for the
// `skip: true` case below — an empty `mocks` array would never consult the
// matcher at all, making the counter pass vacuously.
const listMock = (userId: string, rows: BookRequestRowFragmentFragment[]): MockedResponse => ({
  request: {
    query: UserRequestListDocument,
    variables: (vars: { userId: string; after?: string | null }) => {
      queryCallCount += 1;
      capturedVariables = vars;
      return true;
    },
  },
  result: { data: connection(userId, rows) },
});

const renderList = ({
  userId = 'VXNlcjoxMjM=',
  requests = [],
  skip = false,
  extraMocks = [],
}: {
  userId?: string;
  requests?: BookRequestRowFragmentFragment[];
  skip?: boolean;
  extraMocks?: MockedResponse[];
} = {}) => {
  const mocks: MockedResponse[] = [listMock(userId, requests), ...extraMocks];
  const rendered = renderWithApollo(<UserRequestList userId={userId} skip={skip} />, { mocks });
  return {
    ...rendered,
    user: userEvent.setup(),
    queryCount: () => queryCallCount,
    variables: () => capturedVariables,
  };
};

describe('UserRequestList', () => {
  it('renders the target user requests', async () => {
    renderList({ requests: [requestRow({ title: 'Dune' })] });
    expect(await screen.findByText('Dune')).toBeInTheDocument();
  });

  it('fetches nothing while skipped', () => {
    const { queryCount } = renderList({ skip: true });
    expect(queryCount()).toBe(0);
  });

  it('shows an empty state', async () => {
    renderList({ requests: [] });
    expect(await screen.findByText(/no requests/i)).toBeInTheDocument();
  });

  it('roots at the target user, not the viewer', async () => {
    const { variables } = renderList({ userId: 'VXNlcjphbGljZQ==', requests: [] });
    await waitFor(() => expect(variables()).toMatchObject({ userId: 'VXNlcjphbGljZQ==' }));
  });

  // Finding 4 of the final review: `handleDelete` used to run `runDelete`
  // with no `try`/`catch`, so a rejection (e.g. a dropped connection) was
  // both a silent no-op for the user and an unhandled promise rejection.
  it('shows an error message when withdrawing fails', async () => {
    const { user } = renderList({
      requests: [requestRow({ id: 'req-1', title: 'Dune', status: 'PENDING' })],
      extraMocks: [
        {
          request: { query: BookRequestDeleteDocument, variables: { id: 'req-1' } },
          error: new Error('Network error'),
        },
      ],
    });
    await screen.findByText('Dune');

    await user.click(screen.getByRole('button', { name: /withdraw/i }));

    expect(await screen.findByText(/failed to delete request|network error/i)).toBeInTheDocument();
  });
});
