# Set Progress — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a "Set Progress" chapter slider button and modal to the Book page for non-admin users.

**Architecture:** A new `PUT /api/my/progress/:document` route saves manually-set progress, synthesising an EPUB CFI from the chapter number when the book's `chapterSpineMap` is available (so `currentChapter` persists through page reloads). A `useSetMyProgress` hook mirrors the existing `useDeleteUserProgress` pattern with optimistic context updates. A `SetProgressModal` component uses the native `<dialog>` element pattern from `ConfirmModal`, presenting a chapter range slider; confirming calls either `useSetMyProgress` (chapter > 0) or the existing `useDeleteMyProgress` (chapter === 0) and closes immediately (optimistic). The Book page shows the button only for non-admin users when `chapterCount > 0`.

**Tech Stack:** TypeScript, React, JSS (`createUseStyles`), Express, better-sqlite3, supertest

---

### Task 1: Backend route — `PUT /api/my/progress/:document`

**Files:**
- Modify: `app/routes/ui.ts` (add route after line 132, before the `// ── Static assets` comment)
- Modify: `app/routes/ui.test.ts` (add `describe` block after the `DELETE /api/my/progress/:document` suite which ends ~line 843)

- [ ] **Step 1: Write the failing tests in `app/routes/ui.test.ts`**

Add after the closing `});` of `describe('DELETE /api/my/progress/:document', ...)`:

```typescript
describe('PUT /api/my/progress/:document', () => {
  it('redirects to /login without session', async () => {
    const res = await request(app)
      .put('/api/my/progress/doc1')
      .send({ currentChapter: 5, percentage: 0.25 });
    expect(res.status).toBe(302);
  });

  it('returns 403 for admin', async () => {
    const agent = await adminAgent();
    const res = await agent
      .put('/api/my/progress/doc1')
      .send({ currentChapter: 5, percentage: 0.25 });
    expect(res.status).toBe(403);
    expect(res.body).toEqual({ error: 'Forbidden' });
  });

  it('returns 400 when currentChapter is missing', async () => {
    const agent = await userAgent();
    const res = await agent.put('/api/my/progress/doc1').send({ percentage: 0.25 });
    expect(res.status).toBe(400);
    expect(res.body).toEqual({ error: 'Invalid body' });
  });

  it('returns 400 when percentage is missing', async () => {
    const agent = await userAgent();
    const res = await agent.put('/api/my/progress/doc1').send({ currentChapter: 5 });
    expect(res.status).toBe(400);
    expect(res.body).toEqual({ error: 'Invalid body' });
  });

  it('returns 400 when currentChapter is less than 1', async () => {
    const agent = await userAgent();
    const res = await agent
      .put('/api/my/progress/doc1')
      .send({ currentChapter: 0, percentage: 0.1 });
    expect(res.status).toBe(400);
    expect(res.body).toEqual({ error: 'Invalid body' });
  });

  it('returns 400 when percentage is greater than 1', async () => {
    const agent = await userAgent();
    const res = await agent
      .put('/api/my/progress/doc1')
      .send({ currentChapter: 5, percentage: 1.5 });
    expect(res.status).toBe(400);
    expect(res.body).toEqual({ error: 'Invalid body' });
  });

  it('returns 400 when percentage is not positive', async () => {
    const agent = await userAgent();
    const res = await agent
      .put('/api/my/progress/doc1')
      .send({ currentChapter: 5, percentage: 0 });
    expect(res.status).toBe(400);
    expect(res.body).toEqual({ error: 'Invalid body' });
  });

  it('saves progress and returns 200 for regular user', async () => {
    const agent = await userAgent();
    const res = await agent
      .put('/api/my/progress/doc1')
      .send({ currentChapter: 5, percentage: 0.25 });
    expect(res.status).toBe(200);
    const saved = userStore.getProgress('alice', 'doc1');
    expect(saved).not.toBeNull();
    expect(saved!.percentage).toBe(0.25);
  });

  it('overwrites an existing progress record', async () => {
    userStore.saveProgress('alice', {
      document: 'doc1',
      progress: '/p[1]',
      percentage: 0.5,
      device: 'Kobo',
      device_id: 'd1',
    });
    const agent = await userAgent();
    const res = await agent
      .put('/api/my/progress/doc1')
      .send({ currentChapter: 10, percentage: 0.5 });
    expect(res.status).toBe(200);
    expect(userStore.getProgress('alice', 'doc1')!.percentage).toBe(0.5);
  });
});
```

