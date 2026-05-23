# Upload Page Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Move UploadZone and LibraryScan to a dedicated `/upload` page with per-file XHR upload progress and inline status.

**Architecture:** A new `useUploadQueue` hook owns all upload state (XHR per file, rolling concurrency up to `maxConcurrentUploads`). A new `UploadPage` renders a drop zone, per-file `UploadItem` rows, and an admin-only `LibraryScan` button. The `/upload` route is added to the router and header nav (visible to all logged-in users).

**Tech Stack:** React 18, JSS (`createUseStyles`), Vitest, `XMLHttpRequest` (upload progress), React Router v6, Express + supertest (server tests)

---

## File Map

| Path | Change |
|---|---|
| `config.yaml` | Add `max_concurrent_uploads: 3` option + schema |
| `app/types.ts` | Add `maxConcurrentUploads: number` to `AppConfig` |
| `app/config.ts` | Load `max_concurrent_uploads` from `options.json` |
| `app/routes/ui.ts` | Add `GET /api/config` + `GET /upload` SPA route |
| `app/routes/ui.test.ts` | Tests for `GET /api/config` |
| `client/src/icon/clock.tsx` | New Tabler stroke icon |
| `client/src/icon/upload.tsx` | New Tabler stroke icon |
| `client/src/icon/index.ts` | Export `ClockIcon`, `UploadIcon` |
| `client/src/provider/book/hook/use-upload-queue.ts` | New hook — XHR queue, concurrency, state |
| `client/src/provider/book/hook/use-upload-queue.test.tsx` | Tests |
| `client/src/provider/book/hook/index.ts` | Export `useUploadQueue` |
| `client/src/provider/book/index.ts` | Export `UploadItem`, `UploadItemStatus` types |
| `client/src/component/upload-item/index.tsx` | New component |
| `client/src/component/upload-item/style.ts` | Styles |
| `client/src/component/index.ts` | Export `UploadItem` |
| `client/src/component/upload-zone/index.tsx` | Accept `addFiles` prop, remove toast |
| `client/src/component/library-scan/index.tsx` | Inline result instead of Toast |
| `client/src/component/library-scan/style.ts` | Add `result` style |
| `client/src/page/upload/index.tsx` | New page |
| `client/src/page/upload/style.ts` | Styles |
| `client/src/page/index.ts` | Export `UploadPage` |
| `client/src/page/library/index.tsx` | Remove `UploadZone`, `LibraryScan` |
| `client/src/router/path-internal.ts` | Add `upload()` |
| `client/src/router/path.ts` | Add `upload()` |
| `client/src/router/component.tsx` | Add `/upload` route |
| `client/src/component/header/index.tsx` | Add Upload nav link (all users) |

---

### Task 1: Server config — `maxConcurrentUploads`

**Files:**
- Modify: `config.yaml`
- Modify: `app/types.ts`
- Modify: `app/config.ts`

- [ ] **Step 1: Update `config.yaml`**

```yaml
# config.yaml — add inside options: and schema:
options:
  username: admin
  password: changeme
  max_concurrent_uploads: 3
schema:
  username: str
  password: str
  max_concurrent_uploads: int
```

- [ ] **Step 2: Add field to `AppConfig` in `app/types.ts`**

```typescript
// app/types.ts — add to AppConfig interface
export interface AppConfig {
  username: string;
  password: string;
  booksDir: string;
  dataDir: string;
  port: number;
  maxConcurrentUploads: number;
}
```

- [ ] **Step 3: Load field in `app/config.ts`**

Replace the entire `loadConfig` function:

```typescript
// app/config.ts
import * as fs from 'fs';
import * as path from 'path';
import { AppConfig } from './types';
import { logger } from './logger';

const log = logger('Config');

interface Options {
  username: string;
  password: string;
  max_concurrent_uploads: number;
}

export function loadConfig(): AppConfig {
  const dataDir = process.env.DATA_DIR ?? '/data';
  const optionsPath = path.join(dataDir, 'options.json');

  let options: Options = { username: 'admin', password: 'changeme', max_concurrent_uploads: 3 };

  if (fs.existsSync(optionsPath)) {
    try {
      const parsed = JSON.parse(fs.readFileSync(optionsPath, 'utf-8')) as Partial<Options>;
      options = {
        username: parsed.username ?? options.username,
        password: parsed.password ?? options.password,
        max_concurrent_uploads: parsed.max_concurrent_uploads ?? options.max_concurrent_uploads,
      };
    } catch {
      log.warn(`Could not parse ${optionsPath}, using defaults`);
    }
  }

  return {
    username: process.env.ADMIN_USER ?? options.username,
    password: process.env.ADMIN_PASS ?? options.password,
    booksDir: process.env.BOOKS_DIR ?? '/media/books',
    dataDir,
    port: parseInt(process.env.PORT ?? '3000', 10),
    maxConcurrentUploads: options.max_concurrent_uploads,
  };
}
```

- [ ] **Step 4: Verify TypeScript compiles**

```bash
npm run lint
```

Expected: no errors.

- [ ] **Step 5: Commit**

```bash
git add config.yaml app/types.ts app/config.ts
git commit -m "feat: add maxConcurrentUploads to HA config and AppConfig"
```

---

### Task 2: `GET /api/config` endpoint

**Files:**
- Modify: `app/routes/ui.ts`
- Modify: `app/routes/ui.test.ts`

