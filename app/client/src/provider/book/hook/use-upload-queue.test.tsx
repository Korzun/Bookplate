import { act, renderHook } from '@testing-library/react';
import type { ReactNode } from 'react';
import { useCallback, useState } from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { Context } from '../context';
import type { Book, BookList, MetadataFix } from '../type';
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

function makeFix(overrides: Partial<MetadataFix> = {}): MetadataFix {
  return {
    field: 'authorSort',
    kind: 'author-sort-missing',
    from: '',
    to: 'Herbert, Frank',
    changes: { authorSort: 'Herbert, Frank' },
    ...overrides,
  };
}

/** fetch mock that also answers PATCH /api/books/:id/metadata for applyFix tests. */
function stubFetchWithPatch(patchResponse: { ok: boolean; body: unknown }) {
  vi.mocked(fetch).mockImplementation((input: unknown, init?: RequestInit) => {
    const url = String(input);
    if (url === '/api/config') {
      return Promise.resolve({
        ok: true,
        json: () => Promise.resolve({ maxConcurrentUploads: 2 }),
      }) as unknown as Promise<Response>;
    }
    if (url.includes('/metadata') && init?.method === 'PATCH') {
      return Promise.resolve({
        ok: patchResponse.ok,
        json: () => Promise.resolve(patchResponse.body),
      }) as unknown as Promise<Response>;
    }
    return Promise.resolve({
      ok: true,
      json: () => Promise.resolve({ items: [], books: [], nextCursor: null }),
    }) as unknown as Promise<Response>;
  });
}

/** fetch mock for the applyAllProposals + undo flow: answers GET /api/books/:id
 * (snapshot), PATCH .../metadata (apply, then revert), and DELETE .../lineage. */
function stubFetchForApplyAll(opts: {
  original: Partial<Book>;
  patchResponses: { ok: boolean; body: unknown }[];
}) {
  let patchCallIndex = 0;
  vi.mocked(fetch).mockImplementation((input: unknown, init?: RequestInit) => {
    const url = String(input);
    const method = init?.method ?? 'GET';
    if (url === '/api/config') {
      return Promise.resolve({
        ok: true,
        json: () => Promise.resolve({ maxConcurrentUploads: 2 }),
      }) as unknown as Promise<Response>;
    }
    if (method === 'DELETE' && url.includes('/lineage')) {
      return Promise.resolve({
        ok: true,
        json: () => Promise.resolve({ cleared: 1 }),
      }) as unknown as Promise<Response>;
    }
    if (method === 'PATCH' && url.includes('/metadata')) {
      const resp = opts.patchResponses[patchCallIndex++] ?? { ok: true, body: {} };
      return Promise.resolve({
        ok: resp.ok,
        json: () => Promise.resolve(resp.body),
      }) as unknown as Promise<Response>;
    }
    if (method === 'GET' && /^\/api\/books\/[^/]+$/.test(url)) {
      return Promise.resolve({
        ok: true,
        json: () => Promise.resolve(opts.original),
      }) as unknown as Promise<Response>;
    }
    return Promise.resolve({
      ok: true,
      json: () => Promise.resolve({ items: [], books: [], nextCursor: null }),
    }) as unknown as Promise<Response>;
  });
}

/** Drives a single-file upload through to `done` with the given proposals,
 * yielding an item with `bookId: 'book-1'` and those proposals. */