- [ ] **Step 2: Run the tests to confirm they all fail**

```bash
cd /Users/korzun/Code/HASS-ODPS && npx jest app/routes/ui.test.ts --testNamePattern="PUT /api/my/progress" 2>&1 | tail -20
```

Expected: all 9 new tests fail with 404 (route does not exist yet).

- [ ] **Step 3: Add the PUT route in `app/routes/ui.ts`**

Insert after line 132 (the closing `});` of the DELETE route), before the `// ── Static assets` comment:

```typescript
  router.put('/api/my/progress/:document', sessionAuth, (req: Request, res: Response) => {
    if (req.session.isAdmin) {
      res.status(403).json({ error: 'Forbidden' });
      return;
    }
    const { currentChapter, percentage } = req.body as Record<string, unknown>;
    if (
      typeof currentChapter !== 'number' ||
      !Number.isInteger(currentChapter) ||
      currentChapter < 1 ||
      typeof percentage !== 'number' ||
      percentage <= 0 ||
      percentage > 1
    ) {
      res.status(400).json({ error: 'Invalid body' });
      return;
    }
    // Synthesise a minimal EPUB CFI so currentChapter persists through GET /api/my/progress
    const book = bookStore.getBookById(req.params.document);
    let progress = '';
    if (book && book.chapterSpineMap.length > 0 && currentChapter <= book.chapterSpineMap.length) {
      const spineIndex = book.chapterSpineMap[currentChapter - 1];
      progress = `EPUB_CFI(/6/${spineIndex * 2 + 2}!/4/2:0)`;
    }
    userStore.saveProgress(req.session.username!, {
      document: req.params.document,
      progress,
      percentage,
    });
    res.status(200).json({});
  });
```

No new imports are needed — `bookStore`, `userStore`, `sessionAuth`, `Request`, and `Response` are all already in scope.

- [ ] **Step 4: Run the tests again to confirm they all pass**

```bash
cd /Users/korzun/Code/HASS-ODPS && npx jest app/routes/ui.test.ts --testNamePattern="PUT /api/my/progress" 2>&1 | tail -20
```

Expected: all 9 tests pass.

- [ ] **Step 5: Run the full test suite to check for regressions**

```bash
cd /Users/korzun/Code/HASS-ODPS && npm test 2>&1 | tail -20
```

Expected: all tests pass.

- [ ] **Step 6: Commit**

```bash
git add app/routes/ui.ts app/routes/ui.test.ts
git commit -m "feat: add PUT /api/my/progress/:document endpoint"
```

---

### Task 2: Frontend hook — `useSetMyProgress`

**Files:**
- Create: `client/src/provider/progress/hook/use-set-my-progress.ts`
- Modify: `client/src/provider/progress/hook/index.ts`
- Modify: `client/src/provider/progress/index.ts`

- [ ] **Step 1: Create `use-set-my-progress.ts`**