- [ ] **Step 1: Write failing tests**

Add to `app/routes/ui.test.ts` before the closing line, after the existing `describe` blocks:

```typescript
describe('GET /api/config', () => {
  it('redirects to /login without session', async () => {
    const res = await request(app).get('/api/config');
    expect(res.status).toBe(302);
  });

  it('returns maxConcurrentUploads for authenticated user', async () => {
    const agent = await adminAgent();
    const res = await agent.get('/api/config');
    expect(res.status).toBe(200);
    expect(res.body).toEqual({ maxConcurrentUploads: 3 });
  });

  it('returns maxConcurrentUploads for regular user', async () => {
    const agent = await userAgent();
    const res = await agent.get('/api/config');
    expect(res.status).toBe(200);
    expect(res.body).toEqual({ maxConcurrentUploads: 3 });
  });
});
```

Note: the `config` object in `ui.test.ts` has no `maxConcurrentUploads` yet — add it now:

```typescript
// In ui.test.ts, update the config constant
const config: AppConfig = {
  username: 'admin',
  password: 'pass',
  booksDir: '',
  dataDir: '/tmp',
  port: 3000,
  maxConcurrentUploads: 3,
};
```

- [ ] **Step 2: Run tests to verify they fail**

```bash
npm test -- --testPathPattern=app/routes/ui.test.ts
```

Expected: the three new `GET /api/config` tests fail with 404.

- [ ] **Step 3: Add the endpoint to `app/routes/ui.ts`**

Add after the `GET /api/me` handler (around line 88):

```typescript
router.get('/api/config', sessionAuth, (_req: Request, res: Response) => {
  res.json({ maxConcurrentUploads: config.maxConcurrentUploads });
});
```

- [ ] **Step 4: Run tests to verify they pass**

```bash
npm test -- --testPathPattern=app/routes/ui.test.ts
```

Expected: all tests pass.

- [ ] **Step 5: Commit**

```bash
git add app/routes/ui.ts app/routes/ui.test.ts
git commit -m "feat: add GET /api/config endpoint"
```

---

### Task 3: `ClockIcon` and `UploadIcon`

**Files:**
- Create: `client/src/icon/clock.tsx`
- Create: `client/src/icon/upload.tsx`
- Modify: `client/src/icon/index.ts`

- [ ] **Step 1: Create `client/src/icon/clock.tsx`**

```typescript
import { IconProps, defaultStrokeIconProps } from './props';

// https://tabler.io/icons/icon/clock
export const ClockIcon = (props: IconProps) => {
  const { className, fill, height, stroke, strokeWidth, width } = {
    ...defaultStrokeIconProps,
    ...props,
  };

  return (
    <svg
      className={className}
      fill={fill}
      height={height}
      stroke={stroke}
      strokeLinecap="round"
      strokeLinejoin="round"
      strokeWidth={strokeWidth}
      viewBox="0 0 24 24"
      width={width}
      xmlns="http://www.w3.org/2000/svg"
    >
      <path stroke="none" d="M0 0h24v24H0z" fill="none" />
      <path d="M3 12a9 9 0 1 0 18 0a9 9 0 0 0 -18 0" />
      <path d="M12 7v5l3 3" />
    </svg>
  );
};
```

- [ ] **Step 2: Create `client/src/icon/upload.tsx`**

```typescript
import { IconProps, defaultStrokeIconProps } from './props';

// https://tabler.io/icons/icon/upload
export const UploadIcon = (props: IconProps) => {
  const { className, fill, height, stroke, strokeWidth, width } = {
    ...defaultStrokeIconProps,
    ...props,
  };

  return (
    <svg
      className={className}
      fill={fill}
      height={height}
      stroke={stroke}
      strokeLinecap="round"
      strokeLinejoin="round"
      strokeWidth={strokeWidth}
      viewBox="0 0 24 24"
      width={width}
      xmlns="http://www.w3.org/2000/svg"
    >
      <path stroke="none" d="M0 0h24v24H0z" fill="none" />
      <path d="M4 17v2a2 2 0 0 0 2 2h12a2 2 0 0 0 2 -2v-2" />
      <path d="M7 9l5 -5l5 5" />
      <path d="M12 4l0 12" />
    </svg>
  );
};
```

- [ ] **Step 3: Export from `client/src/icon/index.ts`**

```typescript
export { AlertOctagonIcon } from './alert-octagon';
export { BookIcon } from './book';
export { BooksIcon } from './books';
export { CheckIcon } from './check';
export { CircleXIcon } from './circle-x';
export { ClockIcon } from './clock';
export { ListCheckIcon } from './list-check';
export { RowRemoveIcon } from './row-remove';
export { UploadIcon } from './upload';
export { UsersIcon } from './users';
export { XIcon } from './x';

export type { IconProps } from './props';
export { defaultFilledIconProps, defaultStrokeIconProps } from './props';
```

- [ ] **Step 4: Verify TypeScript compiles**

```bash
npm --prefix client run type
```

Expected: no errors.

- [ ] **Step 5: Commit**

```bash
git add client/src/icon/clock.tsx client/src/icon/upload.tsx client/src/icon/index.ts
git commit -m "feat: add ClockIcon and UploadIcon from Tabler"
```

---

### Task 4: `useUploadQueue` hook

**Files:**
- Create: `client/src/provider/book/hook/use-upload-queue.test.tsx`
- Create: `client/src/provider/book/hook/use-upload-queue.ts`
- Modify: `client/src/provider/book/hook/index.ts`
- Modify: `client/src/provider/book/index.ts`

