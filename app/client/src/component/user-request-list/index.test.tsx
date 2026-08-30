import type { MockedResponse } from '@apollo/client/testing';
import { screen, waitFor } from '@testing-library/react';
import { describe, expect, it, beforeEach } from 'vitest';

import type { BookRequestRowFragmentFragment, UserRequestListQuery } from '~/gql/graphql';
import { UserRequestListDocument } from '~/graphql/book-request';
import { renderWithApollo } from '~/test-utils';

import { UserRequestList } from './index';

let queryCallCount = 0;
let capturedVariables: { userId?: string; after?: string | null } | undefined;

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
  rows: BookRequestRowFragmentFragment[]
): UserRequestListQuery => ({
  __typename: 'Query',
  user: {
    __typename: 'User',
    id: userId,
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
}: {
  userId?: string;
  requests?: BookRequestRowFragmentFragment[];
  skip?: boolean;
} = {}) => {
  const mocks: MockedResponse[] = [listMock(userId, requests)];
  const rendered = renderWithApollo(<UserRequestList userId={userId} skip={skip} />, { mocks });
  return {
    ...rendered,
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
});
