# Proportional Chapter Slider Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace the equally-spaced range input in `SetProgressModal` with a custom slider that positions chapter tick marks at their true proportional positions in the book, snaps to chapters on release, and shows the chapter name in the modal header when a named chapter is selected.

**Architecture:** A new `ProportionalChapterSlider` control uses pointer events with `setPointerCapture` for unified mouse/touch handling. During drag `dragPct` state drives the visual position; on `pointerUp` the nearest chapter is computed and `onChange` fires. The slider communicates drag state to `SetProgressModal` via an `onDragChange` callback so the modal can hide the chapter name while mid-drag.

**Tech Stack:** React, react-jss (JSS), TypeScript, Vitest (backend), Supertest

---

## File Map

| Action | Path | Purpose |
|---|---|---|
| Modify | `app/routes/ui.ts:238-244` | Stop stripping `chapterSpineMap`/`chapterNames` from GET /api/books/:id |
| Modify | `app/routes/ui.test.ts:432-443` | Update test that asserts `chapterSpineMap` is absent — assert it is present |
| Modify | `client/src/provider/book/type.ts` | Add `chapterSpineMap?` and `chapterNames?` to client `Book` type |
| Create | `client/src/control/proportional-chapter-slider/style.ts` | JSS styles for the slider |
| Create | `client/src/control/proportional-chapter-slider/index.tsx` | The slider component |
| Modify | `client/src/control/index.ts` | Export `ProportionalChapterSlider` |
| Modify | `client/src/control/set-progress-modal/style.ts` | Add `chapterName` style, remove `sliderLabels` |
| Modify | `client/src/control/set-progress-modal/index.tsx` | Wire new props, replace slider, add name display |
| Modify | `client/src/page/book/index.tsx` | Pass `chapterSpineMap`/`chapterNames` to `SetProgressModal` |

---

### Task 1: Backend — expose chapterSpineMap and chapterNames

**Files:**
- Modify: `app/routes/ui.ts:238-244`
- Modify: `app/routes/ui.test.ts:432-443`

The existing test at line 432 explicitly asserts `chapterSpineMap` is absent. Update it to assert it is present, run it to confirm it fails, then fix the route.

- [ ] **Step 1: Update the failing test**

In `app/routes/ui.test.ts`, replace the test at lines 432–443:

```ts
it('includes chapterCount, chapterSpineMap, and chapterNames', async () => {
  bookStore.addBook('bk1', 'book1.epub', path.join(booksDir, 'book1.epub'), 100, new Date(), {
    ...FAKE_META,
    chapterCount: 5,
    chapterSpineMap: [1, 2, 3, 4, 5],
    chapterNames: ['Prologue', 'Ch 1', 'Ch 2', 'Ch 3', 'Ch 4'],
  });
  const agent = await adminAgent();
  const res = await agent.get('/api/books/bk1');
  expect(res.status).toBe(200);
  expect(res.body.chapterCount).toBe(5);
  expect(res.body.chapterSpineMap).toEqual([1, 2, 3, 4, 5]);
  expect(res.body.chapterNames).toEqual(['Prologue', 'Ch 1', 'Ch 2', 'Ch 3', 'Ch 4']);
  // path must still NOT be exposed
  expect(res.body.path).toBeUndefined();
});
```

- [ ] **Step 2: Run the test to confirm it fails**

```bash
npx jest --testPathPattern="app/routes/ui.test.ts" --testNamePattern="chapterSpineMap" 2>&1 | tail -20
```

Expected: FAIL — `expect(received).toEqual(expected)` on `chapterSpineMap`.

- [ ] **Step 3: Fix the route**

In `app/routes/ui.ts`, replace lines 238–244:

```ts
// before
const {
  path: _path,
  chapterSpineMap: _chapterSpineMap,
  chapterNames: _chapterNames,
  ...rest
} = book;
res.json(rest);
```

```ts
// after
const { path: _path, ...rest } = book;
res.json(rest);
```

- [ ] **Step 4: Run tests to confirm they pass**

```bash
npx jest --testPathPattern="app/routes/ui.test.ts" 2>&1 | tail -10
```

Expected: all tests in the file pass.

