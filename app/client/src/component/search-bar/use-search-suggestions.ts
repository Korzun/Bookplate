import { useMemo } from 'react';

import { useBookList, useLibrarySubjects } from '~/provider/book';
import type { BookListFilter } from '~/provider/book';

export type Suggestion = {
  type: 'status' | 'author' | 'series' | 'subject';
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
  const [bookList] = useBookList();
  const [subjects] = useLibrarySubjects();

  return useMemo(() => {
    const query = inputValue.trim();
    if (!query) return [];

    const groups: SuggestionGroup[] = [];

    // Status (exclusive)
    if (!filter.status) {
      const g = buildGroup('status', 'Status', STATUS_OPTIONS, query, false, new Set());
      if (g) groups.push(g);
    }

    // Author (exclusive) — deduplicate by value
    if (!filter.author) {
      const seen = new Set<string>();
      const authors: { label: string; value: string }[] = [];
      for (const book of bookList) {
        if (book.author && !seen.has(book.author)) {
          seen.add(book.author);
          authors.push({ label: book.author, value: book.author });
        }
      }
      const g = buildGroup('author', 'Author', authors, query, false, new Set());
      if (g) groups.push(g);
    }

    // Series (exclusive) — deduplicate by value
    if (!filter.seriesName) {
      const seen = new Set<string>();
      const seriesList: { label: string; value: string }[] = [];
      for (const book of bookList) {
        if (book.series && !seen.has(book.series)) {
          seen.add(book.series);
          seriesList.push({ label: book.series, value: book.series });
        }
      }
      const g = buildGroup('series', 'Series', seriesList, query, false, new Set());
      if (g) groups.push(g);
    }

    // Subject (additive) — exclude already-active subjects
    const activeSubjects = new Set(filter.subjects ?? []);
    const subjectCandidates = (subjects ?? []).map((s) => ({ label: s, value: s }));
    const g = buildGroup('subject', 'Subject', subjectCandidates, query, true, activeSubjects);
    if (g) groups.push(g);

    return groups;
  }, [inputValue, filter, bookList, subjects]);
}