```typescript
import { useCallback, useContext, useMemo, useState } from 'react';

import { useUsername } from '../../../provider/auth';
import { Context } from '../context';
import type { Progress } from '../type';

export type SetMyProgress = (args: { currentChapter: number; percentage: number }) => Promise<void>;
export type UseSetMyProgress =
  | [SetMyProgress, false, false, undefined]
  | [SetMyProgress, true, false, undefined]
  | [SetMyProgress, false, true, undefined]
  | [SetMyProgress, false, true, string];

export const useSetMyProgress = (bookId: string): UseSetMyProgress => {
  const { progressList, setProgressForUsername } = useContext(Context);
  const [username] = useUsername();
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState(false);
  const [errorMessage, setErrorMessage] = useState<string | undefined>();

  const setMyProgress = useCallback(
    async ({ currentChapter, percentage }: { currentChapter: number; percentage: number }) => {
      if (saving || username === undefined) return;

      const userProgressList = progressList[username] ?? {};
      const newProgress: Progress = { document: bookId, percentage, currentChapter };

      setProgressForUsername(username, { ...userProgressList, [bookId]: newProgress });

      try {
        setSaving(true);
        setError(false);
        setErrorMessage(undefined);
        const response = await fetch(`/api/my/progress/${encodeURIComponent(bookId)}`, {
          method: 'PUT',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ currentChapter, percentage }),
        });
        if (!response.ok) throw new Error('Failed to save progress');
      } catch (err) {
        setError(true);
        setProgressForUsername(username, userProgressList);
        if (err instanceof Error) setErrorMessage(err.message);
      } finally {
        setSaving(false);
      }
    },
    [progressList, setProgressForUsername, username, bookId, saving]
  );

  return useMemo(
    () => [setMyProgress, saving, error, errorMessage] as UseSetMyProgress,
    [setMyProgress, saving, error, errorMessage]
  );
};
```

- [ ] **Step 2: Add export to `hook/index.ts`**

The full updated file (add `useSetMyProgress` line in alphabetical order):

```typescript
export { useDeleteMyProgress } from './use-delete-my-progress';
export { useDeleteUserProgress } from './use-delete-user-progress';
export { useFetchMyProgressList } from './use-fetch-my-progress-list';
export { useFetchUserProgressList } from './use-fetch-user-progress-list';
export { useMyProgress } from './use-my-progress';
export { useMyProgressList } from './use-my-progress-list';
export { useMySeriesProgress } from './use-my-series-progress';
export { useSetMyProgress } from './use-set-my-progress';
export { useUserProgress } from './use-user-progress';
export { useUserProgressList } from './use-user-progress-list';
export { useUserSeriesProgress } from './use-user-series-progress';
```

- [ ] **Step 3: Add `useSetMyProgress` to `provider/progress/index.ts`**

The full updated file:

```typescript
export {
  useDeleteMyProgress,
  useDeleteUserProgress,
  useFetchMyProgressList,
  useFetchUserProgressList,
  useMyProgress,
  useMyProgressList,
  useMySeriesProgress,
  useSetMyProgress,
  useUserProgress,
  useUserProgressList,
  useUserSeriesProgress,
} from './hook';
export { ProgressProvider } from './provider';
export type { Progress, UserProgressList } from './type';
```

- [ ] **Step 4: Run lint**

```bash
cd /Users/korzun/Code/HASS-ODPS && npm run lint 2>&1 | tail -20
```

Expected: no errors.

- [ ] **Step 5: Commit**

```bash
git add client/src/provider/progress/hook/use-set-my-progress.ts \
        client/src/provider/progress/hook/index.ts \
        client/src/provider/progress/index.ts
git commit -m "feat: add useSetMyProgress hook"
```

---

### Task 3: `SetProgressModal` component

**Files:**
- Create: `client/src/control/set-progress-modal/style.ts`
- Create: `client/src/control/set-progress-modal/index.tsx`
- Modify: `client/src/control/index.ts`

- [ ] **Step 1: Create `style.ts`**

