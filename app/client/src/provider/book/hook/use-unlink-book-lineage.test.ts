import { act, renderHook, waitFor } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { useUnlinkBookLineage } from './use-unlink-book-lineage';

afterEach(() => vi.unstubAllGlobals());

describe('useUnlinkBookLineage', () => {
  it('returns initial state', () => {
    const { result } = renderHook(() => useUnlinkBookLineage('book-1'));
    const [unlink, unlinking, error, errorMessage] = result.current;
    expect(typeof unlink).toBe('function');
    expect(unlinking).toBe(false);
    expect(error).toBe(false);
    expect(errorMessage).toBeUndefined();
  });

  it('calls DELETE /api/books/:bookId/link/:documentId', async () => {
    const mockFetch = vi.fn().mockResolvedValue({ status: 204 });
    vi.stubGlobal('fetch', mockFetch);

    const { result } = renderHook(() => useUnlinkBookLineage('book-1'));
    await act(() => result.current[0]('doc-1'));

    expect(mockFetch).toHaveBeenCalledWith('/api/books/book-1/link/doc-1', { method: 'DELETE' });
  });

  it('sets error state on non-204 response', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue({
        status: 400,
        json: () => Promise.resolve({ error: 'Cannot unlink edit entry' }),
      })
    );

    const { result } = renderHook(() => useUnlinkBookLineage('book-1'));
    await act(() => result.current[0]('doc-1'));
    await waitFor(() => expect(result.current[2]).toBe(true));

    expect(result.current[3]).toBe('Cannot unlink edit entry');
  });

  it('returns to idle state on success', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({ status: 204 }));

    const { result } = renderHook(() => useUnlinkBookLineage('book-1'));
    await act(() => result.current[0]('doc-1'));
    await waitFor(() => expect(result.current[1]).toBe(false));

    expect(result.current[2]).toBe(false);
  });
});
