import type { MockedResponse } from '@apollo/client/testing';
import { screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';

import type { BookRequestRowFragmentFragment, MyBookRequestListQuery } from '~/gql/graphql';
import { MyBookRequestListDocument } from '~/graphql/book-request';
import { renderWithApollo } from '~/test-utils';

import { AddRequestView } from './request';

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

function renderAddRequest({
  isAdmin,
  requests = [],
}: {
  isAdmin: boolean;
  requests?: Partial<BookRequestRowFragmentFragment>[];
}) {
  const rows = requests.map((r) => requestRow(r));
  return renderWithApollo(<AddRequestView />, {
    user: { username: 'reader', isAdmin },
    mocks: [listMock(rows)],
  });
}

describe('AddRequestView', () => {
  it("renders the reader's own request form and list", async () => {
    renderAddRequest({ isAdmin: false, requests: [{ title: 'Dune' }] });
    expect(await screen.findByText('Dune')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /request/i })).toBeInTheDocument();
  });

  // The admin branch is the next task's deliberate placeholder — see this
  // view's own doc comment. Pinned here so a future accidental render isn't
  // mistaken for "nothing to test yet".
  it('renders nothing for an admin (the next task fills this branch in)', () => {
    renderAddRequest({ isAdmin: true });
    expect(screen.queryByTestId('add-request-view')).not.toBeInTheDocument();
  });
});
