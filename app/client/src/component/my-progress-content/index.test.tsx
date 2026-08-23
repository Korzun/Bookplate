import { screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';

import type { MyProgressListQuery, ProgressRowFragmentFragment } from '~/gql/graphql';
import { MyProgressListDocument } from '~/graphql/progress';
import { renderWithApollo } from '~/test-utils';

import { MyProgressContent } from './index';

const LIBRARY_ID = 'LIB-1';
const PAGE_SIZE = 50;

vi.mock('~/provider/library-target', () => ({
  useCurrentLibraryId: () => ({ libraryId: LIBRARY_ID, loading: false }),
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
      edges: edges.map((e) => ({ __typename: 'LibraryProgressConnectionEdge' as const, ...e })),
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
    renderWithApollo(<MyProgressContent />, {
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
    renderWithApollo(<MyProgressContent />, {
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
    renderWithApollo(<MyProgressContent />, {
      mocks: [firstPageMock([], { hasNextPage: false, endCursor: null })],
    });

    await waitFor(() => expect(screen.getByText('No progress synced')).toBeInTheDocument());
  });

  it('shows an error message when the first page fails to load', async () => {
    renderWithApollo(<MyProgressContent />, {
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
    renderWithApollo(<MyProgressContent />, {
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
    renderWithApollo(<MyProgressContent />, {
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
});