async function renderQueueWithProposals(fixes: MetadataFix[]) {
  const { result } = renderHook(() => useUploadQueue(), { wrapper: makeWrapper() });

  await act(async () => {
    await Promise.resolve();
  });

  act(() => {
    result.current.addFiles(makeFileList('a.epub'));
  });

  xhrInstances[0].status = 200;
  xhrInstances[0].responseText = JSON.stringify({
    results: [{ filename: 'a.epub', bookId: 'book-1', applied: [], proposals: fixes }],
  });
  await act(async () => {
    xhrInstances[0].onload?.(new Event('load'));
    await Promise.resolve();
  });

  return { result };
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

  it('applyFix leaves the proposal untouched and resolves false when the patch fails', async () => {
    const fix = makeFix();
    stubFetchWithPatch({ ok: false, body: { error: 'Save failed' } });

    const { result } = renderHook(() => useUploadQueue(), { wrapper: makeWrapper() });
    await act(async () => {
      await Promise.resolve();
    });

    act(() => {
      result.current.addFiles(makeFileList('a.epub'));
    });

    xhrInstances[0].status = 200;
    xhrInstances[0].responseText = JSON.stringify({
      results: [{ filename: 'a.epub', bookId: 'book-1', applied: [], proposals: [fix] }],
    });
    await act(async () => {
      xhrInstances[0].onload?.(new Event('load'));
      await Promise.resolve();
    });

    const itemId = result.current.items[0].id;
    let succeeded: boolean | undefined;
    await act(async () => {
      succeeded = await result.current.applyFix(itemId, fix);
    });

    expect(succeeded).toBe(false);
    expect(result.current.items[0].bookId).toBe('book-1');
    expect(result.current.items[0].proposals).toEqual([fix]);
    expect(result.current.items[0].appliedFixes ?? []).toEqual([]);
  });

  it('applyFix moves the fix from proposals to appliedFixes and updates bookId on success', async () => {
    const fix = makeFix();
    stubFetchWithPatch({ ok: true, body: { id: 'book-2' } });

    const { result } = renderHook(() => useUploadQueue(), { wrapper: makeWrapper() });
    await act(async () => {
      await Promise.resolve();
    });

    act(() => {
      result.current.addFiles(makeFileList('a.epub'));
    });

    xhrInstances[0].status = 200;
    xhrInstances[0].responseText = JSON.stringify({
      results: [{ filename: 'a.epub', bookId: 'book-1', applied: [], proposals: [fix] }],
    });
    await act(async () => {
      xhrInstances[0].onload?.(new Event('load'));
      await Promise.resolve();
    });

    const itemId = result.current.items[0].id;
    let succeeded: boolean | undefined;
    await act(async () => {
      succeeded = await result.current.applyFix(itemId, fix);
    });

    expect(succeeded).toBe(true);
    expect(result.current.items[0].bookId).toBe('book-2');
    expect(result.current.items[0].proposals).toEqual([]);
    expect(result.current.items[0].appliedFixes).toEqual([fix]);
  });

  it('dismissAllProposals clears every proposal and arms undo; undo restores them', async () => {
    const fixes = [
      makeFix(),
      makeFix({ field: 'title', kind: 'title-missing', to: 'Dune', changes: { title: 'Dune' } }),
    ];
    const { result } = await renderQueueWithProposals(fixes);
    const id = result.current.items[0].id;
    const before = result.current.items[0].proposals;

    act(() => result.current.dismissAllProposals(id));
    expect(result.current.items[0].proposals).toEqual([]);
    expect(result.current.items[0].undo?.kind).toBe('dismiss');

    await act(async () => {
      await result.current.undo(id);
    });
    expect(result.current.items[0].proposals).toEqual(before);
    expect(result.current.items[0].undo).toBeUndefined();
  });

  it('applyAllProposals snapshots the book; undo re-patches original metadata and clears lineage', async () => {
    const fixes = [
      makeFix(),
      makeFix({ field: 'title', kind: 'title-missing', to: 'Dune', changes: { title: 'Dune' } }),
    ];
    const { result } = await renderQueueWithProposals(fixes);
    const id = result.current.items[0].id;
    const before = result.current.items[0].proposals;

    const original = {
      title: 'Original Title',
      titleSort: 'Original Title',
      author: 'Original Author',
      authorSort: 'Author, Original',
      subjects: ['Fiction'],
    };
    stubFetchForApplyAll({
      original,
      patchResponses: [
        { ok: true, body: { id: 'book-2' } },
        { ok: true, body: { id: 'book-3' } },
      ],
    });

    await act(async () => {
      await result.current.applyAllProposals(id);
    });
    expect(result.current.items[0].bookId).toBe('book-2');
    expect(result.current.items[0].undo?.kind).toBe('apply');
    expect(result.current.items[0].undo?.originalMetadata).toMatchObject({
      author: 'Original Author',
    });

    const fetchSpy = vi.mocked(fetch);
    await act(async () => {
      await result.current.undo(id);
    });
    expect(result.current.items[0].proposals).toEqual(before);
    expect(result.current.items[0].undo).toBeUndefined();
    expect(result.current.items[0].bookId).toBe('book-3');
    expect(fetchSpy).toHaveBeenCalledWith(
      expect.stringMatching(/\/api\/books\/[^/]+\/lineage/),
      expect.objectContaining({ method: 'DELETE' })
    );
  });
});