- [ ] **Step 1: Write the failing tests**

Create `client/src/provider/book/hook/use-upload-queue.test.tsx`:

```typescript
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
      return Promise.resolve({ ok: true, json: () => Promise.resolve([]) });
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
    expect(fetchCalls).toContain('/api/books');
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
});
```

- [ ] **Step 2: Run tests to verify they fail**

```bash
npm --prefix client test
```

Expected: all 8 new tests fail — "Cannot find module './use-upload-queue'".

- [ ] **Step 3: Implement `use-upload-queue.ts`**

Create `client/src/provider/book/hook/use-upload-queue.ts`:

```typescript
import { useCallback, useContext, useEffect, useRef, useState } from 'react';

import { Context } from '../context';

import { useFetchBookList } from './use-fetch-book-list';

export type UploadItemStatus = 'queued' | 'uploading' | 'done' | 'error';

export type UploadItem = {
  id: string;
  file: File;
  status: UploadItemStatus;
  bytesUploaded: number;
  errorMessage?: string;
};

export type UseUploadQueue = {
  items: UploadItem[];
  addFiles: (files: FileList) => void;
};

export const useUploadQueue = (): UseUploadQueue => {
  const [items, setItems] = useState<UploadItem[]>([]);
  const [maxConcurrent, setMaxConcurrent] = useState(3);
  const fetchBookList = useFetchBookList();
  const { clearCompleteBookIds } = useContext(Context);

  // IDs of items whose XHR has been created — prevents double-starting across renders
  const startedRef = useRef(new Set<string>());
  // Active XHRs keyed by item ID — used for cleanup on unmount
  const xhrMapRef = useRef(new Map<string, XMLHttpRequest>());
  // Stable counter for generating unique IDs within this hook instance
  const nextIdRef = useRef(0);

  // Fetch server config on mount
  useEffect(() => {
    void fetch('/api/config')
      .then((r) => r.json() as Promise<{ maxConcurrentUploads: number }>)
      .then((cfg) => setMaxConcurrent(cfg.maxConcurrentUploads))
      .catch(() => {
        // keep default of 3 on failure
      });
  }, []);

  // Abort in-flight XHRs when the page unmounts
  useEffect(() => {
    return () => {
      for (const xhr of xhrMapRef.current.values()) {
        xhr.abort();
      }
    };
  }, []);

  // Rolling concurrency: start uploads whenever a slot is free
  useEffect(() => {
    const inFlight = startedRef.current.size;
    const slots = maxConcurrent - inFlight;
    if (slots <= 0) return;

    const toStart = items
      .filter((i) => i.status === 'queued' && !startedRef.current.has(i.id))
      .slice(0, slots);

    for (const item of toStart) {
      startedRef.current.add(item.id);

      setItems((prev) =>
        prev.map((i) => (i.id === item.id ? { ...i, status: 'uploading' as const } : i))
      );

      const xhr = new XMLHttpRequest();
      xhrMapRef.current.set(item.id, xhr);

      xhr.upload.onprogress = (e: ProgressEvent) => {
        if (e.lengthComputable) {
          setItems((prev) =>
            prev.map((i) => (i.id === item.id ? { ...i, bytesUploaded: e.loaded } : i))
          );
        }
      };

      xhr.onload = () => {
        startedRef.current.delete(item.id);
        xhrMapRef.current.delete(item.id);

        if (xhr.status >= 200 && xhr.status < 300) {
          setItems((prev) =>
            prev.map((i) =>
              i.id === item.id
                ? { ...i, status: 'done' as const, bytesUploaded: item.file.size }
                : i
            )
          );
          clearCompleteBookIds();
          void fetchBookList();
        } else {
          let errorMessage: string | undefined;
          try {
            const data = JSON.parse(xhr.responseText) as { error?: string };
            errorMessage = data.error;
          } catch {
            // no structured error
          }
          setItems((prev) =>
            prev.map((i) =>
              i.id === item.id ? { ...i, status: 'error' as const, errorMessage } : i
            )
          );
        }
      };

      xhr.onerror = () => {
        startedRef.current.delete(item.id);
        xhrMapRef.current.delete(item.id);
        setItems((prev) =>
          prev.map((i) => (i.id === item.id ? { ...i, status: 'error' as const } : i))
        );
      };

      xhr.open('POST', '/api/books/upload');
      const formData = new FormData();
      formData.append('files', item.file);
      xhr.send(formData);
    }
  }, [items, maxConcurrent, fetchBookList, clearCompleteBookIds]);

  const addFiles = useCallback((files: FileList) => {
    const newItems: UploadItem[] = Array.from(files).map((file) => ({
      id: String(nextIdRef.current++),
      file,
      status: 'queued' as const,
      bytesUploaded: 0,
    }));
    setItems((prev) => [...prev, ...newItems]);
  }, []);

  return { items, addFiles };
};
```

- [ ] **Step 4: Run tests to verify they pass**

```bash
npm --prefix client test
```

Expected: all 8 new tests pass; existing tests unaffected.

- [ ] **Step 5: Export from `client/src/provider/book/hook/index.ts`**

Add `useUploadQueue` export:

