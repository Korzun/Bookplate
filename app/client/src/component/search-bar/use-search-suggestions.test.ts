import { renderHook } from '@testing-library/react';
import { describe, it, expect, vi } from 'vitest';

import type { BookListFilter } from '~/provider/book';

import { useSearchSuggestions } from './use-search-suggestions';

// Mock dedicated search data hooks
vi.mock('~/provider/book', () => ({
  useAllAuthors: () => [['N.K. Jemisin', 'Susanna Clarke'], false, undefined],
  useAllSeriesNames: () => [['Broken Earth'], false, undefined],
  useAllBookTitles: () => [
    [
      { id: 'b1', title: 'The Fifth Season' },
      { id: 'b2', title: 'Piranesi' },
      { id: 'b3', title: 'The Obelisk Gate' },
    ],
    false,
    undefined,
  ],
  useLibrarySubjects: () => [['Fantasy', 'Fiction', 'Science Fiction'], false, undefined],
}));

const emptyFilter: BookListFilter = {};

describe('useSearchSuggestions', () => {
  it('returns empty groups when inputValue is empty', () => {
    const { result } = renderHook(() => useSearchSuggestions('', emptyFilter));
    expect(result.current).toEqual([]);
  });

  it('returns status suggestions matching the query', () => {
    const { result } = renderHook(() => useSearchSuggestions('in pr', emptyFilter));
    const statusGroup = result.current.find((g) => g.type === 'status');
    expect(statusGroup).toBeDefined();
    expect(statusGroup!.items).toHaveLength(1);
    expect(statusGroup!.items[0].value).toBe('in-progress');
    expect(statusGroup!.items[0].label).toBe('In Progress');
    expect(statusGroup!.items[0].additive).toBe(false);
  });

  it('omits status group when status chip is already active', () => {
    const filter: BookListFilter = { status: 'in-progress' };
    const { result } = renderHook(() => useSearchSuggestions('in', filter));
    expect(result.current.find((g) => g.type === 'status')).toBeUndefined();
  });

  it('returns author suggestions matching the query (case-insensitive, deduplicated)', () => {
    const { result } = renderHook(() => useSearchSuggestions('jemi', emptyFilter));
    const authorGroup = result.current.find((g) => g.type === 'author');
    expect(authorGroup).toBeDefined();
    expect(authorGroup!.items).toHaveLength(1); // deduplicated
    expect(authorGroup!.items[0].value).toBe('N.K. Jemisin');
    expect(authorGroup!.items[0].additive).toBe(false);
  });

  it('omits author group when author chip is already active', () => {
    const filter: BookListFilter = { author: 'N.K. Jemisin' };
    const { result } = renderHook(() => useSearchSuggestions('jemi', filter));
    expect(result.current.find((g) => g.type === 'author')).toBeUndefined();
  });

  it('returns series suggestions matching the query', () => {
    const { result } = renderHook(() => useSearchSuggestions('broken', emptyFilter));
    const seriesGroup = result.current.find((g) => g.type === 'series');
    expect(seriesGroup).toBeDefined();
    expect(seriesGroup!.items).toHaveLength(1);
    expect(seriesGroup!.items[0].value).toBe('Broken Earth');
    expect(seriesGroup!.items[0].additive).toBe(false);
  });

  it('omits series group when seriesName chip is already active', () => {
    const filter: BookListFilter = { seriesName: 'Broken Earth' };
    const { result } = renderHook(() => useSearchSuggestions('broken', filter));
    expect(result.current.find((g) => g.type === 'series')).toBeUndefined();
  });

  it('returns subject suggestions with additive=true', () => {
    const { result } = renderHook(() => useSearchSuggestions('fan', emptyFilter));
    const subjectGroup = result.current.find((g) => g.type === 'subject');
    expect(subjectGroup).toBeDefined();
    expect(subjectGroup!.items[0].additive).toBe(true);
  });

  it('omits already-selected subjects from subject suggestions', () => {
    const filter: BookListFilter = { subjects: ['Fantasy'] };
    const { result } = renderHook(() => useSearchSuggestions('fan', filter));
    const subjectGroup = result.current.find((g) => g.type === 'subject');
    // 'Fantasy' already active, so not in suggestions
    expect(subjectGroup?.items.find((i) => i.value === 'Fantasy')).toBeUndefined();
  });

  it('includes correct matchStart and matchLength', () => {
    const { result } = renderHook(() => useSearchSuggestions('broken', emptyFilter));
    const item = result.current.find((g) => g.type === 'series')!.items[0];
    expect(item.matchStart).toBe(0);
    expect(item.matchLength).toBe(6);
  });
});
