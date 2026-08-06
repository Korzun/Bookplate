import { renderHook, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import type { Book } from '../type';
import { useSeriesBookList } from './use-series-book-list';

const mockWithTargetUser = (url: string) => url;

vi.mock('~/provider/library-target', () => ({
  useWithTargetUser: () => mockWithTargetUser,
}));

vi.mock('~/lib/api-fetch');

function makeBook(overrides: Partial<Book> & { id: string }): Book {
  return {
    title: 'Title',
    author: 'Author',
    titleSort: '',
    authorSort: '',
    publishDate: '',
    publisher: '',
    series: 'Dune',
    seriesIndex: 0,
    subjects: [],
    identifiers: [],
    hasCover: false,
    size: 0,
    addedAt: '2024-01-01',
    chapterCount: 0,
    pageCount: 0,
    ...overrides,
  };
}

const makeListResponse = (books: Book[]) => ({ items: [], books, nextCursor: null });

describe('useSeriesBookList', () => {
  beforeEach(async () => {
    vi.clearAllMocks();
    const { apiFetch } = await import('~/lib/api-fetch');
    vi.mocked(apiFetch).mockResolvedValue(
      new Response(
        JSON.stringify(
          makeListResponse([
            makeBook({ id: '3', seriesIndex: 3 }),
            makeBook({ id: '1', seriesIndex: 1 }),
            makeBook({ id: '2', seriesIndex: 2 }),
          ])
        ),
        { status: 200, headers: { 'Content-Type': 'application/json' } }
      )
    );
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('starts in loading state', async () => {
    const { apiFetch } = await import('~/lib/api-fetch');
    vi.mocked(apiFetch).mockReturnValue(new Promise(() => {})); // never settles
    const { result } = renderHook(() => useSeriesBookList('Dune'));
    const [list, loading, error] = result.current;
    expect(list).toBeUndefined();
    expect(loading).toBe(true);
    expect(error).toBe(false);
  });

  it('requests exactly this series, not the shared unfiltered list', async () => {
    const { apiFetch } = await import('~/lib/api-fetch');
    renderHook(() => useSeriesBookList('Dune'));

    await waitFor(() => expect(apiFetch).toHaveBeenCalled());

    const [url] = vi.mocked(apiFetch).mock.calls[0]!;
    expect(url).toContain('/api/books?');
    expect(url).toContain('seriesName=Dune');
    expect(url).toContain('take=100');
  });

  it('returns the series books sorted by seriesIndex when loaded', async () => {
    const { result } = renderHook(() => useSeriesBookList('Dune'));

    await waitFor(() => expect(result.current[1]).toBe(false));

    const [list, loading, error] = result.current;
    expect(loading).toBe(false);
    expect(error).toBe(false);
    expect(list?.map((b) => b.id)).toEqual(['1', '2', '3']);
  });

  /**
   * Seen-to-fail before this hook stopped filtering `useBookList`'s shared,
   * 20-entry-capped REST list: a series sitting past the first REST page
   * (i.e. almost any series once the grid has scrolled past ~20 entries)
   * filtered to an empty array from that frozen list and this hook reported
   * "Unknown series" — even though the series genuinely exists and the
   * server has its books. This hook's own request is scoped to the series
   * by name, so page position in any other list is irrelevant.
   */
  it('finds a series regardless of where it would have sat in a 20-item page', async () => {
    const { apiFetch } = await import('~/lib/api-fetch');
    const books = Array.from({ length: 3 }, (_, i) =>
      makeBook({ id: `book-${i}`, seriesIndex: i + 1 })
    );
    vi.mocked(apiFetch).mockResolvedValue(
      new Response(JSON.stringify(makeListResponse(books)), {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      })
    );

    const { result } = renderHook(() => useSeriesBookList('Entry Number 21 Series'));

    await waitFor(() => expect(result.current[1]).toBe(false));

    const [list, , error] = result.current;
    expect(error).toBe(false);
    expect(list).toHaveLength(3);
  });

  it('returns error state when the response is not ok', async () => {
    const { apiFetch } = await import('~/lib/api-fetch');
    vi.mocked(apiFetch).mockResolvedValue(new Response('', { status: 404 }));

    const { result } = renderHook(() => useSeriesBookList('Dune'));

    await waitFor(() => expect(result.current[1]).toBe(false));

    const [list, loading, error, errorMessage] = result.current;
    expect(list).toBeUndefined();
    expect(loading).toBe(false);
    expect(error).toBe(true);
    expect(errorMessage).toBe('Unknown series Dune');
  });

  it('returns error state when the response has no books', async () => {
    const { apiFetch } = await import('~/lib/api-fetch');
    vi.mocked(apiFetch).mockResolvedValue(
      new Response(JSON.stringify(makeListResponse([])), {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      })
    );

    const { result } = renderHook(() => useSeriesBookList('Dune'));

    await waitFor(() => expect(result.current[1]).toBe(false));

    const [list, , error, errorMessage] = result.current;
    expect(list).toBeUndefined();
    expect(error).toBe(true);
    expect(errorMessage).toBe('Unknown series Dune');
  });

  it('returns error state when fetch throws', async () => {
    const { apiFetch } = await import('~/lib/api-fetch');
    vi.mocked(apiFetch).mockRejectedValue(new Error('Network error'));

    const { result } = renderHook(() => useSeriesBookList('Dune'));

    await waitFor(() => expect(result.current[1]).toBe(false));

    const [, , error, errorMessage] = result.current;
    expect(error).toBe(true);
    expect(errorMessage).toBe('Network error');
  });

  it('re-fetches when seriesName changes', async () => {
    const { apiFetch } = await import('~/lib/api-fetch');

    const { result, rerender } = renderHook(({ name }) => useSeriesBookList(name), {
      initialProps: { name: 'Dune' },
    });

    await waitFor(() => expect(result.current[1]).toBe(false));
    expect(apiFetch).toHaveBeenCalledTimes(1);

    rerender({ name: 'Foundation' });

    expect(result.current[1]).toBe(true);
    await waitFor(() => expect(result.current[1]).toBe(false));
    expect(apiFetch).toHaveBeenCalledTimes(2);
    expect(vi.mocked(apiFetch).mock.calls[1]![0]).toContain('seriesName=Foundation');
  });
});