```typescript
export { useBook } from './use-book';
export { useBookList } from './use-book-list';
export { useDeleteBook } from './use-delete-book';
export { useFetchBook } from './use-fetch-book';
export { useFetchBookList } from './use-fetch-book-list';
export { usePatchBookMetadata } from './use-patch-book-metadata';
export { useScanLibrary } from './use-scan-library';
export { useSeriesBookList } from './use-series-book-list';
export { useSeriesList } from './use-series-list';
export { useStandaloneBookList } from './use-standalone-book-list';
export { useUploadBookList } from './use-upload-book-list';
export { useUploadQueue } from './use-upload-queue';
```

- [ ] **Step 6: Export types from `client/src/provider/book/index.ts`**

```typescript
export {
  useBook,
  useBookList,
  useDeleteBook,
  useFetchBook,
  useFetchBookList,
  usePatchBookMetadata,
  useScanLibrary,
  useSeriesList,
  useSeriesBookList,
  useStandaloneBookList,
  useUploadBookList,
  useUploadQueue,
} from './hook';
export { BookProvider } from './provider';
export type { BookList, Book, Identifier, Series, UploadResult } from './type';
export type { UploadItem, UploadItemStatus, UseUploadQueue } from './hook/use-upload-queue';
```

- [ ] **Step 7: Run lint**

```bash
npm run lint
```

Expected: no errors.

- [ ] **Step 8: Commit**

```bash
git add client/src/provider/book/hook/use-upload-queue.ts \
        client/src/provider/book/hook/use-upload-queue.test.tsx \
        client/src/provider/book/hook/index.ts \
        client/src/provider/book/index.ts
git commit -m "feat: add useUploadQueue hook with XHR per-file progress and rolling concurrency"
```

---

### Task 5: `UploadItem` component

**Files:**
- Create: `client/src/component/upload-item/index.test.tsx`
- Create: `client/src/component/upload-item/style.ts`
- Create: `client/src/component/upload-item/index.tsx`
- Modify: `client/src/component/index.ts`

- [ ] **Step 1: Write failing tests**

Create `client/src/component/upload-item/index.test.tsx`:

```typescript
import { render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';

import type { UploadItem as UploadItemType } from '~/provider/book';

import { UploadItem } from './index';

function makeItem(overrides: Partial<UploadItemType>): UploadItemType {
  return {
    id: '1',
    file: new File(['x'.repeat(1_048_576)], 'test.epub'), // 1 MB
    status: 'queued',
    bytesUploaded: 0,
    ...overrides,
  };
}

describe('UploadItem', () => {
  it('shows filename', () => {
    render(<UploadItem item={makeItem({ file: new File([''], 'dune.epub') })} />);
    expect(screen.getByText('dune.epub')).toBeTruthy();
  });

  it('queued: shows total MB and no error border', () => {
    render(<UploadItem item={makeItem({ status: 'queued' })} />);
    expect(screen.getByText('1.0 MB')).toBeTruthy();
  });

  it('uploading: shows uploaded/total MB', () => {
    render(
      <UploadItem
        item={makeItem({ status: 'uploading', bytesUploaded: 524_288 })}
      />
    );
    expect(screen.getByText('0.5 / 1.0 MB')).toBeTruthy();
  });

  it('done: shows full MB label', () => {
    render(
      <UploadItem
        item={makeItem({ status: 'done', bytesUploaded: 1_048_576 })}
      />
    );
    expect(screen.getByText('1.0 / 1.0 MB')).toBeTruthy();
  });

  it('error: shows error message', () => {
    render(
      <UploadItem
        item={makeItem({ status: 'error', errorMessage: 'Invalid EPUB' })}
      />
    );
    expect(screen.getByText('Invalid EPUB')).toBeTruthy();
  });

  it('error: shows fallback text when no errorMessage', () => {
    render(<UploadItem item={makeItem({ status: 'error' })} />);
    expect(screen.getByText('Upload failed')).toBeTruthy();
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

```bash
npm --prefix client test
```

Expected: all 6 new tests fail — "Cannot find module './index'".

- [ ] **Step 4: Create `client/src/component/upload-item/style.ts`**

```typescript
import { createUseStyles, type Theme } from '~/provider/theme';

