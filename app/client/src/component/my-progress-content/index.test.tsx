import { screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';

import type { MyProgressListQuery, ProgressRowFragmentFragment } from '~/gql/graphql';
import { renderWithApollo } from '~/test-utils';

import { MyProgressContent, MyProgressListDocument } from './index';

const LIBRARY_ID = 'LIB-1';
const PAGE_SIZE = 50;

let currentLibraryId: string | undefined = LIBRARY_ID;
let currentLibraryIdLoading = false;

vi.mock('~/provider/library-target', () => ({
  useCurrentLibraryId: () => ({
    libraryId: currentLibraryId,
    loading: currentLibraryIdLoading,
  }),
}));

// `LinkProgressModal` stubbed to render its own `libraryId` prop (review
// Item 3, same shape as `user-row-content/index.test.tsx`'s Item 1 fix):
// `MyProgressContent` threads `useCurrentLibraryId()`'s own `libraryId`
// straight into `MyProgressRow`, and nothing else in this file's coverage
// notices if that threading silently breaks (dropping the prop, or wiring
// something else in its place). Deliberately NOT `importOriginal()` — see
// `component/user-progress-row/index.test.tsx`'s identical mock for the
// full circular-import trace this avoids (`~/control`'s real resolution
// reaches back into this component's own family via
// `~/provider/library-target`).
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
): MyProgressListQuery => ({
  __typename: 'Query',
  node: {
    __typename: 'Library',
    id: LIBRARY_ID,
    progress: {
      __typename: 'LibraryProgressConnection',
      edges: edges.map((e) => ({
        __typename: 'LibraryProgressConnectionEdge' as const,
        ...e,
      })),
      pageInfo: { __typename: 'PageInfo', ...pageInfo },
    },
  },
});

const firstPageMock = (
  edges: { cursor: string; node: ProgressRowFragmentFragment }[],
  pageInfo: { hasNextPage: boolean; endCursor: string | null }
) => ({
  request: {
    query: MyProgressListDocument,
    variables: { libraryId: LIBRARY_ID, first: PAGE_SIZE },
  },
  result: { data: connection(edges, pageInfo) },
});

const fetchMoreMock = (
  after: string,
  edges: { cursor: string; node: ProgressRowFragmentFragment }[],
  pageInfo: { hasNextPage: boolean; endCursor: string | null }
) => ({
  request: {
    query: MyProgressListDocument,
    variables: { libraryId: LIBRARY_ID, first: PAGE_SIZE, after },
  },
  result: { data: connection(edges, pageInfo) },
});

const fetchMoreErrorMock = (after: string) => ({
  request: {
    query: MyProgressListDocument,
    variables: { libraryId: LIBRARY_ID, first: PAGE_SIZE, after },
  },
  error: new Error('fetch more failed'),
});