- [ ] **Step 5: Commit**

```bash
git add app/routes/ui.ts app/routes/ui.test.ts
git commit -m "feat: expose chapterSpineMap and chapterNames in GET /api/books/:id"
```

---

### Task 2: Client Book type

**Files:**
- Modify: `client/src/provider/book/type.ts`

- [ ] **Step 1: Add optional fields**

In `client/src/provider/book/type.ts`, add two lines after `chapterCount`:

```ts
export type Book = {
  id: string;
  title: string;
  author: string;
  fileAs: string;
  publisher?: string;
  series: string;
  seriesIndex: number;
  description?: string;
  subjects: string[];
  identifiers: Identifier[];
  hasCover: boolean;
  size: number;
  addedAt?: string;
  chapterCount: number;
  chapterSpineMap?: number[];
  chapterNames?: string[];
};
```

- [ ] **Step 2: Verify TypeScript compiles**

```bash
npx tsc --noEmit -p client/tsconfig.json 2>&1 | head -20
```

Expected: no errors.

- [ ] **Step 3: Commit**

```bash
git add client/src/provider/book/type.ts
git commit -m "feat: add optional chapterSpineMap and chapterNames to client Book type"
```

---

### Task 3: ProportionalChapterSlider — styles

**Files:**
- Create: `client/src/control/proportional-chapter-slider/style.ts`

- [ ] **Step 1: Create the style file**

```ts
import { createUseStyles, type Theme } from '~/provider/theme';

export const useStyle = createUseStyles((theme: Theme) => ({
  root: {
    position: 'relative',
    height: '40px',
    cursor: 'pointer',
    userSelect: 'none',
    touchAction: 'none',
  },
  track: {
    position: 'absolute',
    top: '50%',
    left: 0,
    right: 0,
    height: '4px',
    background: theme.colors.borderLight,
    borderRadius: '2px',
    transform: 'translateY(-50%)',
  },
  fill: {
    position: 'absolute',
    top: '50%',
    left: 0,
    height: '4px',
    background: theme.colors.primary,
    borderRadius: '2px',
    transform: 'translateY(-50%)',
    pointerEvents: 'none',
  },
  tick: {
    position: 'absolute',
    top: '50%',
    width: '2px',
    height: '14px',
    background: theme.colors.borderLight,
    transform: 'translate(-50%, -50%)',
    borderRadius: '1px',
    pointerEvents: 'none',
  },
  tickActive: {
    background: theme.colors.primary,
  },
  thumb: {
    position: 'absolute',
    top: '50%',
    width: '18px',
    height: '18px',
    background: theme.colors.primary,
    borderRadius: '50%',
    transform: 'translate(-50%, -50%)',
    pointerEvents: 'none',
    boxShadow: '0 1px 4px rgba(0,0,0,.2)',
  },
  thumbDisabled: {
    background: theme.colors.text.faint,
    cursor: 'not-allowed',
  },
  labels: {
    display: 'flex',
    justifyContent: 'space-between',
    fontSize: '0.7rem',
    color: theme.colors.text.faint,
    marginTop: '0.25rem',
  },
}));
```

---

### Task 4: ProportionalChapterSlider — component + export

**Files:**
- Create: `client/src/control/proportional-chapter-slider/index.tsx`
- Modify: `client/src/control/index.ts`

- [ ] **Step 1: Create the component**

