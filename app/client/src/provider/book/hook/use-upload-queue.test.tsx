import { act, renderHook } from '@testing-library/react';
import type { ReactNode } from 'react';
import { useCallback, useState } from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { Context } from '../context';
import type { BookList } from '../type';
import { useUploadQueue } from './use-upload-queue';

// ── XHR mock ─────────────────────────────────────────────────────────────────

let xhrInstances: XHRMock[];

class XHRMock {
  upload = { onprogress: null as ((e: ProgressEvent) => void) | null };
  onload: ((e: Event) => void) | null = null;
  onerror: (() => void) | null = null;
  status = 200;
  responseText = '{}';
  open = vi.fn();
  send = vi.fn();
  abort = vi.fn();
  constructor() {
    xhrInstances.push(this);
  }
}

// ── Context wrapper ───────────────────────────────────────────────────────────

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
          bookListItems: [],
          nextCursor: null,
          setBookListItems: () => {},
          setNextCursor: () => {},
          bookListFilter: {},
          setBookListFilter: () => {},
        }}
      >
        {children}
      </Context.Provider>
    );
  };
}

function makeFileList(...names: string[]): FileList {
  const files = names.map((name) => new File(['x'.repeat(1000)], name));
  return files as unknown as FileList;
}

// ── Setup ─────────────────────────────────────────────────────────────────────

beforeEach(() => {
  xhrInstances = [];
  vi.stubGlobal('XMLHttpRequest', XHRMock);
  vi.stubGlobal(
    'fetch',
    vi.fn().mockImplementation((url: string) => {
      if (url === '/api/config') {
        return Promise.resolve({
          ok: true,
          json: () => Promise.resolve({ maxConcurrentUploads: 2 }),
        });
      }
      // /api/books — called by fetchBookList
      return Promise.resolve({
        ok: true,
        json: () => Promise.resolve({ items: [], books: [], nextCursor: null }),
      });
    })
  );
});

afterEach(() => vi.unstubAllGlobals());

// ── Tests ─────────────────────────────────────────────────────────────────────

