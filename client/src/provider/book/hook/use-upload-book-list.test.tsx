import { act, renderHook } from '@testing-library/react';
import type { ReactNode } from 'react';
import { useCallback, useState } from 'react';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { Context } from '../context';
import type { BookList } from '../type';

function makeWrapper(clearCompleteBookIds: () => void = () => {}) {
  return function Wrapper({ children }: { children: ReactNode }) {
    const [bookList, setBookListRaw] = useState<BookList>({});
    const [bookListLoading, setBookListLoadingState] = useState(false);

    const setBookList = useCallback(
      (updater: (prev: BookList) => BookList) => setBookListRaw(updater),
      []
    );
    const setBookListLoading = useCallback((v: boolean) => setBookListLoadingState(v), []);

    return (
      <Context.Provider
        value={{
          bookList,
          bookListFetched: false,
          bookListLoading,
          bookListError: undefined,
          loadingByBookId: {},
          errorByBookId: {},
          completeBookIds: new Set(),
          setBookList,
          setBookListFetched: () => {},
          setBookListLoading,
          setBookListError: () => {},
          setLoadingForBook: () => {},
          setErrorForBook: () => {},
          setBookComplete: () => {},
          clearCompleteBookIds,
        }}
      >
        {children}
      </Context.Provider>
    );
  };
}

function makeFileList(...names: string[]): FileList {
  const files = names.map((name) => new File(['content'], name));
  return files as unknown as FileList;
}

import { useUploadBookList } from './use-upload-book-list';

describe('useUploadBookList', () => {
  afterEach(() => vi.unstubAllGlobals());

  it('clears complete book ids on successful upload', async () => {
    const mockClear = vi.fn();
    vi.stubGlobal(
      'fetch',
      vi
        .fn()
        .mockResolvedValueOnce({
          ok: true,
          json: () => Promise.resolve({ imported: ['1'], skipped: [], errors: [] }),
        })
        .mockResolvedValueOnce({
          ok: true,
          json: () => Promise.resolve([]),
        })
    );

    const { result } = renderHook(() => useUploadBookList(), {
      wrapper: makeWrapper(mockClear),
    });

    await act(() => result.current[0](makeFileList('book.epub')));

    expect(mockClear).toHaveBeenCalled();
  });

  it('does not clear complete book ids on failed upload', async () => {
    const mockClear = vi.fn();
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue({
        ok: false,
        json: () => Promise.resolve({ error: 'Upload failed' }),
      })
    );

    const { result } = renderHook(() => useUploadBookList(), {
      wrapper: makeWrapper(mockClear),
    });

    await act(() => result.current[0](makeFileList('book.epub')));

    expect(mockClear).not.toHaveBeenCalled();
  });
});