export const useStyle = createUseStyles((theme: Theme) => ({
  root: {
    background: theme.colors.bg.card,
    border: `1px solid ${theme.colors.border}`,
    borderRadius: theme.borderRadius.md,
    padding: '0.625rem 0.75rem',
    display: 'flex',
    alignItems: 'center',
    gap: '0.625rem',
  },
  rootError: {
    background: theme.colors.bg.card,
    border: `1px solid ${theme.colors.danger}`,
    borderRadius: theme.borderRadius.md,
    padding: '0.625rem 0.75rem',
    display: 'flex',
    alignItems: 'center',
    gap: '0.625rem',
  },
  iconWrapperQueued: {
    width: 28,
    height: 28,
    borderRadius: '50%',
    background: theme.colors.borderLight,
    color: theme.colors.text.muted,
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    flexShrink: 0,
  },
  iconWrapperUploading: {
    width: 28,
    height: 28,
    borderRadius: '50%',
    background: theme.colors.primaryLight,
    color: theme.colors.primaryHover,
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    flexShrink: 0,
  },
  iconWrapperDone: {
    width: 28,
    height: 28,
    borderRadius: '50%',
    background: '#dcfce7',
    color: theme.colors.success,
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    flexShrink: 0,
  },
  iconWrapperError: {
    width: 28,
    height: 28,
    borderRadius: '50%',
    background: '#fee2e2',
    color: theme.colors.danger,
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    flexShrink: 0,
  },
  content: {
    flex: 1,
    minWidth: 0,
  },
  filename: {
    fontSize: theme.text.size.md,
    color: theme.colors.text.primary,
    fontWeight: 500,
    whiteSpace: 'nowrap',
    overflow: 'hidden',
    textOverflow: 'ellipsis',
  },
  progressRow: {
    display: 'flex',
    alignItems: 'center',
    gap: '0.375rem',
    marginTop: '0.25rem',
  },
  barTrack: {
    flex: 1,
    height: 4,
    background: theme.colors.borderLight,
    borderRadius: 2,
    overflow: 'hidden',
  },
  barFillQueued: {
    height: '100%',
    borderRadius: 2,
    width: '0%',
  },
  barFillUploading: {
    height: '100%',
    borderRadius: 2,
    background: theme.colors.primary,
    transition: 'width 0.1s ease',
  },
  barFillDone: {
    height: '100%',
    borderRadius: 2,
    background: theme.colors.success,
  },
  barFillError: {
    height: '100%',
    borderRadius: 2,
    background: theme.colors.danger,
  },
  label: {
    fontSize: theme.text.size.sm,
    color: theme.colors.text.faint,
    whiteSpace: 'nowrap',
    flexShrink: 0,
  },
  labelDone: {
    fontSize: theme.text.size.sm,
    color: theme.colors.success,
    whiteSpace: 'nowrap',
    flexShrink: 0,
  },
  labelError: {
    fontSize: theme.text.size.sm,
    color: theme.colors.danger,
    whiteSpace: 'nowrap',
    flexShrink: 0,
    overflow: 'hidden',
    textOverflow: 'ellipsis',
    maxWidth: '12rem',
  },
}));
```

- [ ] **Step 5: Create `client/src/component/upload-item/index.tsx`**

```typescript
import { CheckIcon, CircleXIcon, ClockIcon, UploadIcon } from '~/icon';
import type { UploadItem as UploadItemType } from '~/provider/book';

import { useStyle } from './style';

interface Props {
  item: UploadItemType;
}

export const UploadItem = ({ item }: Props) => {
  const styles = useStyle();
  const { file, status, bytesUploaded, errorMessage } = item;

  const totalMB = (file.size / 1_048_576).toFixed(1);
  const uploadedMB = (bytesUploaded / 1_048_576).toFixed(1);
  const progressPercent =
    file.size > 0 ? Math.min((bytesUploaded / file.size) * 100, 100) : 0;

  const iconWrapperClass = {
    queued: styles.iconWrapperQueued,
    uploading: styles.iconWrapperUploading,
    done: styles.iconWrapperDone,
    error: styles.iconWrapperError,
  }[status];

  const barFillClass = {
    queued: styles.barFillQueued,
    uploading: styles.barFillUploading,
    done: styles.barFillDone,
    error: styles.barFillError,
  }[status];

  const rightLabel =
    status === 'error'
      ? (errorMessage ?? 'Upload failed')
      : status === 'queued'
        ? `${totalMB} MB`
        : status === 'done'
          ? `${totalMB} / ${totalMB} MB`
          : `${uploadedMB} / ${totalMB} MB`;

  const rightLabelClass =
    status === 'done' ? styles.labelDone : status === 'error' ? styles.labelError : styles.label;

  return (
    <div className={status === 'error' ? styles.rootError : styles.root}>
      <div className={iconWrapperClass}>
        {status === 'queued' && <ClockIcon height={16} width={16} />}
        {status === 'uploading' && <UploadIcon height={16} width={16} />}
        {status === 'done' && <CheckIcon height={16} width={16} />}
        {status === 'error' && <CircleXIcon height={16} width={16} />}
      </div>
      <div className={styles.content}>
        <div className={styles.filename}>{file.name}</div>
        <div className={styles.progressRow}>
          <div className={styles.barTrack}>
            <div
              className={barFillClass}
              style={{ width: `${progressPercent}%` }}
            />
          </div>
          <div className={rightLabelClass}>{rightLabel}</div>
        </div>
      </div>
    </div>
  );
};
```

- [ ] **Step 6: Run tests to verify they pass**

```bash
npm --prefix client test
```

Expected: all 6 `UploadItem` tests pass.

- [ ] **Step 7: Export from `client/src/component/index.ts`**

```typescript
export { BookRow } from './book-row';
export { Card } from './card';
export { CollapsibleSection } from './collapsible-section';
export { Cover } from './cover';
export { CoverStack } from './cover-stack';
export { Header } from './header';
export { LibraryScan } from './library-scan';
export { Page } from './page';
export { SeriesRow } from './series-row';
export { Tag } from './tag';
export { Toast } from './toast';
export { UploadItem } from './upload-item';
export { UploadZone } from './upload-zone';
export { UserBookRow } from './user-book-row';
export { UserList } from './user-list';
export { UserRegister } from './user-register';
export { UserRow } from './user-row';
```

- [ ] **Step 8: Verify TypeScript compiles**

```bash
npm --prefix client run type
```

Expected: no errors.

- [ ] **Step 9: Commit**

```bash
git add client/src/component/upload-item/ client/src/component/index.ts
git commit -m "feat: add UploadItem component"
```

---

### Task 6: Refactor `UploadZone`

**Files:**
- Modify: `client/src/component/upload-zone/index.tsx`

`UploadZone` is simplified to a pure drop zone that accepts `addFiles` as a prop. All upload logic and toast state is removed.

- [ ] **Step 1: Replace `client/src/component/upload-zone/index.tsx`**

```typescript
import { useCallback, useState } from 'react';

