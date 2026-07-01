# Let users link their own orphaned synced progress

## Problem

Orphaned synced progress — a `progress` row whose `document` id matches no book in
the user's library — can currently only be linked by **admins**, from the admin
Users page. There, `UserProgressRow` renders a **Link** button gated on `isAdmin`,
opening `LinkProgressModal` to pick the correct book.

A regular user viewing their own synced progress (`MyProgressContent` →
`MyProgressRow`) sees an orphaned row as a cryptic raw fingerprint id with only a
**Clear** button. They have no way to link it to the right book themselves.

Goal: let users link their own orphaned synced progress, just like admins can.

## What already works — no change needed

The backend and hook layers already fully support a non-admin linking their own
progress. This feature only needs to surface that capability in the UI.

- **Backend** `POST /api/books/:id/link` (`app/server/routes/ui.ts:617`) uses
  `requireAuth` + `resolveOwner`. `resolveOwner` (`ui.ts:130`) resolves a non-admin
  to *their own* library and forbids `?user=`. No admin gate.
- **`useLinkProgress(bookId, username)`** (`provider/progress/hook/use-link-progress.ts`)
  already leaves the URL unscoped for non-admins, and on success removes the row
  from `progressList[username]`.
- **`useMyProgressList` / `useDeleteMyProgress`** read and write that *same*
  `progressList[username]` store (keyed by the current user's username), so a
  successful link optimistically removes the row from the user's own view with no
  extra wiring.
- **`useUserBookList(username, enabled)`** already fetches `/api/books` (own
  library) for non-admins.
- **`LinkProgressModal`** is reusable as-is.

Rejected alternative: building `my`-specific link hooks / modal. It would duplicate
working code, since the progress store is shared by username and the hooks already
branch on `isAdmin`.

## Changes

Frontend only. No backend changes. No changes to auth or routes.

### 1. `app/client/src/component/my-progress-row/index.tsx`

- Read `bookLoading` from `useBook` and compute
  `isUnresolved = book === undefined && !bookLoading` (mirrors `UserProgressRow`).
- Get the current user via `useUsername()` from `~/provider/auth` to pass to the
  modal.
- When `isUnresolved`, render:
  - an **orphan hint**: an `AlertOctagonIcon` (warning/muted color) before the
    title, with the raw document id shown in muted text — signalling "this synced
    progress isn't linked to a book yet";
  - a **Link** button that opens `LinkProgressModal` with `documentId={bookId}` and
    `username={currentUsername}`.
- The **Clear** button remains for all rows.
- Layout stays: `[progress] [⚠ title/id] [metadata] [Link?] [Clear]`.

### 2. Prefer the sort title, truncate long titles/hashes (both rows)

Applied to **both** `my-progress-row` and `user-progress-row` for consistency —
they share layout and title logic.

- **Prefer sort title.** Display `book.titleSort || book.title` instead of
  `book.title`, falling back to `progress.document` when orphaned. This mirrors the
  server's rule (`titleSort !== '' ? titleSort : title`) and front-loads the
  meaningful words (e.g. "Great Gatsby, The" rather than "The Great Gatsby") so
  ellipsis truncation keeps the important part.
  - Resolved: `book.titleSort || book.title`
  - Orphaned: `progress.document`
- **Truncate with ellipsis.** The `.book` cell (currently `flexGrow: 1`) gets
  `minWidth: 0`, `overflow: hidden`, `textOverflow: ellipsis`, `whiteSpace: nowrap`
  so long titles and raw fingerprint hashes truncate cleanly on narrow / mobile
  viewports instead of wrapping or overflowing. `minWidth: 0` is required because
  flex children default to `min-width: auto` and won't shrink below content width.

Style files touched: `my-progress-row/style.ts`, `user-progress-row/style.ts`
(add truncation to `.book`; add orphan-hint styles to `my-progress-row/style.ts`).

## Tests

- `my-progress-row/index.test.tsx`:
  - Link button + orphan hint appear only when the row is unresolved.
  - Clicking Link opens `LinkProgressModal`.
  - Resolved rows show only Clear (no hint, no Link).
  - Resolved rows display `titleSort` when present, falling back to `title`.
- `user-progress-row/index.test.tsx`:
  - Resolved rows display `titleSort` when present, falling back to `title`.
  - (Existing admin Link-button-visibility tests remain green.)

## Out of scope

- No backend, route, or authorization changes.
- No change to admin Link behaviour beyond the shared title display/truncation.
