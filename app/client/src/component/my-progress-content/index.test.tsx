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
      // No mocks at all: if the component fired MyProgressList anyway,
      // MockLink would throw "No more mocked responses" and fail this test
      // loudly rather than let it pass vacuously.
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
    // No mocks at all: if the component fired MyProgressList anyway,
    // MockLink would throw "No more mocked responses" and fail this test
    // loudly.
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
});
