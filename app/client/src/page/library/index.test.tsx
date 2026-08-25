import { ApolloClient, InMemoryCache } from '@apollo/client';
import { ApolloProvider } from '@apollo/client/react';
import { MockLink, type MockedResponse } from '@apollo/client/testing';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import type { ReactNode } from 'react';
import { MemoryRouter, useLocation } from 'react-router';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import type { LibraryFilter } from '~/gql/graphql';
import { LibraryEntriesDocument } from '~/graphql/library';
import { cacheConfig } from '~/provider/apollo';
import type { BookListFilter } from '~/provider/book';
import { ThemeProvider } from '~/provider/theme';
import { renderWithApollo } from '~/test-utils';

const LIBRARY_ID = 'LIB-1';
const PAGE_SIZE = 20;

let currentLibraryId: string | undefined = LIBRARY_ID;
let currentLibraryIdLoading = false;
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
  useCurrentLibraryId: () => ({ libraryId: currentLibraryId, loading: currentLibraryIdLoading }),
  useLibraryTarget: () => [targetLibraryId, vi.fn()],
}));

vi.mock('~/component/library-switcher', () => ({
  LibrarySwitcher: () => <div data-testid="library-switcher" />,
}));

// Page/SearchBar/SeriesRow/BookRowFromEntry are replaced with minimal
// stand-ins: this file is testing LibraryPage's own wiring (empty/error
// states, the edges -> row dispatch, the sentinel/retry plumbing), not the
// reshaped row components' own rendering (Task 7 already covers those) or
// SearchBar's real UI (unrelated to this task).
//
// The SearchBar stand-in DOES echo the `filter`/`onChange` props it's given
// — that's what lets the round-trip tests below exercise
// `useBookListFilter`'s read (the `filter` prop reflects the URL on mount)
// and write (clicking the button calls `onChange`, which the real hook
// turns into a URL update) directions without needing the real component's
// debounce/suggestion machinery.
vi.mock('~/component', () => ({
  Page: ({ children }: { children: ReactNode }) => <div>{children}</div>,
  SearchBar: ({
    filter,
    onChange,
  }: {
    filter: BookListFilter;
    onChange: (filter: BookListFilter) => void;
  }) => (
    <div data-testid="search-bar">
      <span data-testid="search-bar-query">{filter.query ?? ''}</span>
      <button type="button" onClick={() => onChange({ ...filter, query: 'dune' })}>
        set query to dune
      </button>
    </div>
  ),
  SeriesRow: ({ series }: { series: { id: string } }) => <div>SERIES:{series.id}</div>,
  BookRowFromEntry: ({ book }: { book: { id: string } }) => <div>BOOK:{book.id}</div>,
}));

/** Renders alongside the page, inside the SAME router tree, so a test can
 * assert on the URL the router actually holds. `MemoryRouter` (used by
 * `renderWithApollo` -> `renderWithProviders`) never touches
 * `window.location`, so asserting on `window.location.search` would fail
 * for reasons unrelated to `useBookListFilter` — this probe reads the
 * router's own state instead. */
const LocationProbe = () => {
  const { search } = useLocation();
  return <span data-testid="location-search">{search}</span>;
};

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
  currentLibraryIdLoading = false;
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

/** Same as `renderLibraryPage`, plus a `LocationProbe` mounted in the same
 * router tree, for the two `useBookListFilter` round-trip tests below —
 * they need to observe the URL the router holds, which `renderLibraryPage`
 * alone has no way to expose. */