```typescript
import { createUseStyles, type Theme } from '~/provider/theme';
import { applyTransparency } from '~/utils';

export const useStyle = createUseStyles((theme: Theme) => ({
  '@global': {
    'body:has(dialog[open])': {
      overflow: 'hidden',
    },
  },
  root: {
    cursor: 'default',
    borderRadius: '16px',
    border: 'none',
    marginTop: '100px',
    marginLeft: 'auto',
    marginRight: 'auto',
    marginBottom: '50px',
    outline: 'none',
    '&::backdrop': {
      backgroundColor: applyTransparency('#000', 0.7),
      backdropFilter: 'blur(2px) saturate(0%)',
    },
  },
  dialog: {
    display: 'flex',
    flexDirection: 'column',
    width: '360px',
    backgroundColor: '#FAFAFA',
  },
  header: {
    fontWeight: '600',
    fontSize: '1.25rem',
    padding: '1rem',
  },
  chapterDisplay: {
    textAlign: 'center',
    padding: '0.5rem 1rem',
  },
  chapterNumber: {
    fontSize: '1.75rem',
    fontWeight: 700,
    color: theme.colors.text.primary,
  },
  chapterNumberMuted: {
    fontSize: '1.75rem',
    fontWeight: 700,
    color: theme.colors.text.faint,
  },
  chapterSubtitle: {
    fontSize: '0.8rem',
    color: theme.colors.text.muted,
    marginTop: '0.125rem',
  },
  sliderSection: {
    padding: '0.75rem 1rem 1.5rem',
  },
  slider: {
    width: '100%',
    accentColor: theme.colors.primary,
    cursor: 'pointer',
    display: 'block',
  },
  sliderLabels: {
    display: 'flex',
    justifyContent: 'space-between',
    fontSize: '0.7rem',
    color: theme.colors.text.faint,
    marginTop: '0.25rem',
  },
  footer: {
    backgroundColor: '#EEEEEE',
    borderTopStyle: 'solid',
    borderTopColor: '#D0D0D0',
    borderTopWidth: '1px',
    display: 'flex',
    flexDirection: 'row',
    justifyContent: 'end',
    gap: '0.5rem',
    paddingTop: '0.75rem',
    paddingBottom: '0.75rem',
    paddingLeft: '0.75rem',
    paddingRight: '0.75rem',
  },
}));
```

- [ ] **Step 2: Create `index.tsx`**

```typescript
import { useCallback, useEffect, useRef, useState } from 'react';

import { useDeleteMyProgress, useSetMyProgress } from '~/provider/progress';

import { Button } from '../button';

import { useStyle } from './style';

type SetProgressModalProps = {
  isOpen: boolean;
  bookId: string;
  chapterCount: number;
  initialChapter: number;
  onClose: () => void;
};

export function SetProgressModal({
  isOpen,
  bookId,
  chapterCount,
  initialChapter,
  onClose,
}: SetProgressModalProps) {
  const styles = useStyle();
  const modalRef = useRef<HTMLDialogElement>(null);
  const [selectedChapter, setSelectedChapter] = useState(initialChapter);

  const [setMyProgress] = useSetMyProgress(bookId);
  const [deleteMyProgress] = useDeleteMyProgress();

  useEffect(() => {
    const modal = modalRef.current;
    if (!modal) return;
    if (isOpen) modal.showModal();
    else modal.close();
  }, [isOpen]);

  useEffect(() => {
    if (isOpen) setSelectedChapter(initialChapter);
    // Reset to current progress only when the modal opens, not on every render
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isOpen]);

  const handleConfirm = useCallback(() => {
    if (selectedChapter === 0) {
      deleteMyProgress(bookId);
    } else {
      setMyProgress({
        currentChapter: selectedChapter,
        percentage: selectedChapter / chapterCount,
      });
    }
    onClose();
  }, [selectedChapter, bookId, chapterCount, setMyProgress, deleteMyProgress, onClose]);

  const handleCancel = useCallback(() => onClose(), [onClose]);

  const handleClickBackground = useCallback(
    (e: React.MouseEvent<HTMLDialogElement>) => {
      e.stopPropagation();
      handleCancel();
    },
    [handleCancel]
  );

  const handleClickDialog = useCallback((e: React.MouseEvent<HTMLDivElement>) => {
    e.stopPropagation();
  }, []);

  const isClearing = selectedChapter === 0;

  return (
    <dialog ref={modalRef} className={styles.root} closedby="none" onClick={handleClickBackground}>
      <div className={styles.dialog} onClick={handleClickDialog}>
        <div className={styles.header}>Set Progress</div>
        <div className={styles.chapterDisplay}>
          <div className={isClearing ? styles.chapterNumberMuted : styles.chapterNumber}>
            {isClearing ? 'Not started' : `Chapter ${selectedChapter}`}
          </div>
          <div className={styles.chapterSubtitle}>of {chapterCount} chapters</div>
        </div>
        <div className={styles.sliderSection}>
          <input
            type="range"
            min={0}
            max={chapterCount}
            step={1}
            value={selectedChapter}
            onChange={(e) => setSelectedChapter(Number(e.target.value))}
            className={styles.slider}
          />
          <div className={styles.sliderLabels}>
            <span>Not started</span>
            <span>Finished</span>
          </div>
        </div>
        <div className={styles.footer}>
          <Button type="text" onClick={handleCancel}>
            Cancel
          </Button>
          <Button type="primary" danger={isClearing} onClick={handleConfirm}>
            {isClearing ? 'Clear Progress' : 'Save Progress'}
          </Button>
        </div>
      </div>
    </dialog>
  );
}
```

