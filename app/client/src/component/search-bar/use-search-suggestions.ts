import { useQuery } from '@apollo/client/react';
import { useEffect, useState } from 'react';

import type {
  SearchSuggestionsFilter,
  SearchSuggestionsQuery,
  SuggestionType,
} from '~/gql/graphql';
import { SearchSuggestionsDocument } from '~/graphql/search-suggestions';
import type { BookListFilter } from '~/lib/book-types';
import { useCurrentLibraryId } from '~/provider/library-target';

export type Suggestion = {
  type: 'entryType' | 'status' | 'author' | 'series' | 'book' | 'subject';
  label: string;
  value: string;
  additive: boolean;
  matchStart: number;
  matchLength: number;
};

export type SuggestionGroup = {
  type: Suggestion['type'];
  label: string;
  items: Suggestion[];
};

const TYPE_OPTIONS: { label: string; value: 'series' | 'standalone' }[] = [
  { label: 'Series', value: 'series' },
  { label: 'Single books', value: 'standalone' },
];

const STATUS_OPTIONS: { label: string; value: string }[] = [
  { label: 'Not Started', value: 'not-started' },
  { label: 'In Progress', value: 'in-progress' },
  { label: 'Completed', value: 'completed' },
];

const GROUP_LABEL: Record<Suggestion['type'], string> = {
  entryType: 'Type',
  status: 'Status',
  author: 'Author',
  series: 'Series',
  book: 'Book',
  subject: 'Subject',
};

/** Wire `SuggestionType` (`AUTHOR|BOOK|SERIES|SUBJECT`) → this hook's lowercase client type. */
const SERVER_GROUP_TYPE: Record<SuggestionType, 'author' | 'series' | 'book' | 'subject'> = {
  AUTHOR: 'author',
  SERIES: 'series',
  BOOK: 'book',
  SUBJECT: 'subject',
};

/** Unchanged by the REST→GraphQL move — the debounce this hook has always used. */
const DEBOUNCE_MS = 200;

type LibraryNode = Extract<NonNullable<SearchSuggestionsQuery['node']>, { __typename: 'Library' }>;
type ServerGroup = LibraryNode['searchSuggestions'][number];

function matchInfo(
  text: string,
  query: string
): { matchStart: number; matchLength: number } | null {
  const idx = text.toLowerCase().indexOf(query.toLowerCase());
  if (idx === -1) return null;
  return { matchStart: idx, matchLength: query.length };
}

/**
 * Suggestions fire per keystroke against `Library.searchSuggestions`
 * (`graphql/search-suggestions.ts` — deliberately not selecting
 * `Suggestion.book`; see that file's doc comment for why). The request
 * itself stays debounced by `DEBOUNCE_MS`, exactly as the REST version was:
 * `debouncedQuery` only ever advances from inside the `setTimeout` callback,
 * never synchronously in the effect body, so a blank query (or any further
 * keystroke before the timer fires) cancels the pending advance for free —
 * the effect's own cleanup clears the previous timer, and no new one is
 * scheduled when `inputValue.trim()` is empty. There is no AbortController
 * here (unlike the REST version): once `debouncedQuery` moves on to a new
 * value, `useQuery`'s variables change and Apollo simply stops caring about
 * whatever the in-flight request for the OLD variables returns.
 *
 * Skips the query while `libraryId` is `undefined` (no library resolved
 * yet) or the debounce hasn't settled (`debouncedQuery === ''`). `loading`
 * folds in `useCurrentLibraryId`'s own `loading` for the same reason
 * `useLibraryEntries` does: a skipped `useQuery` reports `loading: false`,
 * so without this a caller could read "no suggestions" during the
 * `ViewerBootstrap` round trip rather than "still resolving which library
 * this is". This does NOT apply to the empty-query quick-pick branch below
 * — that branch is pure client-side derivation and never touches
 * `libraryId` or the network.
 */