```tsx
import { useState, useCallback, useRef } from 'react';

import { useStyle } from './style';

type ProportionalChapterSliderProps = {
  value: number;
  onChange: (v: number) => void;
  chapterCount: number;
  chapterSpineMap: number[];
  disabled?: boolean;
  onDragChange?: (dragging: boolean) => void;
};

function chapterPct(i: number, spineMap: number[], count: number): number {
  if (i === 0) return 0;
  const max = spineMap.length > 0 ? spineMap[spineMap.length - 1] : 0;
  if (!max) return (i / count) * 100;
  const pos = spineMap[i - 1];
  if (pos === undefined) return (i / count) * 100;
  return (pos / max) * 100;
}

function nearestChapter(pct: number, spineMap: number[], count: number): number {
  let best = 0;
  let bestDist = pct;
  for (let i = 1; i <= count; i++) {
    const d = Math.abs(pct - chapterPct(i, spineMap, count));
    if (d < bestDist) {
      bestDist = d;
      best = i;
    }
  }
  return best;
}

const SNAP_TRANSITION = 'left 0.15s ease';
const FILL_SNAP_TRANSITION = 'width 0.15s ease';

export function ProportionalChapterSlider({
  value,
  onChange,
  chapterCount,
  chapterSpineMap,
  disabled = false,
  onDragChange,
}: ProportionalChapterSliderProps) {
  const styles = useStyle();
  const trackRef = useRef<HTMLDivElement>(null);
  const isDraggingRef = useRef(false);
  const [dragPct, setDragPct] = useState<number | null>(null);

  const getPct = useCallback((clientX: number): number => {
    const rect = trackRef.current?.getBoundingClientRect();
    if (!rect) return 0;
    return Math.max(0, Math.min(100, ((clientX - rect.left) / rect.width) * 100));
  }, []);

  const handlePointerDown = useCallback(
    (e: React.PointerEvent<HTMLDivElement>) => {
      if (disabled) return;
      e.preventDefault();
      (e.currentTarget as HTMLDivElement).setPointerCapture(e.pointerId);
      isDraggingRef.current = true;
      onDragChange?.(true);
      setDragPct(getPct(e.clientX));
    },
    [disabled, getPct, onDragChange]
  );

  const handlePointerMove = useCallback(
    (e: React.PointerEvent<HTMLDivElement>) => {
      if (!isDraggingRef.current) return;
      setDragPct(getPct(e.clientX));
    },
    [getPct]
  );

  const handlePointerUp = useCallback(
    (e: React.PointerEvent<HTMLDivElement>) => {
      if (!isDraggingRef.current) return;
      isDraggingRef.current = false;
      onDragChange?.(false);
      const snapped = nearestChapter(getPct(e.clientX), chapterSpineMap, chapterCount);
      setDragPct(null);
      onChange(snapped);
    },
    [getPct, chapterSpineMap, chapterCount, onChange, onDragChange]
  );

  // While dragging: raw pct drives visuals, no transition.
  // After release: value prop drives visuals, CSS transition animates the snap.
  const isDragging = dragPct !== null;
  const displayPct = isDragging ? dragPct : chapterPct(value, chapterSpineMap, chapterCount);
  const displayValue = isDragging ? nearestChapter(dragPct, chapterSpineMap, chapterCount) : value;

  const ticks = Array.from({ length: Math.max(0, chapterCount - 1) }, (_, i) => {
    const ch = i + 1;
    return {
      ch,
      pct: chapterPct(ch, chapterSpineMap, chapterCount),
      active: ch <= displayValue,
    };
  });

  return (
    <div>
      <div
        className={styles.root}
        onPointerDown={handlePointerDown}
        onPointerMove={handlePointerMove}
        onPointerUp={handlePointerUp}
      >
        <div className={styles.track} ref={trackRef} />
        <div
          className={styles.fill}
          style={{ width: `${displayPct}%`, transition: isDragging ? undefined : FILL_SNAP_TRANSITION }}
        />
        {ticks.map(({ ch, pct, active }) => (
          <div
            key={ch}
            className={active ? `${styles.tick} ${styles.tickActive}` : styles.tick}
            style={{ left: `${pct}%` }}
          />
        ))}
        <div
          className={disabled ? `${styles.thumb} ${styles.thumbDisabled}` : styles.thumb}
          style={{ left: `${displayPct}%`, transition: isDragging ? undefined : SNAP_TRANSITION }}
        />
      </div>
      <div className={styles.labels}>
        <span>Not started</span>
        <span>Finished</span>
      </div>
    </div>
  );
}
```

- [ ] **Step 2: Export from control barrel**

In `client/src/control/index.ts`, add after the `ProgressIndicator` export:

```ts
export { Button } from './button';
export { ChapterProgress } from './chapter-progress';
export { ConfirmModal } from './confirm-modal';
export { DeleteBookButton } from './delete-book-button';
export { FieldList } from './field-list';
export { LoadingSpinner } from './loading-spinner';
export { NumberInput } from './number-input';
export { ProgressIndicator } from './progress-indicator';
export { ProportionalChapterSlider } from './proportional-chapter-slider';
export { SetProgressModal } from './set-progress-modal';
export { Switch } from './switch';
export { TextArea } from './text-area';
export { TextInput } from './text-input';

export type { ColumnDescriptor, FieldRow } from './field-list';
```

- [ ] **Step 3: Verify TypeScript compiles**

```bash
npx tsc --noEmit -p client/tsconfig.json 2>&1 | head -20
```

Expected: no errors.

- [ ] **Step 4: Commit**

```bash
git add client/src/control/proportional-chapter-slider/
git add client/src/control/index.ts
git commit -m "feat: add ProportionalChapterSlider control"
```

---

### Task 5: SetProgressModal — update props, display, and replace slider

**Files:**
- Modify: `client/src/control/set-progress-modal/style.ts`
- Modify: `client/src/control/set-progress-modal/index.tsx`

- [ ] **Step 1: Update the style file**

Replace the full contents of `client/src/control/set-progress-modal/style.ts`:

```ts
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
    width: '600px',
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
  chapterName: {
    fontSize: '0.85rem',
    fontStyle: 'italic',
    color: theme.colors.text.muted,
    marginTop: '0.125rem',
    minHeight: '1.25em',
  },
  chapterSubtitle: {
    fontSize: '0.8rem',
    color: theme.colors.text.muted,
    marginTop: '0.125rem',
  },
  sliderSection: {
    padding: '0.75rem 1rem 1.5rem',
  },
  error: {
    color: theme.colors.danger,
    fontSize: '0.8rem',
    padding: '0 1rem 0.75rem',
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

Key changes: `sliderLabels` removed (now owned by the slider component); `chapterName` added for the italic name line.

- [ ] **Step 2: Update the component file**

Replace the full contents of `client/src/control/set-progress-modal/index.tsx`:

```tsx
import { useCallback, useEffect, useRef, useState } from 'react';

import { useDeleteMyProgress, useSetMyProgress } from '~/provider/progress';

import { Button } from '../button';
import { ProportionalChapterSlider } from '../proportional-chapter-slider';

import { useStyle } from './style';

type SetProgressModalProps = {
  isOpen: boolean;
  bookId: string;
  chapterCount: number;
  initialChapter: number;
  chapterSpineMap?: number[];
  chapterNames?: string[];
  onClose: () => void;
};