- [ ] **Step 3: Add export to `control/index.ts`**

The full updated file (add `SetProgressModal` after `ConfirmModal`):

```typescript
export { Button } from './button';
export { ConfirmModal } from './confirm-modal';
export { DeleteBookButton } from './delete-book-button';
export { LoadingSpinner } from './loading-spinner';
export { NumberInput } from './number-input';
export { SetProgressModal } from './set-progress-modal';
export { Switch } from './switch';
export { TextArea } from './text-area';
export { TextInput } from './text-input';
export { FieldList } from './field-list';
export type { ColumnDescriptor, FieldRow } from './field-list';
export { ChapterProgress } from './chapter-progress';
export { BookProgress } from './progress-indicator';
```

- [ ] **Step 4: Run lint**

```bash
cd /Users/korzun/Code/HASS-ODPS && npm run lint 2>&1 | tail -20
```

Expected: no errors.

- [ ] **Step 5: Commit**

```bash
git add client/src/control/set-progress-modal/index.tsx \
        client/src/control/set-progress-modal/style.ts \
        client/src/control/index.ts
git commit -m "feat: add SetProgressModal component"
```

---

### Task 4: Book page integration

**Files:**
- Modify: `client/src/page/book/index.tsx`

- [ ] **Step 1: Update React import to include `useState`**

Replace:
```typescript
import { useCallback, useMemo } from 'react';
```
With:
```typescript
import { useCallback, useMemo, useState } from 'react';
```

- [ ] **Step 2: Update control imports to include `SetProgressModal`**

Replace:
```typescript
import { Button, ChapterProgress, DeleteBookButton, BookProgress } from '~/control';
```
With:
```typescript
import { Button, ChapterProgress, DeleteBookButton, BookProgress, SetProgressModal } from '~/control';
```

- [ ] **Step 3: Add modal open state after the existing hooks**

After `const [progress] = useMyProgress(id!);`, add:
```typescript
const [progressModalOpen, setProgressModalOpen] = useState(false);
```

- [ ] **Step 4: Replace the admin button block with admin + non-admin blocks**

Replace:
```tsx
{isAdmin && (
  <div className={styles.buttonContainer}>
    <div className={styles.spacer} />
    <Button onClick={handleEditMetadata}>Edit metadata</Button>
    <DeleteBookButton bookId={book.id} />
  </div>
)}
```
With:
```tsx
{isAdmin && (
  <div className={styles.buttonContainer}>
    <div className={styles.spacer} />
    <Button onClick={handleEditMetadata}>Edit metadata</Button>
    <DeleteBookButton bookId={book.id} />
  </div>
)}
{!isAdmin && book.chapterCount > 0 && (
  <div className={styles.buttonContainer}>
    <div className={styles.spacer} />
    <Button onClick={() => setProgressModalOpen(true)}>Set Progress</Button>
  </div>
)}
<SetProgressModal
  isOpen={progressModalOpen}
  bookId={book.id}
  chapterCount={book.chapterCount}
  initialChapter={progress?.currentChapter ?? 0}
  onClose={() => setProgressModalOpen(false)}
/>
```

- [ ] **Step 5: Run lint**

```bash
cd /Users/korzun/Code/HASS-ODPS && npm run lint 2>&1 | tail -20
```

Expected: no errors.

- [ ] **Step 6: Run full test suite**

```bash
cd /Users/korzun/Code/HASS-ODPS && npm test 2>&1 | tail -20
```

Expected: all tests pass.

- [ ] **Step 7: Commit**

```bash
git add client/src/page/book/index.tsx
git commit -m "feat: add Set Progress button and modal to Book page"
```
