import type { MockedResponse } from '@apollo/client/testing';
import { act, waitFor } from '@testing-library/react';
import { useState } from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import type {
  SearchSuggestionsFilter,
  SearchSuggestionsQuery,
  SuggestionType,
} from '~/gql/graphql';
import { SearchSuggestionsDocument } from '~/graphql/search-suggestions';
import type { BookListFilter } from '~/provider/book';
import { renderHookWithApollo } from '~/test-utils';

import { useSearchSuggestions } from './use-search-suggestions';

const LIBRARY_ID = 'LIB-1';

let currentLibraryId: string | undefined = LIBRARY_ID;
let currentLibraryIdLoading = false;

vi.mock('~/provider/library-target', () => ({
  useCurrentLibraryId: () => ({ libraryId: currentLibraryId, loading: currentLibraryIdLoading }),
}));

const emptyFilter: BookListFilter = {};

type LibraryNode = Extract<NonNullable<SearchSuggestionsQuery['node']>, { __typename: 'Library' }>;
type WireGroup = LibraryNode['searchSuggestions'][number];

const wireGroup = (
  type: SuggestionType,
  items: { label: string; value: string; matchStart: number; matchLength: number }[]
): WireGroup => ({
  __typename: 'SuggestionGroup',
  type,
  items: items.map((i) => ({ __typename: 'Suggestion', ...i })),
});

const dataFor = (groups: WireGroup[]): SearchSuggestionsQuery => ({
  __typename: 'Query',
  node: { __typename: 'Library', id: LIBRARY_ID, searchSuggestions: groups },
});

const suggestionsMock = (
  query: string,
  filter: SearchSuggestionsFilter,
  groups: WireGroup[]
): MockedResponse<SearchSuggestionsQuery> => ({
  request: {
    query: SearchSuggestionsDocument,
    variables: { libraryId: LIBRARY_ID, query, filter },
  },
  result: { data: dataFor(groups) },
  delay: 0,
});

// waitFor's internal polling uses setInterval — with fully-faked timers it
// never advances, causing OOM. shouldAdvanceTime lets real time advance so
// polling resolves without us manually ticking.
const fakeTimerOpts = { shouldAdvanceTime: true } as const;

const renderProbe = (inputValue: string, filter: BookListFilter, mocks: MockedResponse[]) =>
  renderHookWithApollo(() => useSearchSuggestions(inputValue, filter), mocks);