import { Card } from '../card';

import { useStyle } from './style';

interface Props {
  addFiles: (files: FileList) => void;
}

export const UploadZone = ({ addFiles }: Props) => {
  const styles = useStyle();

  const [dragOver, setDragOver] = useState<boolean>(false);

  const handleDragOver = useCallback((event: React.DragEvent<HTMLDivElement>) => {
    event.preventDefault();
    setDragOver(true);
  }, []);

  const handleDragLeave = useCallback((event: React.DragEvent<HTMLDivElement>) => {
    event.preventDefault();
    setDragOver(false);
  }, []);

  const handleDrop = useCallback(
    (event: React.DragEvent<HTMLDivElement>) => {
      event.preventDefault();
      setDragOver(false);
      addFiles(event.dataTransfer.files);
    },
    [addFiles]
  );

  return (
    <Card>
      <div
        className={dragOver ? styles.dropZoneOver : styles.dropZone}
        onDragOver={handleDragOver}
        onDragLeave={handleDragLeave}
        onDrop={handleDrop}
      >
        <input
          id="upload-file-input"
          type="file"
          accept=".epub"
          multiple
          style={{ display: 'none' }}
          onChange={(e) => {
            if (e.target.files) addFiles(e.target.files);
            e.target.value = '';
          }}
        />
        <div className={styles.dropText}>
          Drop books or{' '}
          <label
            htmlFor="upload-file-input"
            style={{ textDecoration: 'underline', cursor: 'pointer' }}
          >
            click here
          </label>{' '}
          to upload
        </div>
      </div>
    </Card>
  );
};
```

- [ ] **Step 2: Verify TypeScript compiles**

```bash
npm --prefix client run type
```

Expected: TypeScript may complain that `UploadZone` is still called without `addFiles` in `LibraryPage` — that will be fixed in Task 8. If the only error is `client/src/page/library/index.tsx`, proceed.

- [ ] **Step 3: Commit**

```bash
git add client/src/component/upload-zone/index.tsx
git commit -m "refactor: simplify UploadZone to accept addFiles prop"
```

---

### Task 7: Refactor `LibraryScan`

**Files:**
- Modify: `client/src/component/library-scan/index.tsx`
- Modify: `client/src/component/library-scan/style.ts`

Replace the `Toast` with an inline result text line below the button.

- [ ] **Step 1: Update `client/src/component/library-scan/style.ts`**

```typescript
import { createUseStyles, type Theme } from '~/provider/theme';

export const useStyle = createUseStyles((theme: Theme) => ({
  root: {
    marginBottom: '1rem',
    display: 'flex',
    flexDirection: 'column',
    alignItems: 'flex-end',
    gap: '0.375rem',
  },
  result: {
    fontSize: theme.text.size.md,
    color: theme.colors.text.muted,
  },
  resultError: {
    fontSize: theme.text.size.md,
    color: theme.colors.danger,
  },
}));
```

- [ ] **Step 2: Replace `client/src/component/library-scan/index.tsx`**

```typescript
import { useCallback, useEffect, useState } from 'react';

import { Button } from '~/control/button';
import { useScanLibrary } from '~/provider/book';

import { useStyle } from './style';

export const LibraryScan = () => {
  const styles = useStyle();

  const [scanLibrary, scanResult, scanning, error] = useScanLibrary();
  const [resultText, setResultText] = useState<{ text: string; isError: boolean } | null>(null);

  useEffect(() => {
    if (scanning) {
      setResultText(null);
      return;
    }
    if (error) {
      setResultText({ text: 'Scan failed', isError: true });
      return;
    }
    if (scanResult !== undefined) {
      const changed = scanResult.imported.length + scanResult.removed.length;
      setResultText({
        text:
          changed === 0
            ? 'Library already up to date'
            : `Scan complete: ${scanResult.imported.length} imported, ${scanResult.removed.length} removed`,
        isError: false,
      });
    }
  }, [scanning, error, scanResult]);

  return (
    <div className={styles.root}>
      <Button loading={scanning} onClick={scanLibrary}>
        {scanning ? 'Scanning…' : 'Library scan'}
      </Button>
      {resultText && (
        <span className={resultText.isError ? styles.resultError : styles.result}>
          {resultText.text}
        </span>
      )}
    </div>
  );
};
```

- [ ] **Step 3: Verify TypeScript compiles**

```bash
npm --prefix client run type
```

Expected: no errors from these two files.

- [ ] **Step 4: Commit**

```bash
git add client/src/component/library-scan/index.tsx client/src/component/library-scan/style.ts
git commit -m "refactor: replace LibraryScan toast with inline result text"
```

---

### Task 8: `UploadPage` + update `LibraryPage`

**Files:**
- Create: `client/src/page/upload/style.ts`
- Create: `client/src/page/upload/index.tsx`
- Modify: `client/src/page/index.ts`
- Modify: `client/src/page/library/index.tsx`

- [ ] **Step 1: Create `client/src/page/upload/style.ts`**

```typescript
import { createUseStyles } from '~/provider/theme';

