# Set Progress — Design Spec

**Date:** 2026-05-17
**Branch:** feat/react-migration

## Overview

Add a "Set Progress" button to the Book page for regular (non-admin) users. Clicking it opens a modal with a chapter slider so users can manually record their reading position. Admins are excluded because their progress is managed through KoReader sync.

## Scope

- Non-admin users only; books with `chapterCount === 0` show no button
- Slider range: 0 (not started / clear progress) → N (finished)
- Chapter 0 deletes the progress record; chapters 1–N save it
- Percentage is computed on the frontend as `currentChapter / chapterCount`

## Architecture

### Backend

**New route:** `PUT /api/my/progress/:document`

- Auth: session middleware (same as existing `/api/my/*` routes)
- Request body: `{ currentChapter: number, percentage: number }`
- Calls `userStore.saveProgress(username, document, { document, currentChapter, percentage })`
- Returns 200 on success; 400 if body is invalid; 401 if unauthenticated
- Chapter 0 is never sent to this endpoint — the frontend uses the existing delete hook instead

### Frontend — Hook

**`useSetMyProgress(bookId: string)`** at `client/src/provider/progress/hook/use-set-my-progress.ts`

- Mirrors the pattern of `useDeleteMyProgress`
- Issues `PUT /api/my/progress/:bookId` with `{ currentChapter, percentage }`
- On success: updates the progress context entry for `bookId` so the circular indicator and chapter display refresh without a full page reload
- Returns `[setProgress, loading, error]`

### Frontend — Component

**`SetProgressModal`** at `client/src/control/set-progress-modal/index.tsx`

Props:
```ts
{
  isOpen: boolean
  bookId: string
  chapterCount: number
  initialChapter: number   // progress.currentChapter ?? 0
  onClose: () => void
}
```

Behaviour:
- Uses native `<dialog>` element, same as `ConfirmModal`
- Local `selectedChapter` state initialised from `initialChapter` when `isOpen` changes to true
- Range input: `min=0`, `max={chapterCount}`, `step=1`
- Chapter display above slider: `"Chapter N"` (normal colour) or `"Not started"` (muted) at 0
- Subtitle below display: `"of N chapters"`
- On confirm:
  - `selectedChapter === 0` → calls existing `useDeleteMyProgress` hook
  - `selectedChapter > 0` → calls `useSetMyProgress` with computed percentage
- Loading state disables both buttons during the API call
- Modal closes automatically on success
- Confirm button: label **"Save Progress"** and primary colour normally; label **"Clear Progress"** and danger/red at `selectedChapter === 0`
- Exported from `client/src/control/index.ts` alongside other controls

### Frontend — Book Page

`client/src/page/book/index.tsx`:

- Add `useState<boolean>(false)` for modal open state
- Render `SetProgressModal` with `isOpen`, `bookId={book.id}`, `chapterCount={book.chapterCount}`, `initialChapter={progress?.currentChapter ?? 0}`, `onClose`
- Add a non-admin button container beneath the existing admin one:

```tsx
{!isAdmin && book.chapterCount > 0 && (
  <div className={styles.buttonContainer}>
    <div className={styles.spacer} />
    <Button onClick={() => setProgressOpen(true)}>Set Progress</Button>
  </div>
)}
```

## Error Handling

- API errors surface via the `error` return value of the hook; the modal stays open and shows an inline error message so the user can retry
- If `chapterCount` is 0, the button is not rendered — no need to guard inside the modal

## Testing

- Manual: open Book page as a non-admin user, click "Set Progress", drag to a chapter, confirm — verify the circular indicator and chapter display update immediately
- Manual: drag to 0, confirm — verify progress record is deleted and indicator resets
- Manual: open as admin — verify button is absent
- Manual: open a book with no chapters — verify button is absent
