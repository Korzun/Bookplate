import type { RatingValue } from '~/control';
import type { BookListFilter } from '~/lib/book-types';

import type { Suggestion } from './use-search-suggestions';
import { ratingFilterLabel } from './use-search-suggestions';

const STATUS_LABELS: Record<string, string> = {
  'not-started': 'Not Started',
  'in-progress': 'In Progress',
  completed: 'Completed',
};

export type ChipDef =
  | { kind: 'entryType'; value: 'Series' | 'Single books' }
  | { kind: 'status'; value: string }
  | { kind: 'rating'; value: string; glyph: RatingValue | null }
  | { kind: 'author'; value: string }
  | { kind: 'series'; value: string }
  | { kind: 'collection'; value: string }
  | { kind: 'subject'; value: string };

export function filterToChips(filter: BookListFilter): ChipDef[] {
  const chips: ChipDef[] = [];
  if (filter.entryType)
    chips.push({
      kind: 'entryType',
      value: filter.entryType === 'series' ? 'Series' : 'Single books',
    });
  if (filter.status)
    chips.push({ kind: 'status', value: STATUS_LABELS[filter.status] ?? filter.status });
  const ratingLabel = ratingFilterLabel(filter);
  if (ratingLabel)
    chips.push({
      kind: 'rating',
      value: ratingLabel,
      glyph: filter.unrated ? null : (filter.minOverall ?? null),
    });
  if (filter.author) chips.push({ kind: 'author', value: filter.author });
  if (filter.seriesName) chips.push({ kind: 'series', value: filter.seriesName });
  if (filter.collection) chips.push({ kind: 'collection', value: filter.collection });
  for (const s of filter.subjects ?? []) chips.push({ kind: 'subject', value: s });
  return chips;
}

export function removeChip(filter: BookListFilter, chip: ChipDef): BookListFilter {
  switch (chip.kind) {
    case 'entryType':
      return { ...filter, entryType: undefined };
    case 'status':
      return { ...filter, status: undefined };
    case 'rating':
      return { ...filter, minOverall: undefined, unrated: undefined };
    case 'author':
      return { ...filter, author: undefined };
    case 'series':
      return { ...filter, seriesName: undefined };
    case 'collection':
      return { ...filter, collection: undefined };
    case 'subject':
      return { ...filter, subjects: filter.subjects?.filter((s) => s !== chip.value) };
  }
}

export function applySelection(filter: BookListFilter, suggestion: Suggestion): BookListFilter {
  switch (suggestion.type) {
    case 'entryType':
      // `collection` + `entryType` are mutually exclusive, like `collection` +
      // `seriesName`.
      return {
        ...filter,
        entryType: suggestion.value as 'series' | 'standalone',
        collection: undefined,
      };
    case 'status':
      return { ...filter, status: suggestion.value as BookListFilter['status'] };
    case 'rating':
      return suggestion.value === 'unrated'
        ? { ...filter, minOverall: undefined, unrated: true }
        : {
            ...filter,
            minOverall: Number(suggestion.value) as RatingValue,
            unrated: undefined,
          };
    case 'author':
      return { ...filter, author: suggestion.value };
    case 'series':
      // `collection` + `seriesName` together match nothing server-side.
      return { ...filter, seriesName: suggestion.value, collection: undefined };
    case 'collection':
      return {
        ...filter,
        collection: suggestion.value,
        seriesName: undefined,
        entryType: undefined,
      };
    case 'subject':
      return { ...filter, subjects: [...(filter.subjects ?? []), suggestion.value] };
    case 'book':
      return filter;
  }
}
