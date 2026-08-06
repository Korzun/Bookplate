import type { MockedResponse } from '@apollo/client/testing';
import { screen, waitFor } from '@testing-library/react';
import type { ReactNode } from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import type { LibraryFilter } from '~/gql/graphql';
import { LibraryEntriesDocument } from '~/graphql/library';
import { renderWithApollo } from '~/test-utils';

const LIBRARY_ID = 'LIB-1';
const PAGE_SIZE = 20;

let currentLibraryId: string | undefined = LIBRARY_ID;
let targetLibraryId: string | undefined = undefined;
let isAdminValue = false;
let userListValue: { username: string }[] = [];
let userListLoadingValue = false;

vi.mock('~/provider/auth', () => ({
  useIsAdmin: () => [isAdminValue],
}));

vi.mock('~/provider/user', () => ({
  useUserList: () => [userListValue, userListLoadingValue, false, undefined],
}));

vi.mock('~/provider/library-target', () => ({
  useCurrentLibraryId: () => ({ libraryId: currentLibraryId, loading: false }),
  useLibraryTarget: () => [targetLibraryId, vi.fn()],
}));

vi.mock('~/component/library-switcher', () => ({
  LibrarySwitcher: () => <div data-testid="library-switcher" />,
}));

// Page/SearchBar/SeriesRow/BookRowFromEntry are replaced with minimal
// stand-ins: this file is testing LibraryPage's own wiring (empty/error
// states, the edges -> row dispatch, the sentinel/retry plumbing), not the
// reshaped row components' own rendering (Task 7 already covers those) or
// SearchBar's UI (unrelated to this task).
vi.mock('~/component', () => ({
  Page: ({ children }: { children: ReactNode }) => <div>{children}</div>,
  SearchBar: () => <div data-testid="search-bar" />,
  SeriesRow: ({ series }: { series: { id: string } }) => <div>SERIES:{series.id}</div>,
  BookRowFromEntry: ({ book }: { book: { id: string } }) => <div>BOOK:{book.id}</div>,
}));

/**
 * Auto-intersects the moment `observe()` is called, so a test that renders a
 * sentinel (`hasNextPage: true`) drives `fetchNextPage` through the SAME
 * effect the real page uses, without a real IntersectionObserver
 * implementation (unavailable in jsdom).
 */
class AutoIntersectingObserver {
  constructor(private callback: IntersectionObserverCallback) {}
  observe = () => {
    this.callback(
      [{ isIntersecting: true } as IntersectionObserverEntry],
      this as unknown as IntersectionObserver
    );
  };
  unobserve = () => {};
  disconnect = () => {};
  takeRecords = () => [];
}

beforeEach(() => {
  currentLibraryId = LIBRARY_ID;
  targetLibraryId = undefined;
  isAdminValue = false;
  userListValue = [];
  userListLoadingValue = false;
  vi.stubGlobal('IntersectionObserver', AutoIntersectingObserver);
});

afterEach(() => {
  vi.unstubAllGlobals();
});

const bookEdge = (cursor: string, overrides: Record<string, unknown> = {}) => ({
  __typename: 'LibraryEntriesConnectionEdge' as const,
  cursor,
  node: {
    __typename: 'Book' as const,
    id: `BOOK-${cursor}`,
    title: 'Dune',
    author: 'Frank Herbert',
    seriesIndex: 0,
    hasCover: true,
    thumbnailUrl: '/thumb.jpg',
    progress: null,
    ...overrides,
  },
});

const seriesEdge = (cursor: string, overrides: Record<string, unknown> = {}) => ({
  __typename: 'LibraryEntriesConnectionEdge' as const,
  cursor,
  node: {
    __typename: 'Series' as const,
    id: `SERIES-${cursor}`,
    name: 'Dune Chronicles',
    author: 'Frank Herbert',
    bookCount: 6,
    ...overrides,
  },
});

const connection = (
  edges: (ReturnType<typeof bookEdge> | ReturnType<typeof seriesEdge>)[],
  pageInfo: { hasNextPage: boolean; endCursor: string | null }
) => ({
  node: {
    __typename: 'Library' as const,
    id: LIBRARY_ID,
    entries: {
      __typename: 'LibraryEntriesConnection' as const,
      edges,
      pageInfo: { __typename: 'PageInfo' as const, ...pageInfo },
    },
  },
});

/** Mirrors `toLibraryFilter`'s full-key output shape exactly, so MockLink's variable match doesn't depend on how `undefined` keys happen to compare against absent ones. */
const emptyFilter: LibraryFilter = {
  query: undefined,
  author: undefined,
  seriesName: undefined,
  subjects: undefined,
  status: undefined,
  entryType: undefined,
};