export const useStyle = createUseStyles({
  queue: {
    display: 'flex',
    flexDirection: 'column',
    gap: '0.25rem',
  },
  scanRow: {
    display: 'flex',
  },
  spacer: {
    flexGrow: 1,
  },
});
```

- [ ] **Step 2: Create `client/src/page/upload/index.tsx`**

```typescript
import { LibraryScan, Page, UploadItem, UploadZone } from '~/component';
import { useIsAdmin } from '~/provider/auth';
import { useUploadQueue } from '~/provider/book';

import { useStyle } from './style';

export const UploadPage = () => {
  const styles = useStyle();
  const { items, addFiles } = useUploadQueue();
  const [isAdmin] = useIsAdmin();

  return (
    <Page>
      <UploadZone addFiles={addFiles} />
      {items.length > 0 && (
        <div className={styles.queue}>
          {items.map((item) => (
            <UploadItem key={item.id} item={item} />
          ))}
        </div>
      )}
      {isAdmin && (
        <div className={styles.scanRow}>
          <div className={styles.spacer} />
          <LibraryScan />
        </div>
      )}
    </Page>
  );
};
```

- [ ] **Step 3: Export `UploadPage` from `client/src/page/index.ts`**

```typescript
export { BookPage } from './book';
export { BookEditPage } from './book-edit';
export { LibraryPage } from './library';
export { LoginPage } from './login';
export { SeriesPage } from './series';
export { UploadPage } from './upload';
export { UserListPage } from './user-list';
```

- [ ] **Step 4: Update `client/src/page/library/index.tsx`**

Remove `UploadZone`, `LibraryScan`, `isAdmin`, and the admin-specific empty state message:

```typescript
import { useMemo } from 'react';

import { Page, BookRow, SeriesRow } from '~/component';
import { useSeriesList, useStandaloneBookList } from '~/provider/book';

import { useStyle } from './style';

export const LibraryPage = () => {
  const style = useStyle();

  const [standaloneBookList] = useStandaloneBookList();
  const [seriesBookList] = useSeriesList();

  const bookList = useMemo(() => {
    return [...seriesBookList, ...standaloneBookList].sort((bookOrSeriesA, bookOrSeriesB) => {
      const titleA = Array.isArray(bookOrSeriesA) ? bookOrSeriesA[0] : bookOrSeriesA.title;
      const titleB = Array.isArray(bookOrSeriesB) ? bookOrSeriesB[0] : bookOrSeriesB.title;
      return titleA.localeCompare(titleB);
    });
  }, [standaloneBookList, seriesBookList]);

  return (
    <Page>
      {bookList.length === 0 ? (
        <div className={style.emptyState}>
          <div className={style.emptyStateTitle}>Your library is empty</div>
          <div className={style.emptyStateSubtitle}>No books have been added yet</div>
        </div>
      ) : (
        <div className={style.root}>
          {bookList.map((book) =>
            Array.isArray(book) ? (
              <SeriesRow key={book[0]} seriesName={book[0]} />
            ) : (
              <BookRow key={book.id} bookId={book.id} />
            )
          )}
        </div>
      )}
    </Page>
  );
};
```

Also clean up `client/src/page/library/style.ts` — remove `buttonContainer` and `spacer` which are no longer used:

```typescript
import { createUseStyles } from '../../provider/theme';
import type { Theme } from '../../provider/theme';

export const useStyle = createUseStyles((theme: Theme) => ({
  root: {
    display: 'flex',
    flexDirection: 'column',
    gap: '0.25rem',
  },
  emptyState: {
    display: 'flex',
    flexDirection: 'column',
    alignItems: 'center',
    justifyContent: 'center',
    padding: '4rem 1rem',
    gap: '0.5rem',
  },
  emptyStateTitle: {
    fontSize: theme.text.size.lg,
    fontWeight: 600,
    color: theme.colors.text.muted,
  },
  emptyStateSubtitle: {
    fontSize: theme.text.size.md,
    color: theme.colors.text.faint,
  },
}));
```

- [ ] **Step 5: Verify TypeScript compiles**

```bash
npm --prefix client run type
```

Expected: no errors.

- [ ] **Step 6: Commit**

```bash
git add client/src/page/upload/ client/src/page/index.ts \
        client/src/page/library/index.tsx client/src/page/library/style.ts
git commit -m "feat: add UploadPage, remove UploadZone/LibraryScan from LibraryPage"
```

---

### Task 9: Routing and navigation

**Files:**
- Modify: `client/src/router/path-internal.ts`
- Modify: `client/src/router/path.ts`
- Modify: `client/src/router/component.tsx`
- Modify: `app/routes/ui.ts`
- Modify: `client/src/component/header/index.tsx`

- [ ] **Step 1: Add `upload()` to `client/src/router/path-internal.ts`**

```typescript
export const book = (bookId: string) => `${library()}/book/${bookId}`;
export const bookEdit = (bookId: string) => `${library()}/book/${bookId}/edit`;
export const home = () => '/';
export const library = () => '/library';
export const login = () => '/login';
export const series = (seriesName: string) => `${library()}/series/${seriesName}`;
export const upload = () => '/upload';
export const userList = () => '/users';

// Server
export const cover = (bookId: string) => `/api/books/${bookId}/cover`;
```

- [ ] **Step 2: Add `upload()` to `client/src/router/path.ts`**

```typescript
import * as pathInternal from './path-internal';