export function useSearchSuggestions(
  inputValue: string,
  filter: BookListFilter
): { groups: SuggestionGroup[]; loading: boolean } {
  const { libraryId, loading: libraryIdLoading } = useCurrentLibraryId();
  const [debouncedQuery, setDebouncedQuery] = useState('');

  const { status, author, seriesName, subjects, entryType } = filter;

  useEffect(() => {
    const query = inputValue.trim();
    if (!query) return;
    const timer = setTimeout(() => setDebouncedQuery(query), DEBOUNCE_MS);
    return () => clearTimeout(timer);
  }, [inputValue]);

  // Built with only the keys that are actually active — an explicit
  // `undefined` value on a key is a distinct shape from an omitted key as
  // far as exact variable matching (e.g. `MockLink`'s `@wry/equality`
  // comparison) is concerned, so this omits rather than nulling.
  const suggestionsFilter: SearchSuggestionsFilter = {
    ...(author ? { author } : {}),
    ...(seriesName ? { seriesName } : {}),
    ...(subjects && subjects.length > 0 ? { activeSubjects: subjects } : {}),
  };

  const {
    data,
    previousData,
    loading: queryLoading,
  } = useQuery(SearchSuggestionsDocument, {
    variables: {
      libraryId: libraryId ?? '',
      query: debouncedQuery,
      filter: suggestionsFilter,
    },
    skip: libraryId === undefined || debouncedQuery === '',
  });
  // Falls back to `previousData` while a just-settled `debouncedQuery` has
  // no cache entry yet: `data` is `undefined` for that round trip (Apollo
  // has no merge policy on `searchSuggestions`), but `previousData` still
  // holds the prior debounced query's result, so the dropdown keeps showing
  // it (stale-while-revalidate) instead of blanking out and repopulating on
  // every settled keystroke.
  const effectiveData = data ?? previousData;

  const query = inputValue.trim();

  // When input is empty, return static quick-pick groups (Type and/or
  // Status) so the dropdown shows useful options on focus. Both are omitted
  // when the corresponding filter is already active.
  if (!query) {
    const emptyGroups: SuggestionGroup[] = [];
    if (!entryType) {
      emptyGroups.push({
        type: 'entryType',
        label: GROUP_LABEL.entryType,
        items: TYPE_OPTIONS.map((opt) => ({
          type: 'entryType' as const,
          label: opt.label,
          value: opt.value,
          additive: false,
          matchStart: 0,
          matchLength: 0,
        })),
      });
    }
    if (!status) {
      emptyGroups.push({
        type: 'status',
        label: GROUP_LABEL.status,
        items: STATUS_OPTIONS.map((opt) => ({
          type: 'status' as const,
          label: opt.label,
          value: opt.value,
          additive: false,
          matchStart: 0,
          matchLength: 0,
        })),
      });
    }
    return { groups: emptyGroups, loading: false };
  }

  const library = effectiveData?.node?.__typename === 'Library' ? effectiveData.node : undefined;
  const result: SuggestionGroup[] = [];

  // Gated on `library` — i.e. a completed fetch for the CURRENT OR the
  // immediately preceding debounced query (see `effectiveData` above) —
  // matching the REST version, which only ever computed the status
  // quick-match and mapped the server groups inside its fetch's success
  // handler, and kept the previous groups on screen between one fetch
  // finishing and the next one starting.
  if (library) {
    if (!status) {
      const items: Suggestion[] = [];
      for (const opt of STATUS_OPTIONS) {
        const info = matchInfo(opt.label, debouncedQuery);
        if (info) {
          items.push({
            type: 'status',
            label: opt.label,
            value: opt.value,
            additive: false,
            ...info,
          });
        }
      }
      if (items.length > 0) result.push({ type: 'status', label: GROUP_LABEL.status, items });
    }

    const serverGroups: ServerGroup[] = library.searchSuggestions;
    for (const g of serverGroups) {
      const type = SERVER_GROUP_TYPE[g.type];
      const additive = type === 'subject';
      const items: Suggestion[] = g.items.map((item) => ({
        type,
        label: item.label,
        value: item.value,
        additive,
        matchStart: item.matchStart,
        matchLength: item.matchLength,
      }));
      if (items.length > 0) result.push({ type, label: GROUP_LABEL[type], items });
    }
  }

  return { groups: result, loading: queryLoading || libraryIdLoading };
}
