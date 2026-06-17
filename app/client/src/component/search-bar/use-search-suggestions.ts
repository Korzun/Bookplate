import { useMemo } from 'react';

import {
  useAllAuthors,
  useAllBookTitles,
  useAllSeriesNames,
  useLibrarySubjects,
} from '~/provider/book';
import type { BookListFilter } from '~/provider/book';

export type Suggestion = {
  type: 'status' | 'author' | 'series' | 'book' | 'subject';
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

const STATUS_OPTIONS: { label: string; value: string }[] = [
  { label: 'Not Started', value: 'not-started' },
  { label: 'In Progress', value: 'in-progress' },
  { label: 'Completed', value: 'completed' },
];

function matchInfo(
  text: string,
  query: string
): { matchStart: number; matchLength: number } | null {
  const idx = text.toLowerCase().indexOf(query.toLowerCase());
  if (idx === -1) return null;
  return { matchStart: idx, matchLength: query.length };
}

function buildGroup(
  type: Suggestion['type'],
  label: string,
  candidates: { label: string; value: string }[],
  query: string,
  additive: boolean,
  exclude: Set<string>
): SuggestionGroup | null {
  const items: Suggestion[] = [];
  for (const c of candidates) {
    if (exclude.has(c.value)) continue;
    const info = matchInfo(c.label, query);
    if (!info) continue;
    items.push({ type, label: c.label, value: c.value, additive, ...info });
  }
  if (items.length === 0) return null;
  return { type, label, items };
}

export function useSearchSuggestions(
  inputValue: string,
  filter: BookListFilter
): SuggestionGroup[] {
  const [authors] = useAllAuthors(filter);
  const [seriesNames] = useAllSeriesNames(filter);
  const [bookTitles] = useAllBookTitles(filter);
  const [subjects] = useLibrarySubjects({ author: filter.author, seriesName: filter.seriesName });

  return useMemo(() => {
    const query = inputValue.trim();
    if (!query) return [];

    const groups: SuggestionGroup[] = [];

    // Status (exclusive)
    if (!filter.status) {
      const g = buildGroup('status', 'Status', STATUS_OPTIONS, query, false, new Set());
      if (g) groups.push(g);
    }

    // Author (exclusive)
    if (!filter.author) {
      const authorCandidates = authors.map((a) => ({ label: a, value: a }));
      const g = buildGroup('author', 'Author', authorCandidates, query, false, new Set());
      if (g) groups.push({ ...g, items: g.items.slice(0, 5) });
    }

    // Series (exclusive) — navigates on select
    if (!filter.seriesName) {
      const seriesCandidates = seriesNames.map((s) => ({ label: s, value: s }));
      const g = buildGroup('series', 'Series', seriesCandidates, query, false, new Set());
      if (g) groups.push({ ...g, items: g.items.slice(0, 5) });
    }

    // Books — title match, navigates on select
    const bookCandidates = bookTitles.map((b) => ({ label: b.title, value: b.id }));
    const bookGroup = buildGroup('book', 'Book', bookCandidates, query, false, new Set());
    if (bookGroup) groups.push({ ...bookGroup, items: bookGroup.items.slice(0, 5) });

    // Subject (additive) — exclude already-active subjects
    const activeSubjects = new Set(filter.subjects ?? []);
    const subjectCandidates = (subjects ?? []).map((s) => ({ label: s, value: s }));
    const g = buildGroup('subject', 'Subject', subjectCandidates, query, true, activeSubjects);
    if (g) groups.push({ ...g, items: g.items.slice(0, 5) });

    return groups;
  }, [inputValue, filter, authors, seriesNames, bookTitles, subjects]);
}