describe('useUploadQueue', () => {
  it('addFiles appends items with queued status', async () => {
    const { result } = renderHook(() => useUploadQueue(), { wrapper: makeWrapper() });

    // Wait for config fetch to resolve (maxConcurrentUploads → 2)
    await act(async () => {
      await Promise.resolve();
    });

    act(() => {
      result.current.addFiles(makeFileList('a.epub', 'b.epub'));
    });

    expect(result.current.items).toHaveLength(2);
    expect(result.current.items[0].file.name).toBe('a.epub');
    expect(result.current.items[1].file.name).toBe('b.epub');
  });

  it('starts at most maxConcurrentUploads uploads simultaneously', async () => {
    const { result } = renderHook(() => useUploadQueue(), { wrapper: makeWrapper() });

    await act(async () => {
      await Promise.resolve();
    });

    act(() => {
      result.current.addFiles(makeFileList('a.epub', 'b.epub', 'c.epub'));
    });

    expect(xhrInstances).toHaveLength(2);
    expect(result.current.items.filter((i) => i.status === 'uploading')).toHaveLength(2);
    expect(result.current.items.filter((i) => i.status === 'queued')).toHaveLength(1);
  });

  it('updates bytesUploaded on progress events', async () => {
    const { result } = renderHook(() => useUploadQueue(), { wrapper: makeWrapper() });

    await act(async () => {
      await Promise.resolve();
    });

    act(() => {
      result.current.addFiles(makeFileList('a.epub'));
    });

    act(() => {
      xhrInstances[0].upload.onprogress?.({
        loaded: 500,
        total: 1000,
        lengthComputable: true,
      } as ProgressEvent);
    });

    expect(result.current.items[0].bytesUploaded).toBe(500);
  });

  it('transitions to done on HTTP 200 and triggers book list refresh', async () => {
    const clearMock = vi.fn();
    const { result } = renderHook(() => useUploadQueue(), { wrapper: makeWrapper(clearMock) });

    await act(async () => {
      await Promise.resolve();
    });

    act(() => {
      result.current.addFiles(makeFileList('a.epub'));
    });

    xhrInstances[0].status = 200;
    await act(async () => {
      xhrInstances[0].onload?.(new Event('load'));
      await Promise.resolve();
    });

    expect(result.current.items[0].status).toBe('done');
    expect(clearMock).toHaveBeenCalledTimes(1);
    const fetchCalls = vi.mocked(fetch).mock.calls.map((c) => c[0] as string);
    expect(fetchCalls).toContain('/api/books?take=20');
  });

  it('transitions to error with message on non-200 response', async () => {
    const { result } = renderHook(() => useUploadQueue(), { wrapper: makeWrapper() });

    await act(async () => {
      await Promise.resolve();
    });

    act(() => {
      result.current.addFiles(makeFileList('bad.epub'));
    });

    xhrInstances[0].status = 400;
    xhrInstances[0].responseText = JSON.stringify({ error: 'Invalid EPUB' });
    act(() => {
      xhrInstances[0].onload?.(new Event('load'));
    });

    expect(result.current.items[0].status).toBe('error');
    expect(result.current.items[0].errorMessage).toBe('Invalid EPUB');
  });

  it('transitions to error without message on XHR network error', async () => {
    const { result } = renderHook(() => useUploadQueue(), { wrapper: makeWrapper() });

    await act(async () => {
      await Promise.resolve();
    });

    act(() => {
      result.current.addFiles(makeFileList('a.epub'));
    });

    act(() => {
      xhrInstances[0].onerror?.();
    });

    expect(result.current.items[0].status).toBe('error');
    expect(result.current.items[0].errorMessage).toBeUndefined();
  });

  it('starts next queued item when a slot frees up', async () => {
    const { result } = renderHook(() => useUploadQueue(), { wrapper: makeWrapper() });

    await act(async () => {
      await Promise.resolve();
    });

    act(() => {
      result.current.addFiles(makeFileList('a.epub', 'b.epub', 'c.epub'));
    });

    expect(xhrInstances).toHaveLength(2);

    // Complete the first upload
    xhrInstances[0].status = 200;
    await act(async () => {
      xhrInstances[0].onload?.(new Event('load'));
      await Promise.resolve();
    });

    // Third file should now be in flight
    expect(xhrInstances).toHaveLength(3);
    expect(result.current.items[0].status).toBe('done');
    expect(result.current.items[2].status).toBe('uploading');
  });

  it('appending new files while uploads are in progress joins the rolling queue', async () => {
    const { result } = renderHook(() => useUploadQueue(), { wrapper: makeWrapper() });

    await act(async () => {
      await Promise.resolve();
    });

    act(() => {
      result.current.addFiles(makeFileList('a.epub', 'b.epub'));
    });

    expect(xhrInstances).toHaveLength(2);

    // Add more files while both slots are busy
    act(() => {
      result.current.addFiles(makeFileList('c.epub'));
    });

    // Still only 2 in flight (slots full)
    expect(xhrInstances).toHaveLength(2);
    expect(result.current.items).toHaveLength(3);
    expect(result.current.items[2].status).toBe('queued');
  });

  it('aborts in-flight XHRs on unmount', async () => {
    const { result, unmount } = renderHook(() => useUploadQueue(), { wrapper: makeWrapper() });

    await act(async () => {
      await Promise.resolve();
    });

    act(() => {
      result.current.addFiles(makeFileList('a.epub'));
    });

    expect(xhrInstances).toHaveLength(1);

    unmount();

    expect(xhrInstances[0].abort).toHaveBeenCalledTimes(1);
  });

  it('attaches the validation payload from a failed upload response', async () => {
    const validation = {
      counts: { FATAL: 1, ERROR: 1, WARNING: 2, INFO: 0, USAGE: 0 },
      messages: [{ id: 'PKG-003', severity: 'FATAL', message: 'unreadable' }],
      threshold: 'ERROR',
    };
    const { result } = renderHook(() => useUploadQueue(), { wrapper: makeWrapper() });

    await act(async () => {
      await Promise.resolve();
    });

    act(() => {
      result.current.addFiles(makeFileList('bad.epub'));
    });

    xhrInstances[0].status = 400;
    xhrInstances[0].responseText = JSON.stringify({ error: 'EPUB failed validation', validation });
    act(() => {
      xhrInstances[0].onload?.(new Event('load'));
    });

    expect(result.current.items[0].status).toBe('error');
    expect(result.current.items[0].validation).toEqual(validation);
  });

  it('leaves validation undefined for a non-validation error', async () => {
    const { result } = renderHook(() => useUploadQueue(), { wrapper: makeWrapper() });

    await act(async () => {
      await Promise.resolve();
    });

    act(() => {
      result.current.addFiles(makeFileList('dup.epub'));
    });

    xhrInstances[0].status = 409;
    xhrInstances[0].responseText = JSON.stringify({ error: 'A book with the same fingerprint…' });
    act(() => {
      xhrInstances[0].onload?.(new Event('load'));
    });

    expect(result.current.items[0].status).toBe('error');
    expect(result.current.items[0].validation).toBeUndefined();
  });
});
