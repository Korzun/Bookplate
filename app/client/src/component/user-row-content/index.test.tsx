import { screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';

import type {
  ProgressRowFragmentFragment,
  UserProgressListQuery,
  UserRequestListQuery,
} from '~/gql/graphql';
import { UserRequestListDocument } from '~/graphql/book-request';
import { renderWithApollo } from '~/test-utils';

import { UserProgressListDocument, UserRowContent } from './index';

const USER_ID = 'USER-1';
const PAGE_SIZE = 50;

// `LinkProgressModal` is stubbed here exactly like `user-progress-row/index.test.tsx`
// does, so these tests never have to satisfy its own (unrelated) data
// requirements. The stub renders its own `libraryId` prop (review Item 1):
// `UserRowContent`'s `libraryId` is the one field it reaches PAST `select`
// into the raw `usePaginatedConnection` `data` escape hatch for (a sibling
// field, `user.library.id`, not part of the `progress` connection `select`
// sees) — unlike every other field this component threads through, it is
// not a passthrough of something `usePaginatedConnection` already computed,
// so nothing else here would notice if it silently broke.
//
// Deliberately NOT `importOriginal()` (an earlier version of this mock did,
// and it happened to be harmless only because no test here ever actually
// OPENED the link modal) — see `component/user-progress-row/index.test.tsx`'s
// identical mock for the full circular-import trace:
// `importOriginal()`'s real resolution of `~/control` reaches back into
// this component's own family (`user-row` -> `user-row-content` itself)
// through `~/provider/library-target` (a KEPT provider, out of scope to
// restructure), silently re-binding this row's own `~/control` import to
// the REAL `LinkProgressModal` instead of the stub the moment a test
// actually opens it (seen-to-fail: the Item-1 test below crashed with
// "element.showModal is not a function" — this file has no
// `HTMLDialogElement.prototype.showModal` stub, unlike files that render
// the real dialog on purpose — when this mock still called
// `importOriginal()`). `Button`/`ConfirmModal` are pulled from their own
// leaf subpaths instead, neither of which re-enters the cycle.
vi.mock('~/control', async () => {
  const { Button } = await import('~/control/button');
  const { ConfirmModal } = await import('~/control/confirm-modal');
  return {
    Button,
    ConfirmModal,
    LinkProgressModal: ({ isOpen, libraryId }: { isOpen: boolean; libraryId?: string }) =>
      isOpen ? <div>{`link-progress-modal:${libraryId}`}</div> : null,
  };
});

const progressRow = (id: string, title: string): ProgressRowFragmentFragment => ({
  __typename: 'Progress',
  id,
  document: `doc-${id}`,
  percentage: 0.5,
  currentChapter: 1,
  device: 'Kobo',
  timestamp: '2026-01-01T00:00:00.000Z',
  book: {
    __typename: 'Book',
    id: `book-${id}`,
    title,
    author: 'Author',
    hasCover: false,
    thumbnailUrl: '',
  },
});

const connection = (
  edges: { cursor: string; node: ProgressRowFragmentFragment }[],
  pageInfo: { hasNextPage: boolean; endCursor: string | null }
): UserProgressListQuery => ({
  __typename: 'Query',
  user: {
    __typename: 'User',
    id: USER_ID,
    library: {
      __typename: 'Library',
      id: 'lib-1',
      progress: {
        __typename: 'LibraryProgressConnection',
        edges: edges.map((e) => ({
          __typename: 'LibraryProgressConnectionEdge' as const,
          ...e,
        })),
        pageInfo: { __typename: 'PageInfo', ...pageInfo },
      },
    },
  },
});

const firstPageMock = (
  edges: { cursor: string; node: ProgressRowFragmentFragment }[],
  pageInfo: { hasNextPage: boolean; endCursor: string | null }
) => ({
  request: {
    query: UserProgressListDocument,
    variables: { userId: USER_ID, first: PAGE_SIZE },
  },
  result: { data: connection(edges, pageInfo) },
});

const fetchMoreMock = (
  after: string,
  edges: { cursor: string; node: ProgressRowFragmentFragment }[],
  pageInfo: { hasNextPage: boolean; endCursor: string | null }
) => ({
  request: {
    query: UserProgressListDocument,
    variables: { userId: USER_ID, first: PAGE_SIZE, after },
  },
  result: { data: connection(edges, pageInfo) },
});

const fetchMoreErrorMock = (after: string) => ({
  request: {
    query: UserProgressListDocument,
    variables: { userId: USER_ID, first: PAGE_SIZE, after },
  },
  error: new Error('fetch more failed'),
});

// `UserRowContent` also mounts `UserRequestList` (Task 13), a SEPARATE
// query rooted at the same `userId`. These tests are all about the
// PROGRESS half of this component, so this mock is queued alongside every
// progress mock below with an immediate empty result — otherwise
// `UserRequestList`'s own unmocked query would leave it stuck in a
// "Loading..." state that collides with the progress list's identical text
// in tests that assert on it synchronously (e.g. the very first test
// below).
const requestListMock = (userId: string = USER_ID) => ({
  request: {
    query: UserRequestListDocument,
    variables: { userId },
  },
  result: {
    data: {
      __typename: 'Query',
      user: {
        __typename: 'User',
        id: userId,
        bookRequests: {
          __typename: 'UserBookRequestsConnection',
          edges: [],
          pageInfo: { __typename: 'PageInfo', hasNextPage: false, endCursor: null },
        },
      },
    } satisfies UserRequestListQuery,
  },
});

describe('UserRowContent', () => {
  it('shows a loading message while the first page is in flight', () => {
    renderWithApollo(<UserRowContent userId={USER_ID} username="alice" skip={false} />, {
      mocks: [
        firstPageMock([{ cursor: 'c1', node: progressRow('p1', 'Dune') }], {
          hasNextPage: false,
          endCursor: null,
        }),
        requestListMock(),
      ],
    });
    // `UserRequestList` (Task 13) renders the SAME "Loading..." message for
    // its own, still-unresolved first page at this same synchronous instant
    // — so both loading states are present, not just the progress list's.
    expect(screen.getAllByText('Loading...').length).toBeGreaterThan(0);
  });

  it('renders a row per progress entry once loaded', async () => {
    renderWithApollo(<UserRowContent userId={USER_ID} username="alice" skip={false} />, {
      mocks: [
        firstPageMock(
          [
            { cursor: 'c1', node: progressRow('p1', 'Dune') },
            { cursor: 'c2', node: progressRow('p2', 'The Great Gatsby') },
          ],
          { hasNextPage: false, endCursor: 'c2' }
        ),
        requestListMock(),
      ],
    });

    await waitFor(() => expect(screen.getByText('Dune')).toBeInTheDocument());
    expect(screen.getByText('The Great Gatsby')).toBeInTheDocument();
  });

  it('shows the empty message when there is no synced progress', async () => {
    renderWithApollo(<UserRowContent userId={USER_ID} username="alice" skip={false} />, {
      mocks: [firstPageMock([], { hasNextPage: false, endCursor: null }), requestListMock()],
    });

    await waitFor(() => expect(screen.getByText('No progress synced')).toBeInTheDocument());
  });

  it('shows an error message when the first page fails to load', async () => {
    renderWithApollo(<UserRowContent userId={USER_ID} username="alice" skip={false} />, {
      mocks: [
        {
          request: {
            query: UserProgressListDocument,
            variables: { userId: USER_ID, first: PAGE_SIZE },
          },
          error: new Error('Network error'),
        },
        requestListMock(),
      ],
    });

    await waitFor(() =>
      expect(screen.getByText('Error loading user progress')).toBeInTheDocument()
    );
  });

  // Brief-required: proves `fetchMore` REUSES page one instead of
  // re-issuing it — only ONE mock exists for the first-page variables, so
  // if `loadMore` accidentally refired that query, `MockLink` would throw
  // "No more mocked responses" for it rather than silently double-loading.
  it('grows the list via Load more without refetching page one', async () => {
    renderWithApollo(<UserRowContent userId={USER_ID} username="alice" skip={false} />, {
      mocks: [
        firstPageMock([{ cursor: 'c1', node: progressRow('p1', 'Dune') }], {
          hasNextPage: true,
          endCursor: 'c1',
        }),
        fetchMoreMock('c1', [{ cursor: 'c2', node: progressRow('p2', 'The Great Gatsby') }], {
          hasNextPage: false,
          endCursor: 'c2',
        }),
        requestListMock(),
      ],
    });

    await waitFor(() => expect(screen.getByText('Dune')).toBeInTheDocument());
    expect(screen.queryByText('The Great Gatsby')).not.toBeInTheDocument();

    const user = userEvent.setup();
    await user.click(screen.getByRole('button', { name: /load more/i }));

    await waitFor(() => expect(screen.getByText('The Great Gatsby')).toBeInTheDocument());
    expect(screen.getByText('Dune')).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /load more/i })).not.toBeInTheDocument();
  });

  // Review round 1, Item 4: the deleted `use-user-progress-list.test.tsx`
  // ("keeps existing rows when loadMore fails, and offers a retry via
  // error") was the only thing pinning this COMPOSITION at this site — see
  // `my-progress-content/index.test.tsx`'s identical test for the full
  // rationale.
  it('keeps existing rows and offers a retry when loadMore fails', async () => {
    renderWithApollo(<UserRowContent userId={USER_ID} username="alice" skip={false} />, {
      mocks: [
        firstPageMock([{ cursor: 'c1', node: progressRow('p1', 'Dune') }], {
          hasNextPage: true,
          endCursor: 'c1',
        }),
        fetchMoreErrorMock('c1'),
        requestListMock(),
      ],
    });

    await waitFor(() => expect(screen.getByText('Dune')).toBeInTheDocument());

    const user = userEvent.setup();
    await user.click(screen.getByRole('button', { name: /load more/i }));

    await waitFor(() =>
      expect(screen.getByText('Failed to load more progress')).toBeInTheDocument()
    );
    expect(screen.getByText('Dune')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /^retry$/i })).toBeInTheDocument();
  });

  it('does not render a Load more affordance when there is no next page', async () => {
    renderWithApollo(<UserRowContent userId={USER_ID} username="alice" skip={false} />, {
      mocks: [
        firstPageMock([{ cursor: 'c1', node: progressRow('p1', 'Dune') }], {
          hasNextPage: false,
          endCursor: null,
        }),
        requestListMock(),
      ],
    });

    await waitFor(() => expect(screen.getByText('Dune')).toBeInTheDocument());
    expect(screen.queryByRole('button', { name: /load more/i })).not.toBeInTheDocument();
  });

  // Proves `UserRowContent` passes the ADMIN-HELD `userId` prop straight
  // through to the query — not a `username`-derived id — by using a
  // deliberately different literal (`USER_ID` here, distinct from
  // `username="alice"`'s own value) as the ONLY variables `MockLink` will
  // match. If the component tried to resolve/send anything else, this mock
  // would go unmatched and `MockLink` would throw.
  it('roots the query on the userId prop, not the username', async () => {
    renderWithApollo(<UserRowContent userId={USER_ID} username="alice" skip={false} />, {
      mocks: [
        firstPageMock([{ cursor: 'c1', node: progressRow('p1', 'Dune') }], {
          hasNextPage: false,
          endCursor: null,
        }),
        requestListMock(),
      ],
    });

    await waitFor(() => expect(screen.getByText('Dune')).toBeInTheDocument());
  });

  // Was previously pinned by the now-deleted `use-user-progress-list.test.tsx`
  // (Task 4 dissolved that hook into this component). `skip` stays an
  // explicit, required prop specifically so this can gate the query
  // directly, without depending on `Card`'s mount/unmount timing
  // (`component/user-row`) as an implicit contract.
  it('fetches nothing while skip is true, even with a valid user id', () => {
    // The empty `mocks` array is NOT what makes this bite: MockLink does not
    // throw on an unmatched request. Verified against
    // `@apollo/client/testing/core/mocking/mockLink.js` — it `console.warn`s
    // and returns an observable that errors ASYNCHRONOUSLY
    // (`observeOn(asapScheduler)`), and nothing in `setup.ts` promotes that
    // warning to a failure. The SYNCHRONOUS assertion below is the pin: an
    // unskipped query paints the loading state on the first render, so
    // `getByText('No progress synced')` throws `TestingLibraryElementError`.
    // Seen-to-fail: forcing `skip: false` in `./index.tsx`'s
    // `usePaginatedConnection` call turns this red with exactly that error.
    renderWithApollo(<UserRowContent userId={USER_ID} username="alice" skip />, { mocks: [] });

    expect(screen.getByText('No progress synced')).toBeInTheDocument();
  });

  // Review round 1, Item 1: `libraryId` is the one field `UserRowContent`
  // reaches past `usePaginatedConnection`'s `select` into raw `data` for —
  // `user.library.id`, a SIBLING of the `progress` connection `select`
  // itself only ever sees. Every other prop `UserProgressRow` receives is a
  // passthrough already exercised elsewhere; this one is not, so it needs
  // its own assertion. `LIBRARY_ID` here is a literal distinct from
  // anything else in this file (not `'lib-1'`, the `connection()` helper's
  // default) so a wrong value (e.g. `user.id` instead of `user.library.id`)
  // would show up as a mismatch, not a coincidental pass.
  it("threads the target user's library id from the query into UserProgressRow's LinkProgressModal", async () => {
    const DISTINCT_LIBRARY_ID = 'lib-distinct-99';
    const orphanRow: ProgressRowFragmentFragment = { ...progressRow('p1', 'Dune'), book: null };
    renderWithApollo(<UserRowContent userId={USER_ID} username="alice" skip={false} />, {
      mocks: [
        {
          request: {
            query: UserProgressListDocument,
            variables: { userId: USER_ID, first: PAGE_SIZE },
          },
          result: {
            data: {
              __typename: 'Query',
              user: {
                __typename: 'User',
                id: USER_ID,
                library: {
                  __typename: 'Library',
                  id: DISTINCT_LIBRARY_ID,
                  progress: {
                    __typename: 'LibraryProgressConnection',
                    edges: [
                      {
                        __typename: 'LibraryProgressConnectionEdge',
                        cursor: 'c1',
                        node: orphanRow,
                      },
                    ],
                    pageInfo: { __typename: 'PageInfo', hasNextPage: false, endCursor: null },
                  },
                },
              },
            } satisfies UserProgressListQuery,
          },
        },
        requestListMock(),
      ],
    });

    await waitFor(() =>
      expect(screen.getByRole('button', { name: /^link$/i })).toBeInTheDocument()
    );

    const user = userEvent.setup();
    await user.click(screen.getByRole('button', { name: /^link$/i }));

    expect(screen.getByText(`link-progress-modal:${DISTINCT_LIBRARY_ID}`)).toBeInTheDocument();
  });
});
