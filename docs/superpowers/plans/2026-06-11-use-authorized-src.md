# `useAuthorizedSrc` Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Extract the authenticated blob-URL fetch pattern into a reusable `useAuthorizedSrc` hook and apply it to the three callsites that currently load cover images via unauthenticated `<img src>` tags.

**Architecture:** A new `lib/use-authorized-src.ts` hook takes a URL (or null) and returns a blob URL string (or undefined) by fetching through `apiFetch` which injects the Bearer token. The Cover component is refactored to use it; book-row and page/book are updated from raw `<img src>` to the hook.

**Tech Stack:** React, Vitest, `@testing-library/react` (`renderHook`, `waitFor`), `apiFetch` from `~/lib/api-fetch`.

---

## Task 1: Create `useAuthorizedSrc` hook (TDD)

**Files:**
- Create: `app/client/src/lib/use-authorized-src.ts`
- Create: `app/client/src/lib/use-authorized-src.test.ts`

- [ ] **Step 1: Write the failing tests**

Create `app/client/src/lib/use-authorized-src.test.ts`:

```ts
import { renderHook, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('./api-fetch');

import { apiFetch } from './api-fetch';
import { useAuthorizedSrc } from './use-authorized-src';

const mockApiFetch = vi.mocked(apiFetch);

const makeOkResponse = (blob: Blob) => ({
  ok: true,
  blob: () => Promise.resolve(blob),
});

const createObjectURL = vi.fn(() => 'blob:test-url');
const revokeObjectURL = vi.fn();

beforeEach(() => {
  URL.createObjectURL = createObjectURL;
  URL.revokeObjectURL = revokeObjectURL;
});

afterEach(() => {
  mockApiFetch.mockReset();
  createObjectURL.mockReset().mockReturnValue('blob:test-url');
  revokeObjectURL.mockReset();
});

describe('useAuthorizedSrc', () => {
  it('returns undefined and makes no fetch when url is null', () => {
    const { result } = renderHook(() => useAuthorizedSrc(null));
    expect(result.current).toBeUndefined();
    expect(mockApiFetch).not.toHaveBeenCalled();
  });

  it('fetches the url via apiFetch and returns a blob URL', async () => {
    const blob = new Blob(['img'], { type: 'image/jpeg' });
    mockApiFetch.mockResolvedValueOnce(makeOkResponse(blob) as Response);

    const { result } = renderHook(() => useAuthorizedSrc('/api/books/book1/cover'));

    await waitFor(() => expect(result.current).toBe('blob:test-url'));
    expect(mockApiFetch).toHaveBeenCalledWith('/api/books/book1/cover');
    expect(createObjectURL).toHaveBeenCalledWith(blob);
  });

  it('returns undefined for a non-ok response', async () => {
    mockApiFetch.mockResolvedValueOnce({ ok: false } as Response);

    const { result } = renderHook(() => useAuthorizedSrc('/api/books/book1/cover'));

    await waitFor(() => expect(mockApiFetch).toHaveBeenCalled());
    expect(result.current).toBeUndefined();
    expect(createObjectURL).not.toHaveBeenCalled();
  });

  it('revokes the old blob URL and fetches a new one when url changes', async () => {
    const blob1 = new Blob(['img1'], { type: 'image/jpeg' });
    const blob2 = new Blob(['img2'], { type: 'image/jpeg' });
    createObjectURL.mockReturnValueOnce('blob:url-1').mockReturnValueOnce('blob:url-2');
    mockApiFetch
      .mockResolvedValueOnce(makeOkResponse(blob1) as Response)
      .mockResolvedValueOnce(makeOkResponse(blob2) as Response);

    const { result, rerender } = renderHook(
      ({ url }: { url: string | null }) => useAuthorizedSrc(url),
      { initialProps: { url: '/api/books/book1/cover' } }
    );

    await waitFor(() => expect(result.current).toBe('blob:url-1'));

    rerender({ url: '/api/books/book2/cover' });
    expect(revokeObjectURL).toHaveBeenCalledWith('blob:url-1');

    await waitFor(() => expect(result.current).toBe('blob:url-2'));
  });

  it('revokes the blob URL on unmount', async () => {
    const blob = new Blob(['img'], { type: 'image/jpeg' });
    createObjectURL.mockReturnValueOnce('blob:to-revoke');
    mockApiFetch.mockResolvedValueOnce(makeOkResponse(blob) as Response);

    const { result, unmount } = renderHook(() =>
      useAuthorizedSrc('/api/books/book3/cover')
    );

    await waitFor(() => expect(result.current).toBe('blob:to-revoke'));
    unmount();
    expect(revokeObjectURL).toHaveBeenCalledWith('blob:to-revoke');
  });
});
```

