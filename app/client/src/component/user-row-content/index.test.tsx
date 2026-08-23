import { screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';

import type { ProgressRowFragmentFragment, UserProgressListQuery } from '~/gql/graphql';
import { UserProgressListDocument } from '~/graphql/progress';
import { renderWithApollo } from '~/test-utils';

import { UserRowContent } from './index';

const USER_ID = 'USER-1';
const PAGE_SIZE = 50;

// `LinkProgressModal` is untouched by this task (still REST-backed) — stubbed
// exactly like `user-progress-row/index.test.tsx` does, so these tests never
// have to satisfy its own (unrelated) data requirements.
vi.mock('~/control', async (importOriginal) => {
  const actual = await importOriginal<typeof import('~/control')>();
  return {
    ...actual,
    LinkProgressModal: ({ isOpen }: { isOpen: boolean }) =>
      isOpen ? <div>link-progress-modal</div> : null,
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
        edges: edges.map((e) => ({ __typename: 'LibraryProgressConnectionEdge' as const, ...e })),
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

describe('UserRowContent', () => {
  it('shows a loading message while the first page is in flight', () => {
    renderWithApollo(<UserRowContent userId={USER_ID} username="alice" />, {
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
    renderWithApollo(<UserRowContent userId={USER_ID} username="alice" />, {
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
    renderWithApollo(<UserRowContent userId={USER_ID} username="alice" />, {
      mocks: [firstPageMock([], { hasNextPage: false, endCursor: null })],
    });

    await waitFor(() => expect(screen.getByText('No progress synced')).toBeInTheDocument());
  });

  it('shows an error message when the first page fails to load', async () => {
    renderWithApollo(<UserRowContent userId={USER_ID} username="alice" />, {
      mocks: [
        {
          request: {
            query: UserProgressListDocument,
            variables: { userId: USER_ID, first: PAGE_SIZE },
          },
          error: new Error('Network error'),
        },
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
    renderWithApollo(<UserRowContent userId={USER_ID} username="alice" />, {
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
    renderWithApollo(<UserRowContent userId={USER_ID} username="alice" />, {
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

  // Proves `UserRowContent` passes the ADMIN-HELD `userId` prop straight
  // through to `useUserProgressList` — not a `username`-derived id — by
  // using a deliberately different literal (`USER_ID` here, distinct from
  // `username="alice"`'s own value) as the ONLY variables `MockLink` will
  // match. If the component tried to resolve/send anything else, this mock
  // would go unmatched and `MockLink` would throw.
  it('roots the query on the userId prop, not the username', async () => {
    renderWithApollo(<UserRowContent userId={USER_ID} username="alice" />, {
      mocks: [
        firstPageMock([{ cursor: 'c1', node: progressRow('p1', 'Dune') }], {
          hasNextPage: false,
          endCursor: null,
        }),
      ],
    });

    await waitFor(() => expect(screen.getByText('Dune')).toBeInTheDocument());
  });
});
