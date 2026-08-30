import type { MockedResponse } from '@apollo/client/testing';
import { screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it } from 'vitest';

import type {
  BookRequestCreateMutation,
  BookRequestRowFragmentFragment,
  MyBookRequestListQuery,
} from '~/gql/graphql';
import {
  BookRequestCreateDocument,
  BookRequestDeleteDocument,
  MyBookRequestListDocument,
} from '~/graphql/book-request';
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

const deleteMock = (id: string, deletedId: string = id): MockedResponse => ({
  request: { query: BookRequestDeleteDocument, variables: { id } },
  result: {
    data: {
      __typename: 'Mutation',
      bookRequestDelete: { __typename: 'BookRequestDeletePayload', deletedId },
    },
  },
});

const renderContent = ({
  requests = [],
  skip = false,
  createResult,
  listMockCount = 1,
  extraMocks = [],
}: {
  requests?: BookRequestRowFragmentFragment[];
  skip?: boolean;
  createResult?: BookRequestCreateMutation['bookRequestCreate'];
  /**
   * How many times `MyBookRequestListDocument` is queued to resolve.
   * `MockedResponse`s are single-use by default (`maxUsageCount: 1`), so a
   * test that expects the post-mutation `client.refetchQueries` refetch to
   * actually go out (rather than warn on an exhausted mock) queues 2.
   */
  listMockCount?: number;
  /** Extra queued mocks — e.g. a `deleteMock(...)` for a withdraw/clear test. */
  extraMocks?: MockedResponse[];
} = {}) => {
  const mocks: MockedResponse[] = [
    ...Array.from({ length: listMockCount }, () => listMock(requests)),
    createMock(createResult),
    ...extraMocks,
  ];
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

  it('creates a request, clears the form, and refetches the list', async () => {
    // `listMockCount: 2` — one for the initial mount, one for the refetch
    // `client.refetchQueries` fires after a confirmed `BookRequestCreatePayload`
    // (finding 2 of the task-12 review: plain normalization cannot insert a
    // brand-new row into an already-cached connection, so this component
    // refetches `MyBookRequestListDocument` explicitly instead).
    const { user, createCalls, container, queryCount } = renderContent({
      requests: [],
      listMockCount: 2,
    });
    await screen.findByText(/no requests yet/i);
    expect(queryCount()).toBe(1);

    await user.type(titleInput(container), 'Dune');
    await user.type(authorInput(container), 'Frank Herbert');
    await user.click(screen.getByRole('button', { name: /request/i }));

    await waitFor(() => expect(createCalls()).toHaveLength(1));
    expect(createCalls()[0].input).toMatchObject({ title: 'Dune', author: 'Frank Herbert' });
    await waitFor(() => expect(titleInput(container)).toHaveValue(''));
    // Proves the list query was RE-EXECUTED, not merely left to stale
    // normalization: `listMock` is single-use, so a second invocation only
    // resolves if this component actually issued a second network request.
    await waitFor(() => expect(queryCount()).toBe(2));
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

  // Finding 2 of the task-12 review, delete half: withdrawing/clearing a
  // request changes `pendingBookRequestCount` too (a server-computed
  // `t.relationCount`, not something a client-side cache eviction can
  // decrement), so a successful delete refetches the list the same way a
  // successful create does. `MyBookRequestCountDocument` itself is not
  // mounted anywhere in this component-only render, so its own refetch is a
  // harmless no-op here (`client.refetchQueries({ include: [...] })` only
  // refetches ACTIVE queries) — covered instead by `BookRequests`'s own
  // count-query wiring; this test pins the list-refetch half, which IS
  // observable from this component alone.
  it('refetches the list after withdrawing a request', async () => {
    const { user, queryCount } = renderContent({
      requests: [requestRow({ id: 'req-1', title: 'Dune' })],
      listMockCount: 2,
      extraMocks: [deleteMock('req-1')],
    });
    await screen.findByText('Dune');
    expect(queryCount()).toBe(1);

    await user.click(screen.getByRole('button', { name: /withdraw/i }));

    await waitFor(() => expect(queryCount()).toBe(2));
  });

  // Finding 4 of the final review: `handleDelete` used to run `runDelete`
  // with no `try`/`catch`, so a rejection (e.g. a dropped connection) was
  // both a silent no-op for the user and an unhandled promise rejection.
  // `handleSubmit`'s `formError` above is the house pattern this mirrors.
  it('shows an error message when withdrawing fails', async () => {
    const { user } = renderContent({
      requests: [requestRow({ id: 'req-1', title: 'Dune' })],
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
