import type { MockedResponse } from '@apollo/client/testing';
import { screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { print } from 'graphql';
import { describe, expect, it, beforeAll, beforeEach, vi } from 'vitest';

import type { BookRequestRowFragmentFragment, UserRequestListQuery } from '~/gql/graphql';
import { UserRequestListDocument } from '~/graphql/book-request';
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

  // Replaces "shows an error message when withdrawing fails". That test
  // covered the admin's own delete pipeline, which is gone: deleting a request
  // belongs to the reader who submitted it, so this list renders no delete
  // control and owns no delete mutation. The reader's equivalent failure path
  // is still covered, in `component/book-requests-content`'s own suite.
  it('offers the admin no way to delete a request', async () => {
    renderList({
      requests: [requestRow({ id: 'req-1', title: 'Dune', status: 'PENDING' })],
    });
    await screen.findByText('Dune');

    expect(screen.queryByRole('button', { name: /withdraw/i })).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /clear/i })).not.toBeInTheDocument();
    // Positive control: the admin's own actions ARE rendered, so this cannot
    // pass against a list that failed to render its rows at all.
    expect(screen.getByRole('button', { name: 'Link existing book' })).toBeInTheDocument();
  });
});

/**
 * The admin's list is a work queue: a resolved request is not waiting on
 * anyone, so it does not belong here. The filter is a SERVER argument rather
 * than a client-side `.filter()` because a reader accumulates resolved
 * requests against a cap of ten open ones — a page of 20 can be entirely
 * resolved, and filtering after the fetch would show an empty list while
 * requests were genuinely pending.
 */
describe('UserRequestList — pending only', () => {
  it('asks the server for pending requests only', () => {
    // A LITERAL in the document, not a variable: this list is always pending,
    // and a variable would advertise a variability that does not exist. The
    // filtering itself is the server's, pinned by
    // `schema/book-request/model.test.ts`; what belongs here is the contract
    // that this document asks for it at all.
    expect(print(UserRequestListDocument)).toMatch(/bookRequests\([^)]*status:\s*PENDING/);
  });
});
