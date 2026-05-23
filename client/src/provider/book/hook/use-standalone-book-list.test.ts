import { renderHook } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';

import type { Book } from '../type';

import type { UseBookList } from './use-book-list';
import { useStandaloneBookList } from './use-standalone-book-list';

vi.mock('./use-book-list');

const { useBookList } = await import('./use-book-list');
const mockUseBookList = vi.mocked(useBookList);

function makeBook(overrides: Partial<Book> & { id: string }): Book {
  return {
    title: 'Title',
    author: 'Author',
    fileAs: '',
    publisher: '',
    series: '',
    seriesIndex: 0,
    subjects: [],
    identifiers: [],
    hasCover: false,
    size: 0,
    addedAt: '2024-01-01',
    ...overrides,
  };
}

function stubList(tuple: UseBookList) {
  mockUseBookList.mockReturnValue(tuple);
}

describe('useStandaloneBookList', () => {
  it('returns only books with no series', () => {
    stubList([
      [makeBook({ id: '1', series: '' }), makeBook({ id: '2', series: 'Dune' })],
      false,
      false,
      undefined,
    ]);
    const { result } = renderHook(() => useStandaloneBookList());
    expect(result.current[0]).toHaveLength(1);
    expect(result.current[0][0].id).toBe('1');
  });

  it('returns all books when none belong to a series', () => {
    stubList([
      [makeBook({ id: '1', series: '' }), makeBook({ id: '2', series: '' })],
      false,
      false,
      undefined,
    ]);
    const { result } = renderHook(() => useStandaloneBookList());
    expect(result.current[0]).toHaveLength(2);
  });

  it('returns empty array when all books belong to a series', () => {
    stubList([[makeBook({ id: '1', series: 'Dune' })], false, false, undefined]);
    const { result } = renderHook(() => useStandaloneBookList());
    expect(result.current[0]).toEqual([]);
  });

  it('returns empty array when there are no books', () => {
    stubList([[], false, false, undefined]);
    const { result } = renderHook(() => useStandaloneBookList());
    expect(result.current[0]).toEqual([]);
  });

  it('passes through loading state', () => {
    stubList([[], true, false, undefined]);
    const { result } = renderHook(() => useStandaloneBookList());
    expect(result.current[1]).toBe(true);
  });

  it('passes through error state', () => {
    stubList([[], false, true, 'Fetch failed']);
    const { result } = renderHook(() => useStandaloneBookList());
    expect(result.current[2]).toBe(true);
    expect(result.current[3]).toBe('Fetch failed');
  });
});