describe('MyProgressContent', () => {
  it('shows a loading message while the first page is in flight', () => {
    renderWithApollo(<MyProgressContent skip={false} />, {
      mocks: [
        firstPageMock([{ cursor: 'c1', node: progressRow('p1', 'Dune') }], {
          hasNextPage: false,
          endCursor: null,
        }),
      ],
    });
    expect(screen.getByText('Loading...')).toBeInTheDocument();
  });

  it('renders a row per progress entry once loaded', async () => {
    renderWithApollo(<MyProgressContent skip={false} />, {
      mocks: [
        firstPageMock(
          [
            { cursor: 'c1', node: progressRow('p1', 'Dune') },
            { cursor: 'c2', node: progressRow('p2', 'The Great Gatsby') },
          ],
          { hasNextPage: false, endCursor: 'c2' }
        ),
      ],
    });

    await waitFor(() => expect(screen.getByText('Dune')).toBeInTheDocument());
    expect(screen.getByText('The Great Gatsby')).toBeInTheDocument();
  });

  it('shows the empty message when there is no synced progress', async () => {
    renderWithApollo(<MyProgressContent skip={false} />, {
      mocks: [firstPageMock([], { hasNextPage: false, endCursor: null })],
    });

    await waitFor(() => expect(screen.getByText('No progress synced')).toBeInTheDocument());
  });

  it('shows an error message when the first page fails to load', async () => {
    renderWithApollo(<MyProgressContent skip={false} />, {
      mocks: [
        {
          request: {
            query: MyProgressListDocument,
            variables: { libraryId: LIBRARY_ID, first: PAGE_SIZE },
          },
          error: new Error('Network error'),
        },
      ],
    });

    await waitFor(() => expect(screen.getByText('Error loading progress')).toBeInTheDocument());
  });

  // Brief-required: proves `fetchMore` REUSES page one instead of
  // re-issuing it — only ONE mock exists for the first-page variables, so
  // if `loadMore` accidentally refired that query, `MockLink` would throw
  // "No more mocked responses" for it rather than silently double-loading.
  it('grows the list via Load more without refetching page one', async () => {
    renderWithApollo(<MyProgressContent skip={false} />, {
      mocks: [
        firstPageMock([{ cursor: 'c1', node: progressRow('p1', 'Dune') }], {
          hasNextPage: true,
          endCursor: 'c1',
        }),
        fetchMoreMock('c1', [{ cursor: 'c2', node: progressRow('p2', 'The Great Gatsby') }], {
          hasNextPage: false,
          endCursor: 'c2',
        }),
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

  // Review round 1, Item 4: the deleted `use-my-progress-list.test.tsx`
  // ("keeps existing rows when loadMore fails, and offers a retry via
  // error") was the only thing pinning this COMPOSITION at this site —
  // `usePaginatedConnection`'s own suite covers the `error`/`edges`
  // contract in isolation, but not that `MyProgressContent`'s JSX actually
  // wires `error && rows.length > 0` to the retry block rather than, say,
  // replacing the list (the `rows.length === 0` branch above it).
  it('keeps existing rows and offers a retry when loadMore fails', async () => {
    renderWithApollo(<MyProgressContent skip={false} />, {
      mocks: [
        firstPageMock([{ cursor: 'c1', node: progressRow('p1', 'Dune') }], {
          hasNextPage: true,
          endCursor: 'c1',
        }),
        fetchMoreErrorMock('c1'),
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
    renderWithApollo(<MyProgressContent skip={false} />, {
      mocks: [
        firstPageMock([{ cursor: 'c1', node: progressRow('p1', 'Dune') }], {
          hasNextPage: false,
          endCursor: null,
        }),
      ],
    });

    await waitFor(() => expect(screen.getByText('Dune')).toBeInTheDocument());
    expect(screen.queryByRole('button', { name: /load more/i })).not.toBeInTheDocument();
  });

  // The behaviours below used to be pinned by the now-deleted
  // `use-my-progress-list.test.tsx` (Task 4 dissolved that hook into this
  // component). `skip` stays an explicit, required prop specifically so
  // these can gate the query directly, without depending on `Card`'s
  // mount/unmount timing (`component/my-progress`) as an implicit contract.

  it('does not query when there is no library id', () => {
    currentLibraryId = undefined;
    try {
      // No mocks are queued — but MockLink is NOT what makes this bite, and
      // an unmatched request would not fail this test. Verified against
      // `@apollo/client/testing/core/mocking/mockLink.js`: an unmatched
      // request is `console.warn`ed and returned as an observable that
      // errors ASYNCHRONOUSLY (`observeOn(asapScheduler)`) — never thrown —
      // and nothing in `setup.ts` promotes that warning to a failure.
      //
      // What bites is the SYNCHRONOUS assertion below: an unskipped query
      // puts the component in its loading state on the very first paint, so
      // `getByText('No progress synced')` throws
      // `TestingLibraryElementError` before any of that async machinery runs.
      // Seen-to-fail: forcing `skip: false` in `./index.tsx`'s
      // `usePaginatedConnection` call turns this red with exactly that
      // error.
      renderWithApollo(<MyProgressContent skip={false} />, { mocks: [] });

      expect(screen.getByText('No progress synced')).toBeInTheDocument();
    } finally {
      currentLibraryId = LIBRARY_ID;
    }
  });

  it('shows the loading message while useCurrentLibraryId itself is still resolving, even though the query is skipped', () => {
    currentLibraryId = undefined;
    currentLibraryIdLoading = true;
    try {
      renderWithApollo(<MyProgressContent skip={false} />, { mocks: [] });

      expect(screen.getByText('Loading...')).toBeInTheDocument();
    } finally {
      currentLibraryId = LIBRARY_ID;
      currentLibraryIdLoading = false;
    }
  });

  it('fetches nothing while skip is true, even with a valid library id', () => {
    // Same mechanism as "does not query when there is no library id" above:
    // the empty `mocks` array is not what fails this test (MockLink warns
    // asynchronously, it does not throw). The synchronous
    // `getByText('No progress synced')` below is — an unskipped query would
    // paint the loading state instead.
    renderWithApollo(<MyProgressContent skip />, { mocks: [] });

    expect(screen.getByText('No progress synced')).toBeInTheDocument();
  });

  // Load-bearing: without the `skip ? false : libraryIdLoading` gate in
  // `MyProgressContent`, this would show "Loading..." forever instead of
  // "No progress synced" — there is nothing mounted to show a loading state
  // for while `skip` is explicitly `true`, regardless of
  // `useCurrentLibraryId`'s own bootstrap state. Without this case,
  // `extraLoading: skip ? false : libraryIdLoading` could be simplified to
  // the unconditional `extraLoading: libraryIdLoading` and the suite would
  // stay green.
  it('reports no loading state while skip is true, even if useCurrentLibraryId is still resolving', () => {
    currentLibraryIdLoading = true;
    try {
      renderWithApollo(<MyProgressContent skip />, { mocks: [] });

      expect(screen.getByText('No progress synced')).toBeInTheDocument();
      expect(screen.queryByText('Loading...')).not.toBeInTheDocument();
    } finally {
      currentLibraryIdLoading = false;
    }
  });

  // Review round 1, Item 3: `libraryId` off `useCurrentLibraryId()` is
  // threaded straight into `MyProgressRow`'s `libraryId` prop (for
  // `LinkProgressModal`'s book picker). Lower risk than
  // `UserRowContent`'s equivalent (Item 1) — this value ALSO keys the
  // query mock above, so most mutations of it already break other tests —
  // but nothing here asserts the THREADING itself, so simply dropping the
  // prop at the `<MyProgressRow ... />` call site would pass silently.
  it("threads useCurrentLibraryId's libraryId into MyProgressRow's LinkProgressModal", async () => {
    renderWithApollo(<MyProgressContent skip={false} />, {
      mocks: [
        firstPageMock([{ cursor: 'c1', node: { ...progressRow('p1', 'Dune'), book: null } }], {
          hasNextPage: false,
          endCursor: null,
        }),
      ],
    });

    await waitFor(() =>
      expect(screen.getByRole('button', { name: /^link$/i })).toBeInTheDocument()
    );

    const user = userEvent.setup();
    await user.click(screen.getByRole('button', { name: /^link$/i }));

    expect(screen.getByText(`link-progress-modal:${LIBRARY_ID}`)).toBeInTheDocument();
  });
});
