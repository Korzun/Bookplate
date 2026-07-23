import { act, renderHook } from '@testing-library/react';
import type { ReactNode } from 'react';
import { useCallback, useState } from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { Context } from '../context';
import type { Book, BookList, MetadataFix } from '../type';
import { fixKey, useUploadQueue } from './use-upload-queue';

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
 * (snapshot), PATCH .../metadata (apply, then revert), and DELETE .../lineage.
 * Pass `snapshotOk: false` to make the snapshot GET fail (e.g. network error)
 * while PATCH still succeeds, exercising the best-effort-snapshot path.
 * Pass `failLineageDelete: true` to make the lineage DELETE reject (network
 * error), exercising the best-effort-cleanup path — the revert must still
 * stand even when this fails. A revert-PATCH failure needs no separate flag:
 * just give `patchResponses[1]` (the undo re-PATCH call) `{ ok: false }`. */
function stubFetchForApplyAll(opts: {
  original: Partial<Book>;
  patchResponses: { ok: boolean; body: unknown }[];
  snapshotOk?: boolean;
  failLineageDelete?: boolean;
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
      if (opts.failLineageDelete) {
        return Promise.reject(new Error('lineage delete failed'));
      }
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
      if (opts.snapshotOk === false) {
        return Promise.reject(new Error('network error'));
      }
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

/** fetch mock for subject-split apply tests: answers GET /api/books/:id with
 * the given current `subjects`, and records every PATCH .../metadata body
 * (decoding the `subjects` field back out of the FormData JSON string) into
 * `patchBodies` so the test can assert on the composed array. */
function stubFetchWithSubjectSnapshot(subjects: string[]) {
  const patchBodies: Record<string, unknown>[] = [];
  vi.mocked(fetch).mockImplementation((input: unknown, init?: RequestInit) => {
    const url = String(input);
    const method = init?.method ?? 'GET';
    if (url === '/api/config') {
      return Promise.resolve({
        ok: true,
        json: () => Promise.resolve({ maxConcurrentUploads: 2 }),
      }) as unknown as Promise<Response>;
    }
    if (method === 'PATCH' && url.includes('/metadata')) {
      const body: Record<string, unknown> = {};
      const fd = init?.body as FormData;
      for (const [key, value] of fd.entries()) {
        body[key] = key === 'subjects' ? JSON.parse(value as string) : value;
      }
      patchBodies.push(body);
      return Promise.resolve({
        ok: true,
        json: () => Promise.resolve({ id: 'book-1' }),
      }) as unknown as Promise<Response>;
    }
    if (method === 'GET' && /^\/api\/books\/[^/]+$/.test(url)) {
      return Promise.resolve({
        ok: true,
        json: () => Promise.resolve({ subjects }),
      }) as unknown as Promise<Response>;
    }
    return Promise.resolve({
      ok: true,
      json: () => Promise.resolve({ items: [], books: [], nextCursor: null }),
    }) as unknown as Promise<Response>;
  });
  return { patchBodies };
}

/** Drives a single-file upload to `done` with the given subject-split
 * proposals, and stubs the current-subjects GET the composed apply needs.
 * Mirrors `renderQueueWithProposals` but also returns `patchBodies`. */
async function renderQueueWithSubjectProposals(fixes: MetadataFix[], currentSubjects: string[]) {
  const { patchBodies } = stubFetchWithSubjectSnapshot(currentSubjects);
  const { result } = await renderQueueWithProposals(fixes);
  return { result, patchBodies };
}

/** Stateful fetch mock for sequential-apply composition tests: unlike
 * `stubFetchWithSubjectSnapshot` (which always answers the snapshot GET with
 * a fixed array), this keeps a mutable `currentSubjects` that each successful
 * PATCH .../metadata overwrites with the body it just sent — so a later GET
 * (from a subsequent applyFix's own snapshot fetch) observes the previous
 * apply's result. Each PATCH also mints a fresh book id so the item's bookId
 * threads forward, mirroring how a real id-derived-from-metadata rename
 * would behave across calls. */
function stubFetchWithComposingSubjects(initialSubjects: string[]) {
  let currentSubjects = initialSubjects;
  let nextId = 2;
  const patchBodies: Record<string, unknown>[] = [];
  vi.mocked(fetch).mockImplementation((input: unknown, init?: RequestInit) => {
    const url = String(input);
    const method = init?.method ?? 'GET';
    if (url === '/api/config') {
      return Promise.resolve({
        ok: true,
        json: () => Promise.resolve({ maxConcurrentUploads: 2 }),
      }) as unknown as Promise<Response>;
    }
    if (method === 'PATCH' && url.includes('/metadata')) {
      const body: Record<string, unknown> = {};
      const fd = init?.body as FormData;
      for (const [key, value] of fd.entries()) {
        body[key] = key === 'subjects' ? JSON.parse(value as string) : value;
      }
      patchBodies.push(body);
      currentSubjects = body.subjects as string[];
      const id = `book-${nextId++}`;
      return Promise.resolve({
        ok: true,
        json: () => Promise.resolve({ id }),
      }) as unknown as Promise<Response>;
    }
    if (method === 'GET' && /^\/api\/books\/[^/]+$/.test(url)) {
      return Promise.resolve({
        ok: true,
        json: () => Promise.resolve({ subjects: currentSubjects }),
      }) as unknown as Promise<Response>;
    }
    return Promise.resolve({
      ok: true,
      json: () => Promise.resolve({ items: [], books: [], nextCursor: null }),
    }) as unknown as Promise<Response>;
  });
  return { patchBodies };
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

  it('upload success routes `applied` to autoFixes and leaves appliedFixes empty', async () => {
    const autoFix = makeFix({
      field: 'author',
      kind: 'author-inverted',
      from: 'Watts, Peter',
      to: 'Peter Watts',
      changes: { author: 'Peter Watts' },
    });
    const proposal = makeFix();
    stubFetchWithPatch({ ok: true, body: { id: 'book-1' } });

    const { result } = renderHook(() => useUploadQueue(), { wrapper: makeWrapper() });
    await act(async () => {
      await Promise.resolve();
    });

    act(() => {
      result.current.addFiles(makeFileList('a.epub'));
    });

    xhrInstances[0].status = 200;
    xhrInstances[0].responseText = JSON.stringify({
      results: [
        { filename: 'a.epub', bookId: 'book-1', applied: [autoFix], proposals: [proposal] },
      ],
    });
    await act(async () => {
      xhrInstances[0].onload?.(new Event('load'));
      await Promise.resolve();
    });

    // Server-applied fixes are surfaced separately as automatic fixes; only
    // user-driven applies populate appliedFixes.
    expect(result.current.items[0].autoFixes).toEqual([autoFix]);
    expect(result.current.items[0].appliedFixes ?? []).toEqual([]);
    expect(result.current.items[0].proposals).toEqual([proposal]);
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
      expect.stringMatching(/\/api\/books\/book-3\/lineage/),
      expect.objectContaining({ method: 'DELETE' })
    );
  });

  it('undo resolves false and preserves applied state + undo when the revert PATCH fails', async () => {
    const fixes = [
      makeFix(),
      makeFix({ field: 'title', kind: 'title-missing', to: 'Dune', changes: { title: 'Dune' } }),
    ];
    const { result } = await renderQueueWithProposals(fixes);
    const id = result.current.items[0].id;

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
        { ok: false, body: { error: 'Save failed' } },
      ],
    });

    await act(async () => {
      await result.current.applyAllProposals(id);
    });
    expect(result.current.items[0].bookId).toBe('book-2');
    expect(result.current.items[0].undo).toBeDefined();

    let undone: boolean | undefined;
    await act(async () => {
      undone = await result.current.undo(id);
    });

    expect(undone).toBe(false);
    // Applied state stands: proposals still emptied, appliedFixes still holds the fixes.
    expect(result.current.items[0].proposals).toEqual([]);
    expect(result.current.items[0].appliedFixes).toEqual(fixes);
    // Undo snapshot is preserved (not cleared) so the user can retry.
    expect(result.current.items[0].undo).toBeDefined();
    expect(result.current.items[0].bookId).toBe('book-2');
  });

  it('undo still resolves true and the card is restored when the lineage DELETE fails', async () => {
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
      failLineageDelete: true,
    });

    await act(async () => {
      await result.current.applyAllProposals(id);
    });
    expect(result.current.items[0].bookId).toBe('book-2');

    let undone: boolean | undefined;
    await act(async () => {
      undone = await result.current.undo(id);
    });

    expect(undone).toBe(true);
    expect(result.current.items[0].proposals).toEqual(before);
    expect(result.current.items[0].undo).toBeUndefined();
    expect(result.current.items[0].bookId).toBe('book-3');
  });

  it('applyAllProposals still applies when the snapshot GET fails, but arms no undo', async () => {
    const fixes = [
      makeFix(),
      makeFix({ field: 'title', kind: 'title-missing', to: 'Dune', changes: { title: 'Dune' } }),
    ];
    const { result } = await renderQueueWithProposals(fixes);
    const id = result.current.items[0].id;

    stubFetchForApplyAll({
      original: {},
      snapshotOk: false,
      patchResponses: [{ ok: true, body: { id: 'book-2' } }],
    });

    let succeeded: boolean | undefined;
    await act(async () => {
      succeeded = await result.current.applyAllProposals(id);
    });

    expect(succeeded).toBe(true);
    expect(result.current.items[0].bookId).toBe('book-2');
    expect(result.current.items[0].proposals).toEqual([]);
    expect(result.current.items[0].appliedFixes).toEqual(fixes);
    expect(result.current.items[0].undo).toBeUndefined();
  });

  it('fixKey distinguishes two subject-split fixes by their compound', () => {
    const a = makeFix({ field: 'subjects', kind: 'subjects-split', from: 'A & B', to: 'A, B' });
    const b = makeFix({ field: 'subjects', kind: 'subjects-split', from: 'C & D', to: 'C, D' });
    expect(fixKey(a)).not.toBe(fixKey(b));
  });

  it("applies a subject split by composing against the book's current subjects", async () => {
    const splitFix: MetadataFix = {
      field: 'subjects',
      kind: 'subjects-split',
      from: 'Sci-Fi & Fantasy',
      to: 'Sci-Fi, Fantasy',
      changes: {},
      fromChips: ['Sci-Fi & Fantasy'],
      toChips: ['Sci-Fi', 'Fantasy'],
    };
    const { result, patchBodies } = await renderQueueWithSubjectProposals(
      [splitFix],
      ['Sci-Fi & Fantasy', 'History']
    );

    const id = result.current.items[0].id;
    let succeeded: boolean | undefined;
    await act(async () => {
      succeeded = await result.current.applyFix(id, result.current.items[0].proposals![0]);
    });

    expect(succeeded).toBe(true);
    // The PATCH replaces the compound with its parts, keeping the untouched subject.
    expect(patchBodies.at(-1)?.subjects).toEqual(['Sci-Fi', 'Fantasy', 'History']);
    expect(result.current.items[0].proposals).toEqual([]);
  });

  it('resolves false and does not PATCH when the current-subjects GET fails', async () => {
    const splitFix: MetadataFix = {
      field: 'subjects',
      kind: 'subjects-split',
      from: 'Sci-Fi & Fantasy',
      to: 'Sci-Fi, Fantasy',
      changes: {},
      fromChips: ['Sci-Fi & Fantasy'],
      toChips: ['Sci-Fi', 'Fantasy'],
    };
    const { result } = await renderQueueWithSubjectProposals([splitFix], ['Sci-Fi & Fantasy']);
    // Make the snapshot GET fail after the item is seeded.
    vi.mocked(fetch).mockImplementation((input: unknown, init?: RequestInit) => {
      const url = String(input);
      const method = init?.method ?? 'GET';
      if (method === 'GET' && /^\/api\/books\/[^/]+$/.test(url)) {
        return Promise.reject(new Error('network error'));
      }
      return Promise.resolve({
        ok: true,
        json: () => Promise.resolve({ items: [], books: [], nextCursor: null }),
      }) as unknown as Promise<Response>;
    });

    const id = result.current.items[0].id;
    let succeeded: boolean | undefined;
    await act(async () => {
      succeeded = await result.current.applyFix(id, result.current.items[0].proposals![0]);
    });

    expect(succeeded).toBe(false);
    const patchCalls = vi
      .mocked(fetch)
      .mock.calls.filter((c) => (c[1] as RequestInit | undefined)?.method === 'PATCH');
    expect(patchCalls).toEqual([]);
    expect(result.current.items[0].proposals).toEqual([splitFix]);
  });

  it('dismissing one subject fix leaves the other', async () => {
    const fixes: MetadataFix[] = [
      {
        field: 'subjects',
        kind: 'subjects-split',
        from: 'A & B',
        to: 'A, B',
        changes: {},
        fromChips: ['A & B'],
        toChips: ['A', 'B'],
      },
      {
        field: 'subjects',
        kind: 'subjects-split',
        from: 'C & D',
        to: 'C, D',
        changes: {},
        fromChips: ['C & D'],
        toChips: ['C', 'D'],
      },
    ];
    const { result } = await renderQueueWithProposals(fixes);
    const id = result.current.items[0].id;

    act(() => result.current.dismissFix(id, result.current.items[0].proposals![0]));

    expect(result.current.items[0].proposals!.map((p) => p.from)).toEqual(['C & D']);
  });

  it('applyAllProposals folds multiple subject splits into one PATCH with cross-compound dedupe', async () => {
    const fixA: MetadataFix = {
      field: 'subjects',
      kind: 'subjects-split',
      from: 'A & Fiction',
      to: 'A, Fiction',
      changes: {},
      fromChips: ['A & Fiction'],
      toChips: ['A', 'Fiction'],
    };
    const fixB: MetadataFix = {
      field: 'subjects',
      kind: 'subjects-split',
      from: 'B & Fiction',
      to: 'B, Fiction',
      changes: {},
      fromChips: ['B & Fiction'],
      toChips: ['B', 'Fiction'],
    };
    const { result, patchBodies } = await renderQueueWithSubjectProposals(
      [fixA, fixB],
      ['A & Fiction', 'B & Fiction', 'History']
    );

    const id = result.current.items[0].id;
    let succeeded: boolean | undefined;
    await act(async () => {
      succeeded = await result.current.applyAllProposals(id);
    });

    expect(succeeded).toBe(true);
    // Apply-all reuses its own snapshot as `knownSubjects`, so applyPatch does
    // not issue a second GET before the PATCH — exactly one GET, one PATCH.
    const bookGetCalls = vi
      .mocked(fetch)
      .mock.calls.filter(
        (c) =>
          /^\/api\/books\/[^/]+$/.test(String(c[0])) &&
          (c[1] as RequestInit | undefined)?.method !== 'PATCH'
      );
    expect(bookGetCalls).toHaveLength(1);
    const patchCalls = vi
      .mocked(fetch)
      .mock.calls.filter((c) => (c[1] as RequestInit | undefined)?.method === 'PATCH');
    expect(patchCalls).toHaveLength(1);
    expect(patchBodies).toHaveLength(1);
    // Both compounds fold into one array; the 'Fiction' shared by both splits
    // collapses to a single entry instead of appearing twice.
    expect(patchBodies[0].subjects).toEqual(['A', 'Fiction', 'B', 'History']);
    expect(result.current.items[0].proposals).toEqual([]);
  });

  it('applyFix composes sequential subject splits against the result of the previous apply', async () => {
    const fix1: MetadataFix = {
      field: 'subjects',
      kind: 'subjects-split',
      from: 'Sci-Fi & Fantasy',
      to: 'Sci-Fi, Fantasy',
      changes: {},
      fromChips: ['Sci-Fi & Fantasy'],
      toChips: ['Sci-Fi', 'Fantasy'],
    };
    const fix2: MetadataFix = {
      field: 'subjects',
      kind: 'subjects-split',
      from: 'Arts & Crafts',
      to: 'Arts, Crafts',
      changes: {},
      fromChips: ['Arts & Crafts'],
      toChips: ['Arts', 'Crafts'],
    };
    const { patchBodies } = stubFetchWithComposingSubjects([
      'Sci-Fi & Fantasy',
      'Arts & Crafts',
      'History',
    ]);
    const { result } = await renderQueueWithProposals([fix1, fix2]);
    const id = result.current.items[0].id;

    let firstOk: boolean | undefined;
    await act(async () => {
      firstOk = await result.current.applyFix(id, fix1);
    });
    expect(firstOk).toBe(true);
    expect(patchBodies[0].subjects).toEqual(['Sci-Fi', 'Fantasy', 'Arts & Crafts', 'History']);

    let secondOk: boolean | undefined;
    await act(async () => {
      secondOk = await result.current.applyFix(id, fix2);
    });
    expect(secondOk).toBe(true);

    expect(patchBodies).toHaveLength(2);
    // The second apply's PATCH must be composed against the first apply's
    // result (read back via the snapshot GET), not a stale precomputed array
    // from before fix1 was applied — otherwise 'Sci-Fi'/'Fantasy' would be
    // lost or 'Sci-Fi & Fantasy' would reappear.
    expect(patchBodies[1].subjects).toEqual(['Sci-Fi', 'Fantasy', 'Arts', 'Crafts', 'History']);
  });
});