export function SetProgressModal({
  isOpen,
  bookId,
  chapterCount,
  initialChapter,
  chapterSpineMap = [],
  chapterNames = [],
  onClose,
}: SetProgressModalProps) {
  const styles = useStyle();
  const modalRef = useRef<HTMLDialogElement>(null);
  const [selectedChapter, setSelectedChapter] = useState(initialChapter);
  const [isSliderDragging, setIsSliderDragging] = useState(false);

  const [setMyProgress, saving, saveError, saveErrorMessage] = useSetMyProgress(bookId);
  const [deleteMyProgress, deleting, deleteError, deleteErrorMessage] = useDeleteMyProgress();

  const isBusy = saving || deleting;
  const hasError = saveError || deleteError;
  const errorText = saveErrorMessage ?? deleteErrorMessage;

  const pendingRef = useRef(false);
  const wasBusyRef = useRef(false);

  useEffect(() => {
    const modal = modalRef.current;
    if (!modal) return;
    if (isOpen) modal.showModal();
    else modal.close();
  }, [isOpen]);

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect
    if (isOpen) setSelectedChapter(initialChapter);
    // Reset to current progress only when the modal opens, not on every render
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isOpen]);

  useEffect(() => {
    if (!pendingRef.current) return;
    if (isBusy) {
      wasBusyRef.current = true;
      return;
    }
    if (wasBusyRef.current) {
      wasBusyRef.current = false;
      pendingRef.current = false;
      if (!hasError) onClose();
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isBusy, hasError]);

  const handleConfirm = useCallback(() => {
    pendingRef.current = true;
    wasBusyRef.current = false;
    if (selectedChapter === 0) {
      deleteMyProgress(bookId);
    } else {
      setMyProgress({
        currentChapter: selectedChapter,
        percentage: selectedChapter / chapterCount,
      });
    }
  }, [selectedChapter, bookId, chapterCount, setMyProgress, deleteMyProgress]);

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
  const activeName =
    !isSliderDragging && selectedChapter > 0
      ? (chapterNames[selectedChapter - 1] ?? '')
      : '';

  return (
    <dialog ref={modalRef} className={styles.root} closedby="none" onClick={handleClickBackground}>
      <div className={styles.dialog} onClick={handleClickDialog}>
        <div className={styles.header}>Set Progress</div>
        <div className={styles.chapterDisplay}>
          <div className={isClearing ? styles.chapterNumberMuted : styles.chapterNumber}>
            {isClearing ? 'Not started' : `Chapter ${selectedChapter}`}
          </div>
          <div className={styles.chapterName}>{activeName}</div>
          <div className={styles.chapterSubtitle}>of {chapterCount} chapters</div>
        </div>
        <div className={styles.sliderSection}>
          <ProportionalChapterSlider
            value={selectedChapter}
            onChange={setSelectedChapter}
            chapterCount={chapterCount}
            chapterSpineMap={chapterSpineMap}
            disabled={isBusy}
            onDragChange={setIsSliderDragging}
          />
        </div>
        {hasError && (
          <div className={styles.error}>
            {errorText ?? 'Something went wrong. Please try again.'}
          </div>
        )}
        <div className={styles.footer}>
          <Button type="text" onClick={handleCancel}>
            Cancel
          </Button>
          <Button type="primary" danger={isClearing} loading={isBusy} onClick={handleConfirm}>
            {isClearing ? 'Clear Progress' : 'Save Progress'}
          </Button>
        </div>
      </div>
    </dialog>
  );
}
```

- [ ] **Step 3: Verify TypeScript compiles**

```bash
npx tsc --noEmit -p client/tsconfig.json 2>&1 | head -20
```

Expected: no errors.

- [ ] **Step 4: Commit**

```bash
git add client/src/control/set-progress-modal/
git commit -m "feat: replace range input with ProportionalChapterSlider in SetProgressModal"
```

---

### Task 6: BookPage — pass chapterSpineMap and chapterNames

**Files:**
- Modify: `client/src/page/book/index.tsx:175-181`

- [ ] **Step 1: Update the SetProgressModal call**

In `client/src/page/book/index.tsx`, update the `SetProgressModal` JSX at lines 175–181:

```tsx
<SetProgressModal
  isOpen={progressModalOpen}
  bookId={book.id}
  chapterCount={book.chapterCount}
  initialChapter={progress?.currentChapter ?? 0}
  chapterSpineMap={book.chapterSpineMap ?? []}
  chapterNames={book.chapterNames ?? []}
  onClose={() => setProgressModalOpen(false)}
/>
```

- [ ] **Step 2: Verify TypeScript compiles**

```bash
npx tsc --noEmit -p client/tsconfig.json 2>&1 | head -20
```

Expected: no errors.

- [ ] **Step 3: Commit**

```bash
git add client/src/page/book/index.tsx
git commit -m "feat: pass chapterSpineMap and chapterNames to SetProgressModal"
```

---

### Task 7: Final verification

- [ ] **Step 1: Run full test suite**

```bash
npm test 2>&1 | tail -20
```

Expected: all tests pass.

- [ ] **Step 2: Run lint**

```bash
npm run lint 2>&1 | tail -20
```

Expected: no errors or warnings.

- [ ] **Step 3: Manual smoke test**

1. Start the dev server and open a book that has chapters as a non-admin user
2. Click "Set progress"
3. Confirm tick marks appear at unequal positions (visible as small vertical lines on the track)
4. Drag the slider — verify smooth glide; chapter name in header disappears while dragging
5. Release — verify snap to nearest chapter; chapter name reappears if the book has named chapters
6. Drag to far left (value 0) — verify "Not started" appears, button turns red "Clear Progress"
7. Repeat steps 3–6 on a narrow browser window to test touch-like pointer behaviour