describe('useSearchSuggestions', () => {
  beforeEach(() => {
    vi.useFakeTimers(fakeTimerOpts);
    currentLibraryId = LIBRARY_ID;
    currentLibraryIdLoading = false;
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('returns Type and Status quick-pick groups when inputValue is empty and no filter is active', () => {
    // No mocks: a request here would throw ("No more mocked responses").
    const { result } = renderProbe('', emptyFilter, []);
    expect(result.current?.groups).toHaveLength(2);
    expect(result.current?.groups[0].type).toBe('entryType');
    expect(result.current?.groups[0].items).toHaveLength(2);
    expect(result.current?.groups[1].type).toBe('status');
    expect(result.current?.groups[1].items).toHaveLength(3);
    expect(result.current?.loading).toBe(false);
  });

  it('issues no request for an empty query', async () => {
    // A catch-all mock (matches ANY variables for this document) wrapping a
    // spy: the quick-pick branch never reads `data`, so a probe that only
    // asserts on `groups` would pass even if the hook fired the query
    // anyway (unused, but still dispatched) — the spy is what actually
    // proves no request went out.
    const spy = vi.fn(() => ({ data: dataFor([]) }));
    const catchAllMock: MockedResponse<SearchSuggestionsQuery> = {
      request: { query: SearchSuggestionsDocument, variables: () => true },
      result: spy,
      delay: 0,
    };
    const { result } = renderProbe('', emptyFilter, [catchAllMock]);
    await act(async () => {
      await vi.advanceTimersByTimeAsync(500);
    });
    expect(spy).not.toHaveBeenCalled();
    expect(result.current?.groups).toHaveLength(2);
  });

  it('does not fire a request before the 200ms debounce elapses', async () => {
    const resultFn = vi.fn(() => ({ data: dataFor([]) }));
    const mock: MockedResponse<SearchSuggestionsQuery> = {
      request: {
        query: SearchSuggestionsDocument,
        variables: { libraryId: LIBRARY_ID, query: 'jemi', filter: {} },
      },
      result: resultFn,
      delay: 0,
    };
    renderProbe('jemi', emptyFilter, [mock]);
    await act(async () => {
      await vi.advanceTimersByTimeAsync(100);
    });
    expect(resultFn).not.toHaveBeenCalled();
  });

  it('fires exactly one request once the debounce elapses', async () => {
    const resultFn = vi.fn(() => ({ data: dataFor([]) }));
    const mock: MockedResponse<SearchSuggestionsQuery> = {
      request: {
        query: SearchSuggestionsDocument,
        variables: { libraryId: LIBRARY_ID, query: 'jemi', filter: {} },
      },
      result: resultFn,
      delay: 0,
    };
    renderProbe('jemi', emptyFilter, [mock]);
    await act(async () => {
      await vi.advanceTimersByTimeAsync(250);
    });
    await waitFor(() => expect(resultFn).toHaveBeenCalledTimes(1));
  });

  it('sets loading=true after debounce fires and before response arrives', async () => {
    const mock: MockedResponse<SearchSuggestionsQuery> = {
      request: {
        query: SearchSuggestionsDocument,
        variables: { libraryId: LIBRARY_ID, query: 'jemi', filter: {} },
      },
      delay: Infinity,
    };
    const { result } = renderProbe('jemi', emptyFilter, [mock]);
    await act(async () => {
      await vi.advanceTimersByTimeAsync(200);
    });
    expect(result.current?.loading).toBe(true);
  });

  it('sets loading=false after response arrives', async () => {
    const { result } = renderProbe('jemi', emptyFilter, [suggestionsMock('jemi', {}, [])]);
    await act(async () => {
      await vi.advanceTimersByTimeAsync(200);
    });
    await waitFor(() => expect(result.current?.loading).toBe(false));
  });

  it('keeps the previous groups visible while a newly-settled debounced query is still in flight', async () => {
    const groupsA = [
      wireGroup('AUTHOR', [
        { label: 'N.K. Jemisin', value: 'N.K. Jemisin', matchStart: 0, matchLength: 4 },
      ]),
    ];
    const mockA = suggestionsMock('jemi', {}, groupsA);
    // `delay: Infinity` never resolves — the SECOND query stays perpetually
    // in flight, so if the hook's groups ever reflected it, this test would
    // have to be reading stale-from-the-future data, which is impossible.
    // Any groups seen here can only be the FIRST query's.
    const mockB: MockedResponse<SearchSuggestionsQuery> = {
      request: {
        query: SearchSuggestionsDocument,
        variables: { libraryId: LIBRARY_ID, query: 'jemis', filter: {} },
      },
      delay: Infinity,
    };

    const useProbe = () => {
      const [input, setInput] = useState('jemi');
      return { ...useSearchSuggestions(input, emptyFilter), setInput };
    };
    const { result } = renderHookWithApollo(useProbe, [mockA, mockB]);

    await act(async () => {
      await vi.advanceTimersByTimeAsync(200);
    });
    await waitFor(() => expect(result.current?.loading).toBe(false));
    expect(result.current?.groups.find((g) => g.type === 'author')?.items[0].label).toBe(
      'N.K. Jemisin'
    );

    // Type further: a new debounced query starts (and never settles, per
    // mockB above), but the dropdown should keep showing the first query's
    // groups rather than blanking out for the round trip.
    act(() => result.current?.setInput('jemis'));
    await act(async () => {
      await vi.advanceTimersByTimeAsync(200);
    });
    expect(result.current?.loading).toBe(true);
    expect(result.current?.groups.find((g) => g.type === 'author')?.items[0].label).toBe(
      'N.K. Jemisin'
    );
  });

  it('prepends a client-matched status group before server groups, and maps grouped-by-type server results', async () => {
    const groups = [
      wireGroup('AUTHOR', [
        { label: 'N.K. Jemisin', value: 'N.K. Jemisin', matchStart: 5, matchLength: 4 },
      ]),
    ];
    const { result } = renderProbe('in pr', emptyFilter, [suggestionsMock('in pr', {}, groups)]);
    await act(async () => {
      await vi.advanceTimersByTimeAsync(200);
    });
    await waitFor(() => expect(result.current?.loading).toBe(false));

    const statusGroup = result.current?.groups.find((g) => g.type === 'status');
    expect(statusGroup).toBeDefined();
    expect(statusGroup?.items).toHaveLength(1);
    expect(statusGroup?.items[0].value).toBe('in-progress');
    expect(statusGroup?.items[0].additive).toBe(false);

    const authorGroup = result.current?.groups.find((g) => g.type === 'author');
    expect(authorGroup?.items[0].label).toBe('N.K. Jemisin');
    expect(authorGroup?.items[0].matchStart).toBe(5);
    expect(authorGroup?.items[0].matchLength).toBe(4);
    expect(authorGroup?.items[0].additive).toBe(false);
  });

  it('omits the status group when filter.status is already set', async () => {
    const { result } = renderProbe('in pr', { status: 'in-progress' }, [
      suggestionsMock('in pr', {}, []),
    ]);
    await act(async () => {
      await vi.advanceTimersByTimeAsync(200);
    });
    await waitFor(() => expect(result.current?.loading).toBe(false));
    expect(result.current?.groups.find((g) => g.type === 'status')).toBeUndefined();
  });

  it('omits the Type group when entryType filter is already set', () => {
    const { result } = renderProbe('', { entryType: 'series' }, []);
    expect(result.current?.groups).toHaveLength(1);
    expect(result.current?.groups[0].type).toBe('status');
  });

  it('omits both Type and Status groups when both are already set', () => {
    const { result } = renderProbe('', { entryType: 'series', status: 'completed' }, []);
    expect(result.current?.groups).toHaveLength(0);
  });

  it('marks subject items as additive=true', async () => {
    const groups = [
      wireGroup('SUBJECT', [{ label: 'Fantasy', value: 'Fantasy', matchStart: 0, matchLength: 3 }]),
    ];
    const { result } = renderProbe('fan', emptyFilter, [suggestionsMock('fan', {}, groups)]);
    await act(async () => {
      await vi.advanceTimersByTimeAsync(200);
    });
    await waitFor(() => expect(result.current?.loading).toBe(false));
    const subjectGroup = result.current?.groups.find((g) => g.type === 'subject');
    expect(subjectGroup?.items[0].additive).toBe(true);
  });

  it('sends active filter chips as GraphQL variables (author, subjects → activeSubjects)', async () => {
    const filter: BookListFilter = { author: 'N.K. Jemisin', subjects: ['Fantasy'] };
    const wireFilter: SearchSuggestionsFilter = {
      author: 'N.K. Jemisin',
      activeSubjects: ['Fantasy'],
    };
    const { result } = renderProbe('fan', filter, [suggestionsMock('fan', wireFilter, [])]);
    await act(async () => {
      await vi.advanceTimersByTimeAsync(200);
    });
    // If the hook sent a different `filter` shape, MockLink would find no
    // matching mock and this query would sit in an errored/no-data state
    // rather than resolve — proving the variables actually sent matched.
    await waitFor(() => expect(result.current?.loading).toBe(false));
  });

  it('returns empty-state quick-pick groups once inputValue becomes empty again', async () => {
    const groups = [
      wireGroup('AUTHOR', [
        { label: 'N.K. Jemisin', value: 'N.K. Jemisin', matchStart: 5, matchLength: 4 },
      ]),
    ];
    const useProbe = () => {
      const [input, setInput] = useState('jemi');
      return { ...useSearchSuggestions(input, emptyFilter), setInput };
    };
    const { result } = renderHookWithApollo(useProbe, [suggestionsMock('jemi', {}, groups)]);

    await act(async () => {
      await vi.advanceTimersByTimeAsync(200);
    });
    await waitFor(() => expect(result.current?.groups.length).toBeGreaterThan(0));

    act(() => result.current?.setInput(''));
    expect(result.current?.groups).toHaveLength(2); // Type + Status
    expect(result.current?.groups[0].type).toBe('entryType');
    expect(result.current?.loading).toBe(false);
  });

  it('does not query when there is no library id', () => {
    currentLibraryId = undefined;
    // No mocks at all: if the hook fired SearchSuggestions anyway, MockLink
    // would throw "No more mocked responses" and fail this test loudly.
    const { result } = renderProbe('jemi', emptyFilter, []);
    expect(result.current?.loading).toBe(false);
    expect(result.current?.groups).toHaveLength(0);
  });

  // A skipped `useQuery` reports `loading: false` — without folding in
  // `useCurrentLibraryId`'s own `loading`, a caller reading this hook's
  // `loading` during the bootstrap round trip (libraryId still resolving)
  // would see `groups: [], loading: false`.
  it('reports loading while useCurrentLibraryId itself is still resolving, even with a settled debounce', async () => {
    currentLibraryId = undefined;
    currentLibraryIdLoading = true;
    const { result } = renderProbe('jemi', emptyFilter, []);
    await act(async () => {
      await vi.advanceTimersByTimeAsync(200);
    });
    expect(result.current?.loading).toBe(true);
    expect(result.current?.groups).toHaveLength(0);
  });
});