const firstPageMock = (
  edges: (ReturnType<typeof bookEdge> | ReturnType<typeof seriesEdge>)[],
  pageInfo: { hasNextPage: boolean; endCursor: string | null },
  filter: LibraryFilter = emptyFilter
) => ({
  request: {
    query: LibraryEntriesDocument,
    variables: { libraryId: LIBRARY_ID, first: PAGE_SIZE, filter },
  },
  result: { data: { __typename: 'Query' as const, ...connection(edges, pageInfo) } },
});

const fetchMoreErrorMock = (after: string, filter: LibraryFilter = emptyFilter) => ({
  request: {
    query: LibraryEntriesDocument,
    variables: { libraryId: LIBRARY_ID, first: PAGE_SIZE, after, filter },
  },
  error: new Error('fetch more failed'),
});

async function renderLibraryPage(mocks: MockedResponse[], initialEntries: string[] = ['/library']) {
  const { LibraryPage } = await import('./index');
  return renderWithApollo(<LibraryPage />, { mocks, initialEntries });
}

describe('LibraryPage', () => {
  it('renders "Select a library" for an admin with no selection', async () => {
    isAdminValue = true;
    currentLibraryId = undefined;
    targetLibraryId = undefined;
    userListValue = [{ username: 'alice' }];

    await renderLibraryPage([]);

    expect(screen.getByText('Select a library')).toBeTruthy();
    expect(screen.queryByText('No users registered')).toBeNull();
  });

  it('renders "No users registered" for an admin with no users', async () => {
    isAdminValue = true;
    currentLibraryId = undefined;
    targetLibraryId = undefined;
    userListValue = [];
    userListLoadingValue = false;

    await renderLibraryPage([]);

    expect(screen.getByText('No users registered')).toBeTruthy();
  });

  it('renders "Failed to load library" when the first page errors with no rows', async () => {
    const mock: MockedResponse = {
      request: {
        query: LibraryEntriesDocument,
        variables: { libraryId: LIBRARY_ID, first: PAGE_SIZE, filter: emptyFilter },
      },
      error: new Error('network down'),
    };

    await renderLibraryPage([mock]);

    await waitFor(() => expect(screen.getByText('Failed to load library')).toBeTruthy());
    expect(screen.getByText('network down')).toBeTruthy();
  });

  it('maps the URL filter onto LibraryFilter enum casing', async () => {
    // Sent with SCREAMING_SNAKE_CASE — a wrong/raw-cased `filter` would not
    // match this mock's `request.variables`, and MockLink would reject the
    // query outright ("no matching mock"), which the error-state assertion
    // below would catch just as loudly as a wrong-count assertion would.
    const mock = firstPageMock(
      [bookEdge('c1')],
      { hasNextPage: false, endCursor: null },
      {
        ...emptyFilter,
        status: 'COMPLETED',
        entryType: 'SERIES',
      }
    );

    await renderLibraryPage([mock], ['/library?status=completed&entryType=series']);

    await waitFor(() => expect(screen.getByText('BOOK:BOOK-c1')).toBeTruthy());
  });

  it('renders rows from the connection', async () => {
    const mock = firstPageMock([seriesEdge('c1'), bookEdge('c2')], {
      hasNextPage: false,
      endCursor: null,
    });

    await renderLibraryPage([mock]);

    await waitFor(() => expect(screen.getByText('SERIES:SERIES-c1')).toBeTruthy());
    expect(screen.getByText('BOOK:BOOK-c2')).toBeTruthy();
  });

  it('renders the empty-library state when there are no rows and no error', async () => {
    const mock = firstPageMock([], { hasNextPage: false, endCursor: null });

    await renderLibraryPage([mock]);

    await waitFor(() => expect(screen.getByText('Your library is empty')).toBeTruthy());
  });

  it('keeps rows and offers Retry when the next page fails', async () => {
    const mocks = [
      firstPageMock([bookEdge('c1')], { hasNextPage: true, endCursor: 'c1' }),
      fetchMoreErrorMock('c1'),
    ];

    await renderLibraryPage(mocks);

    await waitFor(() => expect(screen.getByText('BOOK:BOOK-c1')).toBeTruthy());
    await waitFor(() => expect(screen.getByText('Failed to load more books')).toBeTruthy());
    // The row from the first page is still there — a fetchMore failure must
    // not clear it.
    expect(screen.getByText('BOOK:BOOK-c1')).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Retry' })).toBeTruthy();
  });
});
