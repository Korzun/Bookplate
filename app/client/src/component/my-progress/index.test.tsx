import { screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';

import { MyProgressListDocument } from '~/component/my-progress-content';
import type { MyProgressListQuery, ProgressRowFragmentFragment } from '~/gql/graphql';
import { MyProgressCountDocument } from '~/graphql/progress';
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
          edges: edges.map((e) => ({
            __typename: 'LibraryProgressConnectionEdge' as const,
            ...e,
          })),
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

  // Fix round 2: `MockLink`'s unmatched-operation path resolves through the
  // Observable as an ASYNC GraphQL error (`throwError(...)`,
  // `mockLink.js`), not a synchronous throw that aborts the test — so if
  // `MyProgressContent` were wrongly mounted while collapsed, it would not
  // crash this test. It would instead see `useMyProgressList`'s `error` set
  // and `rows.length === 0`, and render "Error loading progress"
  // (`my-progress-content/index.tsx`'s error branch) rather than "No
  // progress synced" (the empty branch) — so asserting only the LATTER's
  // absence, as an earlier version of this test did, passed whether the bug
  // existed or not: neither string is ever reachable from an empty
  // `mocks: [countMock(2)]` array regardless of whether `MyProgressContent`
  // mounted.
  //
  // What's actually load-bearing: `Card` does not render its children into
  // the tree AT ALL while collapsed (`visibleChildren = isCollapsible ?
  // (isExpanded ? children : null) : children`, `component/card/index.tsx`)
  // — so the `<div className={styles.content}>` THIS component (`MyProgress`,
  // not `MyProgressContent`) wraps around `<MyProgressContent />` never
  // mounts either. Querying for that wrapper's presence, rather than for
  // any one of `MyProgressContent`'s several possible rendered strings
  // (loading / error / empty / rows), catches EVERY one of those cases at
  // once: if `MyProgressContent` were wrongly mounted, this element would
  // exist (containing "Error loading progress" per the reasoning above,
  // but this assertion does not even need to know which string) and the
  // test would fail.
  it('fetches no rows while the card is collapsed', async () => {
    const { container } = renderWithApollo(<MyProgress />, {
      mocks: [countMock(2)],
    });
    await waitFor(() => expect(screen.getByText('2 books synced')).toBeInTheDocument());
    expect(container.querySelector('[class*="content"]')).not.toBeInTheDocument();
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
