---
title: Delete Synced Progress
date: 2026-06-03
status: approved
---

# Delete Synced Progress

## Overview

Allow users to delete their own synced reading progress from the user page, and allow admins to delete any user's synced reading progress from the user-list page. Each progress entry is a per-book record; deletions are per-book, not bulk.

## Motivation

Users and admins may need to clear stale or incorrect reading progress synced from KOReader. Progress deletion is destructive — KOReader does not automatically re-push progress unless the user opens the book again — so the action requires confirmation.

## Affected Components

Two row-level components each gain a delete flow:

- **`MyProgressRow`** (`app/client/src/component/my-progress-row/index.tsx`) — shown on the user page for the logged-in non-admin user
- **`UserProgressRow`** (`app/client/src/component/user-progress-row/index.tsx`) — shown inside expanded user cards on the admin user-list page

No other components change.

## Existing Hooks

Both delete hooks already exist and are ready to use:

- `useDeleteMyProgress()` → `[deleteMyProgress(bookId), deleting, error, errorMessage]`
- `useDeleteUserProgress(username)` → `[deleteUserProgress(bookId), deleting, error, errorMessage]`

Neither hook has an `okay` state. Success is inferred as: `submitCount > 0 && !deleting && !error`.

## UI Flow (per row)

1. User clicks **"Clear"** — a `type="link" danger` Button at the end of the row
2. A `ConfirmModal` opens with `AlertOctagonIcon`, `danger` styling, title "Clear reading progress?", confirmText "Clear"
3. User confirms → modal closes → `deleteMyProgress(bookId)` / `deleteUserProgress(bookId)` is called
4. On completion a `Toast` appears:
   - Success: `"Progress cleared"` (type `success`)
   - Error: `errorMessage ?? "Failed to clear progress"` (type `error`)

User cancels at step 2 → modal closes, nothing happens.

## Row Layout

Both rows are `display: flex; align-items: center; gap: md`. The Clear button is the last flex child, after the metadata string. No new style rules are needed — `type="link"` buttons have their own sizing.

The root element of each row component becomes a `Fragment` to accommodate the `ConfirmModal` rendered as a sibling.

## Toast Pattern

Matches `UserRegister` exactly:

```ts
const [toast, setToast] = useState<{ text: string; type: 'success' | 'error' } | null>(null);
const [submitCount, setSubmitCount] = useState(0);

useEffect(() => {
  if (submitCount === 0) return;
  if (deleting) { setToast(null); return; }
  if (error) {
    setToast({ text: errorMessage ?? 'Failed to clear progress', type: 'error' });
    return;
  }
  setToast({ text: 'Progress cleared', type: 'success' });
}, [submitCount, deleting, error, errorMessage]);
```

`<Toast key={submitCount} ... />` is rendered inside the `Fragment` alongside the modal.

## Modal Copy

**MyProgressRow:**
- Title: "Clear reading progress?"
- Body: "This will remove your synced reading progress for **[book title]**."
- Confirm: "Clear"

**UserProgressRow:**
- Title: "Clear reading progress?"
- Body: "This will remove synced reading progress for **[book title]**."
- Confirm: "Clear"

Book title falls back to `progress.document` when the book record isn't loaded (same pattern as the existing row rendering).

## Out of Scope

- Bulk progress deletion (all books for a user at once)
- Progress deletion from the book detail page
- Backend changes (DELETE endpoints for both routes already exist)