- [ ] **Step 2: Run tests to confirm they fail**

```bash
cd app/client && npx vitest run src/lib/use-authorized-src.test.ts
```

Expected: FAIL — `use-authorized-src` module not found.

- [ ] **Step 3: Implement the hook**

Create `app/client/src/lib/use-authorized-src.ts`:

```ts
import { useEffect, useState } from 'react';

import { apiFetch } from './api-fetch';

export function useAuthorizedSrc(url: string | null): string | undefined {
  const [src, setSrc] = useState<string | undefined>(undefined);

  useEffect(() => {
    if (!url) return;

    let objectUrl: string | undefined;
    let cancelled = false;

    apiFetch(url)
      .then((res) => (res.ok ? res.blob() : null))
      .then((blob) => {
        if (cancelled) {
          if (objectUrl) URL.revokeObjectURL(objectUrl);
          return;
        }
        if (!blob) return;
        objectUrl = URL.createObjectURL(blob);
        setSrc(objectUrl);
      })
      .catch(() => {});

    return () => {
      cancelled = true;
      if (objectUrl) URL.revokeObjectURL(objectUrl);
      setSrc(undefined);
    };
  }, [url]);

  return src;
}
```

- [ ] **Step 4: Run tests to confirm they pass**

```bash
cd app/client && npx vitest run src/lib/use-authorized-src.test.ts
```

Expected: 5 tests pass.

- [ ] **Step 5: Run lint**

```bash
cd app/client && npx eslint src/lib/use-authorized-src.ts src/lib/use-authorized-src.test.ts
```

Expected: no errors.

- [ ] **Step 6: Commit**

```bash
git add app/client/src/lib/use-authorized-src.ts app/client/src/lib/use-authorized-src.test.ts
git commit -m "feat: add useAuthorizedSrc hook for authenticated image loading"
```

---

### Task 2: Refactor `Cover` component to use the hook

**Files:**
- Modify: `app/client/src/component/cover/index.tsx`
- Verify: `app/client/src/component/cover/index.test.tsx` (no changes expected)

- [ ] **Step 1: Replace inline effect with hook**

Replace the entire contents of `app/client/src/component/cover/index.tsx`:

```tsx
import { useAuthorizedSrc } from '~/lib/use-authorized-src';

import { useStyle } from './style';

interface CoverProps {
  bookId: string | null;
  title?: string;
  sequence: 1 | 2 | 3;
  width: number;
  height: number;
  thumbnailWidth?: number;
}

export function Cover({ bookId, title, sequence, width, height, thumbnailWidth }: CoverProps) {
  const style = useStyle({ sequence, height, width, isGhost: !bookId });
  const url = bookId
    ? thumbnailWidth
      ? `/api/books/${encodeURIComponent(bookId)}/cover?width=${thumbnailWidth}`
      : `/api/books/${encodeURIComponent(bookId)}/cover`
    : null;
  const src = useAuthorizedSrc(url);

  return bookId ? (
    <img src={src} alt={title ?? ''} className={`${style.layer} ${style.coverImg}`} />
  ) : (
    <div className={`${style.layer} ${style.ghost}`} />
  );
}
```

- [ ] **Step 2: Run the existing Cover tests — no changes needed**

The tests mock `~/lib/api-fetch` at module scope. `useAuthorizedSrc` imports from that same module, so the mock intercepts correctly and all four tests pass without modification.

```bash
cd app/client && npx vitest run src/component/cover/
```

Expected: 4 tests pass.

- [ ] **Step 3: Run lint**

```bash
cd app/client && npx eslint src/component/cover/index.tsx
```

Expected: no errors.

- [ ] **Step 4: Commit**

```bash
git add app/client/src/component/cover/index.tsx
git commit -m "refactor: use useAuthorizedSrc in Cover component"
```

---

### Task 3: Fix `book-row/index.tsx`

**Files:**
- Modify: `app/client/src/component/book-row/index.tsx`

- [ ] **Step 1: Update the component**

Replace the entire contents of `app/client/src/component/book-row/index.tsx`:

