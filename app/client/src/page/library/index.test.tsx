import { ApolloClient, InMemoryCache } from '@apollo/client';
import { ApolloProvider } from '@apollo/client/react';
import { MockLink, type MockedResponse } from '@apollo/client/testing';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import type { ReactNode } from 'react';
import { MemoryRouter, useLocation } from 'react-router';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { BookRowFragment } from '~/component/book-row/from-entry';
import { SeriesRowFragment } from '~/component/series-row';
import { UserRowFragment } from '~/component/user-row';
import { makeFragmentData } from '~/gql';
import type {
  BookRowFragmentFragment,
  LibraryEntriesQuery,
  LibraryFilter,
  SeriesRowFragmentFragment,
  UserListQuery,
} from '~/gql/graphql';
import { UserListDocument } from '~/graphql/user';
import type { BookListFilter } from '~/lib/book-types';
import { cacheConfig } from '~/provider/apollo';
import { ThemeProvider } from '~/provider/theme';
import { renderWithApollo } from '~/test-utils';

import { LibraryEntriesDocument, LibraryPage } from './index';

const LIBRARY_ID = 'LIB-1';
const PAGE_SIZE = 20;

let currentLibraryId: string | undefined = LIBRARY_ID;
let currentLibraryIdLoading = false;
let targetLibraryId: string | undefined = undefined;
let isAdminValue = false;