export const book = (bookId: string) => pathInternal.book(encodeURIComponent(bookId));
export const bookEdit = (bookId: string) => pathInternal.bookEdit(encodeURIComponent(bookId));
export const home = () => pathInternal.home();
export const library = () => pathInternal.library();
export const login = () => pathInternal.login();
export const series = (seriesName: string) => pathInternal.series(encodeURIComponent(seriesName));
export const upload = () => pathInternal.upload();
export const userList = () => pathInternal.userList();

// Server
export const cover = (bookId: string) => pathInternal.cover(encodeURIComponent(bookId));
```

- [ ] **Step 3: Add the `/upload` route to `client/src/router/component.tsx`**

```typescript
import { BrowserRouter, Navigate, Route, Routes } from 'react-router-dom';

import { BookPage } from '../page/book';
import { BookEditPage } from '../page/book-edit';
import { LibraryPage } from '../page/library';
import { LoginPage } from '../page/login';
import { SeriesPage } from '../page/series';
import { UploadPage } from '../page/upload';
import { UserListPage } from '../page/user-list';

import * as path from './path-internal';
import * as pathKey from './path-key-internal';
import { ProtectedRoute } from './protected-route';
import { UnprotectedRoute } from './unprotected-route';

export const AppRouter = () => {
  return (
    <BrowserRouter>
      <Routes>
        <Route element={<UnprotectedRoute />}>
          <Route path={path.login()} element={<LoginPage />} />
        </Route>

        <Route element={<ProtectedRoute />}>
          <Route path={path.library()} element={<LibraryPage />} />
          <Route path={path.upload()} element={<UploadPage />} />
          <Route path={path.series(pathKey.seriesName)} element={<SeriesPage />} />
          <Route path={path.book(pathKey.bookId)} element={<BookPage />} />
          <Route path={path.bookEdit(pathKey.bookId)} element={<BookEditPage />} />
          <Route path={path.userList()} element={<UserListPage />} />
          <Route path="*" element={<Navigate to={path.library()} replace />} />
        </Route>
      </Routes>
    </BrowserRouter>
  );
};
```

- [ ] **Step 4: Add `GET /upload` SPA route in `app/routes/ui.ts`**

Add after the existing `router.get('/series/:name', sessionAuth, serveSpa);` line (around line 138):

```typescript
router.get('/upload', sessionAuth, serveSpa);
```

This ensures a direct browser navigation to `/upload` is served the SPA rather than a 404.

Also add a test to `app/routes/ui.test.ts` inside the existing `describe('SPA routes serve index.html')` block:

```typescript
it('GET /upload returns 200 with HTML', async () => {
  const agent = await adminAgent();
  const res = await agent.get('/upload');
  expect(res.status).toBe(200);
  expect(res.text).toContain('<!DOCTYPE html>');
});

it('GET /upload redirects to /login without session', async () => {
  const res = await request(app).get('/upload');
  expect(res.status).toBe(302);
  expect(res.headers.location).toBe('/login');
});
```

- [ ] **Step 5: Update `client/src/component/header/index.tsx`**

Move the Upload link outside the `isAdmin` nav gate so all logged-in users see it. Library and Users remain admin-only:

```typescript
import cx from 'classnames';
import { Link, useLocation } from 'react-router-dom';

import { Button } from '~/control';
import { BookIcon, BooksIcon, UploadIcon, UsersIcon } from '~/icon';
import { useIsAdmin, useLogout, useUsername } from '~/provider/auth';
import { path } from '~/router';

import { useStyle } from './style';

export const Header = () => {
  const [username] = useUsername();
  const [isAdmin] = useIsAdmin();
  const [logout, loading] = useLogout();
  const styles = useStyle();
  const { pathname } = useLocation();

  return (
    <header className={styles.root}>
      <h1 className={styles.title}>
        <BooksIcon /> HASS-ODPS Library
      </h1>
      <nav className={styles.navigation}>
        {isAdmin && (
          <Link
            className={cx(styles.navigationItem, {
              [styles.active]: pathname.startsWith(path.library()),
            })}
            to={path.library()}
          >
            <BookIcon height={14} width={14} /> Library
          </Link>
        )}
        <Link
          className={cx(styles.navigationItem, {
            [styles.active]: pathname === path.upload(),
          })}
          to={path.upload()}
        >
          <UploadIcon height={14} width={14} /> Upload
        </Link>
        {isAdmin && (
          <Link
            className={cx(styles.navigationItem, {
              [styles.active]: pathname === path.userList(),
            })}
            to={path.userList()}
          >
            <UsersIcon height={14} width={14} /> Users
          </Link>
        )}
      </nav>
      <div className={styles.actions}>
        {username && <span className={styles.username}>{username}</span>}
        {username && (
          <Button onClick={logout} loading={loading}>
            Sign out
          </Button>
        )}
      </div>
    </header>
  );
};
```

- [ ] **Step 6: Verify TypeScript compiles**

```bash
npm --prefix client run type
```

Expected: no errors.

- [ ] **Step 7: Run all tests**

```bash
npm test && npm --prefix client test
```

Expected: all tests pass.

- [ ] **Step 8: Run lint**

```bash
npm run lint
```

Expected: no errors.

- [ ] **Step 9: Commit**

```bash
git add client/src/router/path-internal.ts client/src/router/path.ts \
        client/src/router/component.tsx app/routes/ui.ts \
        client/src/component/header/index.tsx
git commit -m "feat: add /upload route and Upload header nav link"
```