```tsx
import cx from 'classnames';
import { useCallback } from 'react';
import { useNavigate } from 'react-router-dom';

import { useAuthorizedSrc } from '~/lib/use-authorized-src';
import { useBook } from '~/provider/book';
import { useMyProgress } from '~/provider/progress';
import { path } from '~/router';

import { Card } from '../card';

import { useStyle } from './style';

interface BookRowProps {
  asCard?: boolean;
  bookId: string;
  showAuthor?: boolean;
}

export function BookRow({ asCard = true, bookId, showAuthor = true }: BookRowProps) {
  const styles = useStyle();
  const navigate = useNavigate();

  const [book, loading, error] = useBook(bookId);
  const [progress] = useMyProgress(bookId);

  const handleNavigate = useCallback(() => {
    if (!book) {
      return;
    }
    navigate(path.book(book.id));
  }, [book, navigate]);

  const coverSrc = useAuthorizedSrc(
    book?.hasCover ? `/api/books/${encodeURIComponent(book.id)}/cover?width=60` : null
  );

  if (loading) {
    const loadingContent = <div className={styles.root}>Loading...</div>;
    return asCard ? <Card size="small">{loadingContent}</Card> : loadingContent;
  }

  if (error) {
    const errorContent = <div className={styles.root}>Error loading book</div>;
    return asCard ? <Card size="small">{errorContent}</Card> : errorContent;
  }

  const meta: string[] = [];
  if (showAuthor && book.author) {
    meta.push(book.author);
  }
  if (book.seriesIndex > 0) {
    meta.push(`Book ${book.seriesIndex}`);
  }
  if (progress) {
    if (progress.percentage < 1) {
      meta.push(`${(progress.percentage * 100).toFixed(0)}%`);
    } else {
      meta.push(`Completed`);
    }
  }

  const content = (
    <div
      className={cx(styles.root, { [styles.navigate]: !asCard })}
      onClick={!asCard ? handleNavigate : undefined}
    >
      <div className={styles.cover}>
        {book.hasCover ? (
          <img src={coverSrc} alt={book.title} className={styles.coverImg} />
        ) : (
          <div className={styles.coverPlaceholder} />
        )}
      </div>
      <div className={styles.info}>
        <div className={styles.title}>{book.title}</div>
        <div className={styles.meta}>{meta.join(' · ')}</div>
      </div>
    </div>
  );

  return asCard ? (
    <Card size="small" onClick={handleNavigate}>
      {content}
    </Card>
  ) : (
    content
  );
}
```

- [ ] **Step 2: Run lint**

```bash
cd app/client && npx eslint src/component/book-row/index.tsx
```

Expected: no errors.

- [ ] **Step 3: Commit**

```bash
git add app/client/src/component/book-row/index.tsx
git commit -m "fix: use useAuthorizedSrc in BookRow to fix 401 on cover images"
```

---

### Task 4: Fix `page/book/index.tsx`

**Files:**
- Modify: `app/client/src/page/book/index.tsx`

- [ ] **Step 1: Add the import**

In `app/client/src/page/book/index.tsx`, insert `useAuthorizedSrc` into the internal imports group (alphabetically between `~/control` and `~/provider/auth`):

```tsx
// Before (lines 13-18):
import { Button, DeleteBookButton, RegenChaptersButton, SetProgressModal } from '~/control';
import { useIsAdmin } from '~/provider/auth';

// After:
import { Button, DeleteBookButton, RegenChaptersButton, SetProgressModal } from '~/control';
import { useAuthorizedSrc } from '~/lib/use-authorized-src';
import { useIsAdmin } from '~/provider/auth';
```

- [ ] **Step 2: Add the hook call**

After the `useMemo` block (around line 78, just before `if (loading)`), add:

```tsx
  const coverSrc = useAuthorizedSrc(
    book?.hasCover ? `/api/books/${encodeURIComponent(book.id)}/cover?width=170` : null
  );
```

- [ ] **Step 3: Replace the raw img src**

Change (around line 106-112):

```tsx
// Before:
              <img
                className={styles.coverImg}
                src={`/api/books/${encodeURIComponent(book.id)}/cover?width=170`}
                alt={book.title}
                width={80}
                height={118}
              />
// After:
              <img
                className={styles.coverImg}
                src={coverSrc}
                alt={book.title}
                width={80}
                height={118}
              />
```

- [ ] **Step 4: Run lint**

```bash
cd app/client && npx eslint src/page/book/index.tsx
```

Expected: no errors.

- [ ] **Step 5: Commit**

```bash
git add app/client/src/page/book/index.tsx
git commit -m "fix: use useAuthorizedSrc in BookPage to fix 401 on cover images"
```

---

### Task 5: Final verification

**Files:** none

- [ ] **Step 1: Run full test suite**

```bash
cd app/client && npx vitest run
```

Expected: all test files pass (currently 61 files, 397 tests + the 5 new hook tests = 62 files, 402 tests).

- [ ] **Step 2: Run full lint**

```bash
cd app/client && npm run lint
```

Expected: no errors.