vi.mock('~/provider/auth', () => ({
  useIsAdmin: () => [isAdminValue],
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
// reshaped row components' own rendering (their own `*.test.tsx` files
// cover those) or SearchBar's real UI (unrelated to this task). This is a
// `vi.mock` against the `~/component` BARREL — not a landmine per
// `test-utils.tsx`'s standing note, since it uses a plain factory (no
// `importOriginal`) and doesn't cross into the upload-replace-modal/
// fix-review/book-edit cycle that note warns about.
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
 * sentinel (`hasNextPage: true`) drives `loadMore` through the SAME effect
 * the real page uses, without a real IntersectionObserver implementation
 * (unavailable in jsdom).
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
  userListRequests.count = 0;
  vi.stubGlobal('IntersectionObserver', AutoIntersectingObserver);
});

afterEach(() => {
  vi.unstubAllGlobals();
});

/**
 * Masked node factories: `LibraryEntriesDocument`'s union entry keeps
 * `BookRowFragment`/`SeriesRowFragment` MASKED (`LibraryEntryEdge`'s own
 * doc comment in `./index.tsx`), so every mock below is built through
 * `makeFragmentData` and typed `MockedResponse<LibraryEntriesQuery>`,
 * exactly like `page/device-list`'s `kindleRow` — not the unannotated bare
 * literals this file used before task 5. `__typename` appears both inside
 * `makeFragmentData`'s argument (the fragment's own selection) and spread
 * outside it (the query's sibling `__typename`, auto-injected by codegen's
 * `addTypenameSelectionDocumentTransform`) for the same reason
 * `page/device-list/index.test.tsx`'s `kindleRow` does.
 */
const bookEdge = (cursor: string, overrides: Partial<BookRowFragmentFragment> = {}) => ({
  __typename: 'LibraryEntriesConnectionEdge' as const,
  cursor,
  node: {
    __typename: 'Book' as const,
    ...makeFragmentData(
      {
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
      BookRowFragment
    ),
  },
});

const seriesEdge = (cursor: string, overrides: Partial<SeriesRowFragmentFragment> = {}) => ({
  __typename: 'LibraryEntriesConnectionEdge' as const,
  cursor,
  node: {
    __typename: 'Series' as const,
    ...makeFragmentData(
      {
        __typename: 'Series' as const,
        id: `SERIES-${cursor}`,
        name: 'Dune Chronicles',
        author: 'Frank Herbert',
        bookCount: 6,
        progressPercentage: null,
        books: {
          __typename: 'SeriesBooksConnection' as const,
          edges: [],
        },
        ...overrides,
      },
      SeriesRowFragment
    ),
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
): MockedResponse<LibraryEntriesQuery> => ({
  request: {
    query: LibraryEntriesDocument,
    variables: { libraryId: LIBRARY_ID, first: PAGE_SIZE, filter },
  },
  result: { data: { __typename: 'Query', ...connection(edges, pageInfo) } },
});

const fetchMoreErrorMock = (
  after: string,
  filter: LibraryFilter = emptyFilter
): MockedResponse<LibraryEntriesQuery> => ({
  request: {
    query: LibraryEntriesDocument,
    variables: { libraryId: LIBRARY_ID, first: PAGE_SIZE, after, filter },
  },
  error: new Error('fetch more failed'),
});

/** `page/library` only reads `UserListDocument`'s length (for the "No users
 * registered" empty state), so a bare username is enough here — no other
 * field matters to this route's own wiring.
 *
 * `request.variables` is MockLink's VARIABLE-MATCHER form (a function, not
 * an object): `MockLink.request()` calls it SYNCHRONOUSLY from its
 * `mocks.findIndex(...)`
 * (`@apollo/client/testing/core/mocking/mockLink.js`), in the same tick the
 * operation is issued — so `userListRequests` counts at REQUEST time, before
 * any delivery delay. `UserListDocument` takes no variables, so the matcher
 * always returns `true`; the counting is the entire point (see
 * `page/book/index.test.tsx`'s longer note on why a `result` function, which
 * runs on DELIVERY after a random 20-50ms delay, cannot pin a "does not
 * fire" assertion). This is the `variables` FIELD inside `request` — a
 * TOP-LEVEL `variableMatcher` key is silently ignored by current MockLink
 * and yields a fail-open test.
 *
 * `maxUsageCount: Infinity` so a regression firing the query twice is
 * counted twice rather than masked by a "No more mocked responses" error. */
const userListRequests = { count: 0 };

const userListMock = (usernames: string[]): MockedResponse<UserListQuery> => ({
  request: {
    query: UserListDocument,
    variables: function userListVariables() {
      userListRequests.count += 1;
      return true;
    },
  },
  maxUsageCount: Infinity,
  result: {
    data: {
      __typename: 'Query',
      viewer: {
        __typename: 'Viewer',
        users: usernames.map((username, index) => ({
          __typename: 'User' as const,
          ...makeFragmentData(
            {
              __typename: 'User' as const,
              id: `u${index}`,
              username,
              progressCount: 0,
            },
            UserRowFragment
          ),
          library: { __typename: 'Library' as const, id: `lib-${index}` },
        })),
      },
    },
  },
});

function renderLibraryPage(mocks: MockedResponse[], initialEntries: string[] = ['/library']) {
  return renderWithApollo(<LibraryPage />, { mocks, initialEntries });
}

/** Same as `renderLibraryPage`, plus a `LocationProbe` mounted in the same
 * router tree, for the two `useBookListFilter` round-trip tests below —
 * they need to observe the URL the router holds, which `renderLibraryPage`
 * alone has no way to expose. */
function renderLibraryPageWithLocationProbe(
  mocks: MockedResponse[],
  initialEntries: string[] = ['/library']
) {
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

    // No `LibraryEntriesDocument` mock queued: `libraryId` is `undefined`,
    // so the entries query must stay `skip`ped. If `skip` regressed, `useQuery`
    // would ask `MockLink` for a request it never got a mock for, and the
    // rejection (async, so it wouldn't fail this test synchronously) would
    // still leave `edges` empty and surface nothing — the "Select a library"
    // assertion below only holds because the admin-with-no-selection branch
    // renders BEFORE ever consulting `edges`/`loading`/`error` at all.
    renderLibraryPage([userListMock(['alice'])]);

    await waitFor(() => expect(screen.getByText('Select a library')).toBeTruthy());
    expect(screen.queryByText('No users registered')).toBeNull();
  });

  it('renders "No users registered" for an admin with no users', async () => {
    isAdminValue = true;
    currentLibraryId = undefined;
    targetLibraryId = undefined;

    renderLibraryPage([userListMock([])]);

    await waitFor(() => expect(screen.getByText('No users registered')).toBeTruthy());
  });

  // `skip: !isAdmin` on this route's `UserListDocument` read is the one that
  // matters most: `page/library` is a NON-ADMIN's default landing page.
  // Drop the gate and every non-admin visit fires `UserList`, the server
  // answers `users: null` + `FORBIDDEN` (`Viewer.users` is admin-gated), and
  // `errorPolicy: 'none'` discards the whole result — a silent, per-visit
  // rejected request.
  //
  // The pin is `userListRequests`, counted at REQUEST time. It cannot be a
  // bare "no mock queued" assertion: `MockLink` does NOT throw on an
  // unmatched request — verified against
  // `@apollo/client/testing/core/mocking/mockLink.js`, which `console.warn`s
  // and returns an observable that errors ASYNCHRONOUSLY
  // (`observeOn(asapScheduler)`), which a synchronous assertion never
  // observes and which nothing in `setup.ts` promotes to a failure. And no
  // rendered text discriminates the gate either: `userList` is only read for
  // the admin-only "No users registered" branch, so a non-admin's page looks
  // identical whether the query fired or not.
  //
  // Seen-to-fail: `skip: !isAdmin` → `skip: false` in `./index.tsx` makes
  // `userListRequests.count` 1 and this test red.
  it('does not issue the UserList query for a non-admin viewer', async () => {
    isAdminValue = false;

    renderLibraryPage([
      userListMock(['alice']),
      firstPageMock([], { hasNextPage: false, endCursor: null }),
    ]);

    await waitFor(() => expect(screen.getByText('Your library is empty')).toBeTruthy());
    expect(userListRequests.count).toBe(0);
  });

  // The other side of the same gate, so the counter above is known to be
  // wired to a query that CAN fire: an admin's visit must issue it exactly
  // once.
  it('issues the UserList query once for an admin viewer', async () => {
    isAdminValue = true;
    currentLibraryId = undefined;
    targetLibraryId = undefined;

    renderLibraryPage([userListMock(['alice'])]);

    await waitFor(() => expect(screen.getByText('Select a library')).toBeTruthy());
    expect(userListRequests.count).toBe(1);
  });

  it('renders "Failed to load library" when the first page errors with no rows', async () => {
    const mock: MockedResponse<LibraryEntriesQuery> = {
      request: {
        query: LibraryEntriesDocument,
        variables: { libraryId: LIBRARY_ID, first: PAGE_SIZE, filter: emptyFilter },
      },
      error: new Error('network down'),
    };

    renderLibraryPage([mock]);

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

    renderLibraryPage([mock], ['/library?status=completed&entryType=series']);

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

    renderLibraryPage([mock], ['/library?q=dune']);

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

    renderLibraryPageWithLocationProbe([initialMock, duneMock]);

    expect(screen.getByTestId('location-search').textContent).toBe('');

    await userEvent.click(screen.getByRole('button', { name: 'set query to dune' }));

    await waitFor(() =>
      expect(screen.getByTestId('location-search').textContent).toContain('q=dune')
    );
  });

  it('renders rows from the connection, preserving edge order', async () => {
    const mock = firstPageMock(
      [seriesEdge('c1'), bookEdge('c2'), bookEdge('c3'), seriesEdge('c4')],
      { hasNextPage: false, endCursor: null }
    );

    renderLibraryPage([mock]);

    await waitFor(() => expect(screen.getByText('SERIES:SERIES-c1')).toBeTruthy());
    // ORDER, not just presence: `getByText` calls alone (the pre-review-round-1
    // shape of this test) pass even if the grid re-sorted or reversed its
    // edges — the deleted `use-library-entries.test.tsx` was the only place
    // in the client asserting this, via its own "preserves Book/Series
    // discrimination and edge order across an interleaved page" case.
    expect(screen.getAllByText(/^(BOOK|SERIES):/).map((node) => node.textContent)).toEqual([
      'SERIES:SERIES-c1',
      'BOOK:BOOK-c2',
      'BOOK:BOOK-c3',
      'SERIES:SERIES-c4',
    ]);
  });

  it('renders the empty-library state when there are no rows and no error', async () => {
    const mock = firstPageMock([], { hasNextPage: false, endCursor: null });

    renderLibraryPage([mock]);

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

    renderLibraryPage([mock]);

    await waitFor(() => expect(screen.getByText('This library is empty')).toBeTruthy());
    expect(screen.queryByText('Your library is empty')).toBeNull();
  });

  // Review round 1 (blocked merge): `useCurrentLibraryId` learns its
  // `libraryId` from a NETWORK query (`ViewerBootstrap`) — `libraryId` is
  // `undefined` for the whole round trip on a cold load, and a SKIPPED
  // entries query reports `loading: false` on its own. Without folding
  // `useCurrentLibraryId`'s own `loading` in (`extraLoading` in
  // `./index.tsx`), this state — no library id yet, bootstrap still in
  // flight — is indistinguishable from "the library really has no books",
  // and the page renders the wrong message for the ENTIRE bootstrap round
  // trip on every cold load.
  it('shows the loading spinner, not "library is empty", while the library id is still resolving', async () => {
    currentLibraryId = undefined;
    currentLibraryIdLoading = true;

    renderLibraryPage([]);

    expect(screen.getByRole('status', { name: 'Loading' })).toBeTruthy();
    expect(screen.queryByText('Your library is empty')).toBeNull();
  });

  // Was `useLibraryEntries.test.tsx`'s own "does not query when there is no
  // library id" (that hook is deleted, task 5) — ported here since it's now
  // this page's own responsibility to pass `skip: libraryId === undefined`
  // through to `usePaginatedConnection`. No `LibraryEntriesDocument` mock is
  // queued at all: if `skip` regressed, `MockLink` would have nothing to
  // serve the request, which this hook's `useQuery` surfaces as an `error`
  // — `edges` would stay empty either way, but the ASSERTED text below
  // would still be "Your library is empty" only by the skip path, not by an
  // errored one (a broken `skip` and an `error !== undefined` state render
  // DIFFERENT text — "Failed to load library" — so this still catches the
  // regression, just via the wrong-message assertion below rather than a
  // thrown "no matching mock").
  it('does not query the entries connection when there is no library id', async () => {
    currentLibraryId = undefined;
    currentLibraryIdLoading = false;

    renderLibraryPage([]);

    await waitFor(() => expect(screen.getByText('Your library is empty')).toBeTruthy());
    expect(screen.queryByText('Failed to load library')).toBeNull();
  });

  it('keeps rows and offers Retry when the next page fails', async () => {
    const mocks = [
      firstPageMock([bookEdge('c1')], { hasNextPage: true, endCursor: 'c1' }),
      fetchMoreErrorMock('c1'),
    ];

    renderLibraryPage(mocks);

    await waitFor(() => expect(screen.getByText('BOOK:BOOK-c1')).toBeTruthy());
    await waitFor(() => expect(screen.getByText('Failed to load more books')).toBeTruthy());
    // The row from the first page is still there — a fetchMore failure must
    // not clear it.
    expect(screen.getByText('BOOK:BOOK-c1')).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Retry' })).toBeTruthy();
  });

  // Was `useLibraryEntries.test.tsx`'s own "starts a fresh list when the
  // filter changes" (that hook is deleted, task 5): `Library.entries`
  // carries `relayStylePagination(['filter'])` in `cacheConfig`
  // (`provider/apollo/cache.ts`), keyed on `filter` — a filter change must
  // start a FRESH list in the cache rather than appending to the old one.
  // Reusing `renderWithApollo`'s `renderLibraryPageWithLocationProbe` alone
  // ("writes a chosen filter to the URL" above) only proves the SECOND
  // query's variables matched a queued mock; it never asserts the rendered
  // rows actually swapped over. This test does, with non-empty edges on
  // both sides of the change.
  it('starts a fresh list when the filter changes', async () => {
    const initialMock = firstPageMock([bookEdge('c1')], { hasNextPage: false, endCursor: null });
    const duneMock = firstPageMock(
      [bookEdge('c2')],
      { hasNextPage: false, endCursor: null },
      { ...emptyFilter, query: 'dune' }
    );

    renderLibraryPage([initialMock, duneMock]);

    await waitFor(() => expect(screen.getByText('BOOK:BOOK-c1')).toBeTruthy());

    await userEvent.click(screen.getByRole('button', { name: 'set query to dune' }));

    await waitFor(() => expect(screen.getByText('BOOK:BOOK-c2')).toBeTruthy());
    expect(screen.queryByText('BOOK:BOOK-c1')).toBeNull();
  });

  // Review round 1 (minor, unprotected), REPURPOSED for task 5: originally
  // guarded `index.tsx`'s own `JSON.stringify(subjects)` + `useMemo` dance,
  // which existed solely to give the old `useLibraryEntries` hook a
  // reference-stable `filter` for its (then reference-compared) reset
  // effect. Task 3 replaced that reset with `usePaginatedConnection`'s
  // stringified PRIMITIVE `resetKey`, and task 5 removed the `useMemo`
  // dance itself — `libraryFilter` is now recomputed via a plain
  // `toLibraryFilter(bookListFilter)` call on every render, no memo at all,
  // so a FRESH filter object reaches `usePaginatedConnection` on every
  // single render, not just a forced/bypassed one.
  //
  // That makes this test's premise the REAL, unconditional code path now,
  // not a hand-rolled bypass of a memo that no longer exists: `rerender`
  // below re-renders `LibraryPage` with unchanged filter VALUES, which
  // (with no memo anywhere) still constructs a brand-new `libraryFilter`
  // object. The assertions verify that doesn't clear the retry state —
  // i.e., that `./index.tsx`'s own `resetKey` construction
  // (`` `${libraryId}:${JSON.stringify(libraryFilter)}` ``) stays a
  // VALUE-keyed primitive rather than accidentally keying off
  // `libraryFilter`'s object identity. Seen-to-fail: temporarily appended
  // `${Math.random()}` to that `resetKey` template (forcing a new value —
  // not just a new reference — on every render). This test failed
  // deterministically (3/3 runs): the banner clears before this test's own
  // assertion ever runs, so `getByText('Failed to load more books')` throws
  // `TestingLibraryElementError`, which is what marks the `it` FAILED.
  // Vitest ALSO reports a separate, asynchronous "Maximum update depth
  // exceeded" unhandled error every run — a stale `IntersectionObserver`
  // effect keeps re-firing `loadMore` after the ever-changing `resetKey`
  // keeps clearing/re-triggering state post-assertion; that second error is
  // real but incidental to THIS test's pass/fail, which is driven by the
  // missing banner text above. Reverted.
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