async function renderLibraryPageWithLocationProbe(
  mocks: MockedResponse[],
  initialEntries: string[] = ['/library']
) {
  const { LibraryPage } = await import('./index');
  return renderWithApollo(
    <>
      <LibraryPage />
      <LocationProbe />
    </>,
    { mocks, initialEntries }
  );
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

  // Characterization tests for `useBookListFilter` (step 10 / task 3): the
  // URL is, and always was, the hook's sole source of truth for the
  // returned filter value — these two tests must pass BEFORE and AFTER
  // that hook drops its `BookContext` round-trip, not just after. They were
  // run against the pre-refactor hook and confirmed passing there first
  // (see task-3-report.md); a green run here is only meaningful because of
  // that baseline.
  it('reads a filter already present in the URL on mount', async () => {
    const mock = firstPageMock(
      [],
      { hasNextPage: false, endCursor: null },
      {
        ...emptyFilter,
        query: 'dune',
      }
    );

    await renderLibraryPage([mock], ['/library?q=dune']);

    await waitFor(() => expect(screen.getByTestId('search-bar-query').textContent).toBe('dune'));
  });

  it('writes a chosen filter to the URL', async () => {
    const initialMock = firstPageMock([], { hasNextPage: false, endCursor: null });
    const duneMock = firstPageMock(
      [],
      { hasNextPage: false, endCursor: null },
      {
        ...emptyFilter,
        query: 'dune',
      }
    );

    await renderLibraryPageWithLocationProbe([initialMock, duneMock]);

    expect(screen.getByTestId('location-search').textContent).toBe('');

    await userEvent.click(screen.getByRole('button', { name: 'set query to dune' }));

    await waitFor(() =>
      expect(screen.getByTestId('location-search').textContent).toContain('q=dune')
    );
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

  // Review round 1 (test gap): only the "Your" half of this wording switch
  // was exercised. `isAdmin && targetLibraryId` is the other branch —
  // wired verbatim from the pre-migration REST version (`isAdmin &&
  // targetUsername`), now keyed on a Library id instead of a username.
  it('renders "This library is empty" for an admin viewing another library with no books', async () => {
    isAdminValue = true;
    targetLibraryId = 'LIB-1';
    const mock = firstPageMock([], { hasNextPage: false, endCursor: null });

    await renderLibraryPage([mock]);

    await waitFor(() => expect(screen.getByText('This library is empty')).toBeTruthy());
    expect(screen.queryByText('Your library is empty')).toBeNull();
  });

  // Review round 1 (blocked merge): `useCurrentLibraryId` learns its
  // `libraryId` from a NETWORK query (`ViewerBootstrap`) — `libraryId` is
  // `undefined` for the whole round trip on a cold load, and a SKIPPED
  // `useLibraryEntries` query reports `loading: false` on its own. Without
  // folding `useCurrentLibraryId`'s own `loading` in (fixed in
  // `use-library-entries.ts`), this state — no library id yet, bootstrap
  // still in flight — is indistinguishable from "the library really has no
  // books", and the page renders the wrong message for the ENTIRE bootstrap
  // round trip on every cold load.
  it('shows the loading spinner, not "library is empty", while the library id is still resolving', async () => {
    currentLibraryId = undefined;
    currentLibraryIdLoading = true;

    await renderLibraryPage([]);

    expect(screen.getByRole('status', { name: 'Loading' })).toBeTruthy();
    expect(screen.queryByText('Your library is empty')).toBeNull();
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

  // Review round 1 (minor, unprotected): `useBookListFilter()` returns a
  // FRESH `BookListFilter` object every render (by design — see that
  // hook's own doc comment), so `libraryFilter`'s `useMemo` in `index.tsx`
  // is what keeps the mapped `LibraryFilter` reference stable across
  // renders that don't change the filter's values. Bypassing that memo
  // (e.g. calling `toLibraryFilter(bookListFilter)` inline on every render)
  // still passes all the OTHER tests in this file — they never force a
  // second render after establishing the retry state. `rerender` here
  // forces exactly that: a render with unchanged filter values, but (absent
  // the memo) a NEW `filter` object reaching `useLibraryEntries`, which
  // resets its `fetchMore` error state on `[libraryId, filter]` by
  // REFERENCE equality (`use-library-entries.ts`'s own doc comment) — that
  // reset would silently clear a legitimate retry state the user hasn't
  // acted on yet.
  //
  // Uses a hand-rolled wrapper (MemoryRouter + ApolloProvider only) instead
  // of `renderLibraryPage`/`renderWithApollo`: RTL's `rerender` re-wraps the
  // new element with whatever `wrapper` was passed to `render`, but
  // `renderWithApollo` builds `<ApolloProvider>` OUTSIDE that `wrapper` (it
  // wraps `ui` before handing off to `renderWithProviders`) — so
  // `rerender(<LibraryPage />)` through it drops the `ApolloProvider` and
  // crashes on `useApolloClient`. Putting `ApolloProvider` INSIDE the
  // `wrapper` here keeps it mounted across `rerender`, matching how the
  // client's Apollo/router providers actually behave in the real app (they
  // don't remount on every LibraryPage render either).
  it('keeps the fetchMore retry state across an unrelated re-render', async () => {
    const { LibraryPage } = await import('./index');
    const mocks = [
      firstPageMock([bookEdge('c1')], { hasNextPage: true, endCursor: 'c1' }),
      fetchMoreErrorMock('c1'),
    ];
    const client = new ApolloClient({
      link: new MockLink(mocks),
      cache: new InMemoryCache(cacheConfig),
    });
    function Wrapper({ children }: { children: ReactNode }) {
      return (
        <MemoryRouter initialEntries={['/library']}>
          <ThemeProvider>
            <ApolloProvider client={client}>{children}</ApolloProvider>
          </ThemeProvider>
        </MemoryRouter>
      );
    }

    const { rerender } = render(<LibraryPage />, { wrapper: Wrapper });

    await waitFor(() => expect(screen.getByText('Failed to load more books')).toBeTruthy());

    rerender(<LibraryPage />);

    expect(screen.getByText('Failed to load more books')).toBeTruthy();
    expect(screen.getByText('BOOK:BOOK-c1')).toBeTruthy();
  });
});
