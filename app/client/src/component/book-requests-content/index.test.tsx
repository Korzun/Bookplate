import type { MockedResponse } from '@apollo/client/testing';
import { screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it } from 'vitest';

import type {
  BookRequestCreateMutation,
  BookRequestRowFragmentFragment,
  MyBookRequestListQuery,
} from '~/gql/graphql';
import { BookRequestCreateDocument, MyBookRequestListDocument } from '~/graphql/book-request';
import { renderWithApollo } from '~/test-utils';

import { BookRequestsContent } from './index';

// Neither `getByLabelText` nor an `id`/`htmlFor` pairing is available here:
// `control/text-input` and `control/text-area` render a bare sibling
// `<label>` with no `htmlFor`, never wired to their `<input>`/`<textarea>` —
// the same reason `component/device-form/index.test.tsx` locates its own
// text fields via `container.querySelector('input[name="..."]')` rather
// than `getByLabelText`. Followed here for the same fields, not invented
// for this file.
const titleInput = (container: HTMLElement) =>
  container.querySelector('input[name="title"]') as HTMLInputElement;
const authorInput = (container: HTMLElement) =>
  container.querySelector('input[name="author"]') as HTMLInputElement;

let listCallCount = 0;
let createCallLog: { input: unknown }[] = [];

beforeEach(() => {
  listCallCount = 0;
  createCallLog = [];
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

const connection = (rows: BookRequestRowFragmentFragment[]): MyBookRequestListQuery => ({
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
});

// The counting VARIABLE-MATCHER form (`test-utils.tsx`'s own standing note:
// "MockLink does NOT throw on an unmatched request" — a synchronous
// assertion after a QUERY fires observes nothing on its own, so "this
// operation must not fire" has to be pinned by counting matcher
// invocations, not by omitting a mock). The mock stays QUEUED even for the
// `skip: true` case below — an empty `mocks` array would never consult the
// matcher at all, making the counter pass vacuously.
const listMock = (rows: BookRequestRowFragmentFragment[]): MockedResponse => ({
  request: {
    query: MyBookRequestListDocument,
    variables: () => {
      listCallCount += 1;
      return true;
    },
  },
  result: { data: connection(rows) },
});

const successPayload = (row: BookRequestRowFragmentFragment) => ({
  __typename: 'BookRequestCreatePayload' as const,
  bookRequest: row,
});

const createMock = (
  result: BookRequestCreateMutation['bookRequestCreate'] = successPayload(
    requestRow({ id: 'req-new' })
  )
): MockedResponse => ({
  request: {
    query: BookRequestCreateDocument,
    variables: (vars: { input: unknown }) => {
      createCallLog.push({ input: vars.input });
      return true;
    },
  },
  result: { data: { __typename: 'Mutation', bookRequestCreate: result } },
});

const renderContent = ({
  requests = [],
  skip = false,
  createResult,
}: {
  requests?: BookRequestRowFragmentFragment[];
  skip?: boolean;
  createResult?: BookRequestCreateMutation['bookRequestCreate'];
} = {}) => {
  const mocks: MockedResponse[] = [listMock(requests), createMock(createResult)];
  const rendered = renderWithApollo(<BookRequestsContent skip={skip} />, { mocks });
  const user = userEvent.setup();
  return {
    ...rendered,
    user,
    createCalls: () => createCallLog,
    queryCount: () => listCallCount,
  };
};

describe('BookRequestsContent', () => {
  it('renders the reader own requests', async () => {
    renderContent({
      requests: [
        requestRow({ id: 'r1', title: 'Dune' }),
        requestRow({ id: 'r2', title: 'Neuromancer' }),
      ],
    });
    expect(await screen.findByText('Dune')).toBeInTheDocument();
    expect(screen.getByText('Neuromancer')).toBeInTheDocument();
  });

  it('fetches nothing while skipped', () => {
    const { queryCount } = renderContent({ skip: true });
    expect(queryCount()).toBe(0);
  });

  it('creates a request and clears the form', async () => {
    const { user, createCalls, container } = renderContent({ requests: [] });
    await screen.findByText(/no requests yet/i);

    await user.type(titleInput(container), 'Dune');
    await user.type(authorInput(container), 'Frank Herbert');
    await user.click(screen.getByRole('button', { name: /request/i }));

    await waitFor(() => expect(createCalls()).toHaveLength(1));
    expect(createCalls()[0].input).toMatchObject({ title: 'Dune', author: 'Frank Herbert' });
    await waitFor(() => expect(titleInput(container)).toHaveValue(''));
  });

  it('will not submit without both title and author', async () => {
    const { user, createCalls, container } = renderContent({ requests: [] });
    await screen.findByText(/no requests yet/i);

    await user.type(titleInput(container), 'Dune');
    await user.click(screen.getByRole('button', { name: /request/i }));

    expect(createCalls()).toHaveLength(0);
    expect(screen.getByText(/author is required/i)).toBeInTheDocument();
  });

  it('surfaces the cap', async () => {
    const { user, container } = renderContent({
      requests: [],
      createResult: { __typename: 'BookRequestLimitExceededError', message: 'Too many', limit: 10 },
    });
    await screen.findByText(/no requests yet/i);

    await user.type(titleInput(container), 'Dune');
    await user.type(authorInput(container), 'Frank Herbert');
    await user.click(screen.getByRole('button', { name: /request/i }));

    expect(await screen.findByText('Too many')).toBeInTheDocument();
  });

  it('surfaces a duplicate', async () => {
    const { user, container } = renderContent({
      requests: [],
      createResult: {
        __typename: 'DuplicateBookRequestError',
        message: 'You have already requested this book.',
        existingRequestId: 'req-1',
      },
    });
    await screen.findByText(/no requests yet/i);

    await user.type(titleInput(container), 'Dune');
    await user.type(authorInput(container), 'Frank Herbert');
    await user.click(screen.getByRole('button', { name: /request/i }));

    expect(await screen.findByText(/already requested/i)).toBeInTheDocument();
  });

  it('shows the empty state with the form still available', async () => {
    const { container } = renderContent({ requests: [] });
    expect(await screen.findByText(/no requests yet/i)).toBeInTheDocument();
    expect(titleInput(container)).toBeInTheDocument();
  });
});
