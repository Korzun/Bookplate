import { screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';

import type { MyProgressListQuery, ProgressRowFragmentFragment } from '~/gql/graphql';
import { MyProgressCountDocument, MyProgressListDocument } from '~/graphql/progress';
import { renderWithApollo } from '~/test-utils';

import { MyProgress } from './index';

const LIBRARY_ID = 'LIB-1';
const PAGE_SIZE = 50;

vi.mock('~/provider/library-target', () => ({
  useCurrentLibraryId: () => ({ libraryId: LIBRARY_ID, loading: false }),
}));

const countMock = (progressCount: number) => ({
  request: { query: MyProgressCountDocument },
  result: {
    data: {
      __typename: 'Query' as const,
      viewer: {
        __typename: 'Viewer' as const,
        user: { __typename: 'User' as const, id: 'user-1', progressCount },
      },
    },
  },
});

const adminCountMock = () => ({
  request: { query: MyProgressCountDocument },
  result: {
    data: {
      __typename: 'Query' as const,
      viewer: { __typename: 'Viewer' as const, user: null },
    },
  },
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

const listMock = (
  edges: { cursor: string; node: ProgressRowFragmentFragment }[],
  pageInfo: { hasNextPage: boolean; endCursor: string | null }
) => ({
  request: {
    query: MyProgressListDocument,
    variables: { libraryId: LIBRARY_ID, first: PAGE_SIZE },
  },
  result: {
    data: {
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
    } satisfies MyProgressListQuery,
  },
});

describe('MyProgress', () => {
  it('shows the synced count in the subtitle once the count query resolves', async () => {
    renderWithApollo(<MyProgress />, { mocks: [countMock(3)] });
    await waitFor(() => expect(screen.getByText('3 books synced')).toBeInTheDocument());
  });

  it('singularizes the subtitle for exactly one synced book', async () => {
    renderWithApollo(<MyProgress />, { mocks: [countMock(1)] });
    await waitFor(() => expect(screen.getByText('1 book synced')).toBeInTheDocument());
  });

  // Brief-required, verbatim mechanism: `MockLink` throws on an unmatched
  // operation, so supplying ONLY the count mock (no `MyProgressList` mock at
  // all) is what proves the list query never fired while collapsed — if
  // `MyProgressContent` were mounted regardless of `Card`'s collapsed state,
  // it would try to run `MyProgressList` against a `MockLink` with no
  // matching mock and throw "No more mocked responses", failing this test
  // loudly rather than passing vacuously.
  it('fetches no rows while the card is collapsed', async () => {
    renderWithApollo(<MyProgress />, { mocks: [countMock(2)] });
    await waitFor(() => expect(screen.getByText('2 books synced')).toBeInTheDocument());
    expect(screen.queryByText('No progress synced')).not.toBeInTheDocument();
  });

  // Brief-required: expanding the card (clicking its collapsible header)
  // mounts `MyProgressContent`, which fires `MyProgressList` for the first
  // time — this needs BOTH the count mock and a list mock supplied, unlike
  // the collapsed test above.
  it('fetches the first page when the card is expanded', async () => {
    renderWithApollo(<MyProgress />, {
      mocks: [
        countMock(1),
        listMock([{ cursor: 'c1', node: progressRow('p1', 'Dune') }], {
          hasNextPage: false,
          endCursor: 'c1',
        }),
      ],
    });
    await waitFor(() => expect(screen.getByText('1 book synced')).toBeInTheDocument());

    const user = userEvent.setup();
    await user.click(screen.getByRole('button', { name: /progress/i }));

    await waitFor(() => expect(screen.getByText('Dune')).toBeInTheDocument());
  });

  // Brief-required: `Viewer.user` is null for the config-based admin, which
  // has no `User` row (same reason `Viewer.library` is null for it, per
  // `graphql/progress.ts`'s doc comment) — mirrors what the REST screen
  // already did here (see this task's report for the trace): REST's
  // `useMyProgressList` returned an ERROR ("User not logged in") whenever
  // `username` was `undefined`, which it always is for the admin, and
  // `MyProgress`'s old render only destructured the first (data) tuple
  // element, so `progressList` stayed `undefined` and `subTitle` fell
  // through to its `undefined` branch — no subtitle, same outcome as here,
  // reached for the analogous reason under the new GraphQL shape.
  it('renders no subtitle when viewer.user is null (config admin)', async () => {
    renderWithApollo(<MyProgress />, { mocks: [adminCountMock()] });
    await waitFor(() => expect(screen.getByText('Progress')).toBeInTheDocument());
    expect(screen.queryByText(/synced/)).not.toBeInTheDocument();
  });
});
