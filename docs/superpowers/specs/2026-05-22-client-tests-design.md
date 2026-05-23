# Client Test Coverage — Design Spec

**Date:** 2026-05-22
**Scope:** Logic-bearing client code without tests (hooks, utils, controls/components with behaviour) + triage of existing tests

---

## Context

The client has 25 existing test files. This spec covers:
1. **Triage** of existing tests against the logic-bearing threshold (delete below-threshold files, repair inconsistencies).
2. **New tests** for the remaining untested logic-bearing files.

Purely presentational components (icon wrappers, JSS style files, provider wrappers) and trivial context-reader hooks (`use-is-admin`, `use-username`, `use-auth-refresh`) are explicitly excluded.

---

## Triage of Existing Tests

### Delete

**`src/provider/theme/provider.test.tsx`**
Tests that specific color/spacing string constants (`#1777FF`, `8px`, etc.) are wired through JSS's `ThemeProvider`. No conditional logic, no behaviour, no data transformation — it is a snapshot of static config values and falls below the logic-bearing threshold.

### Repair

**`src/provider/user/hook/use-user-list.test.tsx`**
The first test (`'returns empty list and default state initially'`) stubs fetch as `{ json: () => Promise.resolve([]) }` without `ok: true`. The current `useUserList` implementation skips the `ok` check so the test passes, but it is inconsistent with every other hook test in the codebase. If an `ok` guard is ever added, this test would silently exercise the error path while asserting success. Fix: add `ok: true` to the fetch mock.

---

## Architecture

Four agent groups run in parallel. Each agent:
1. Reads its source files and one or two existing tests as style references.
2. Writes test files following established project patterns.

**Patterns in use:**
- Pure functions: plain `describe`/`it` with no React imports.
- Hooks: `renderHook` from `@testing-library/react` with a minimal context wrapper (see `use-book.test.tsx` for the canonical example).
- Network: `vi.stubGlobal('fetch', vi.fn().mockResolvedValue(...))` + `afterEach(() => vi.unstubAllGlobals())`.
- UI: `renderWithProviders` from `~/test-utils` + `userEvent` from `@testing-library/user-event`.
- Test files live next to the source file they test (same directory, `.test.ts` or `.test.tsx`).

---

## Group 1 — Utils + Auth/User Hooks

**Source files:**
- `src/provider/book/util.ts`
- `src/provider/user/hook/util.ts`
- `src/provider/auth/hook/use-logout.ts`
- `src/provider/user/hook/use-user.ts`

**Test files to create:**
- `src/provider/book/util.test.ts`
- `src/provider/user/hook/util.test.ts`
- `src/provider/auth/hook/use-logout.test.tsx`
- `src/provider/user/hook/use-user.test.ts`

**What to test:**

`bookSort`: sorts two books alphabetically by title; equal titles compare equal.

`removeUserByUsername`: removes the keyed entry; leaves other keys intact; handles missing key gracefully.

`useLogout`:
- Calls `fetch('/logout', { method: 'POST' })` when logout is invoked.
- Sets `loading: true` while the request is in flight.
- Redirects (`window.location.href = '/login'`) on success.
- Sets `error: true` and populates `errorMessage` when fetch throws.
- Resets `loading` to `false` in both success and error paths.
- Testing the redirect: stub `window.location` via `Object.defineProperty` (or `vi.stubGlobal`) before calling logout, then assert `window.location.href === '/login'`.

`useUser`:
- Returns `[user, loading, false, undefined]` when the user is found in the list.
- Returns `[undefined, true, false, undefined]` while the list is loading and user is absent.
- Returns `[undefined, false, true, "Unknown user <name>"]` when loading is done and user is not found.
- Propagates the error tuple from `useUserList` when it errors.

---

## Group 2 — Book Read Hooks

**Source files:**
- `src/provider/book/hook/use-book-list.ts`
- `src/provider/book/hook/use-fetch-book-list.ts`
- `src/provider/book/hook/use-series-list.ts`
- `src/provider/book/hook/use-standalone-book-list.ts`

**Test files to create:**
- `src/provider/book/hook/use-book-list.test.tsx`
- `src/provider/book/hook/use-fetch-book-list.test.tsx`
- `src/provider/book/hook/use-series-list.test.ts`
- `src/provider/book/hook/use-standalone-book-list.test.ts`

**What to test:**

`useBookList`:
- Triggers `fetchBookList` when `bookListFetched` is false and no request is in flight.
- Does not re-fetch when `bookListFetched` is already true.
- Does not re-fetch while `bookListLoading` is true.
- Returns books sorted alphabetically by title.
- Passes through `loading`, `error`, and `errorMessage` from context.

`useFetchBookList`:
- Calls `GET /api/books` and populates context via `setBookList`.
- Sets `bookListFetched: true` on success.
- Preserves complete book data for books already in `completeBookIds`.
- Sets error message when the response is not ok.
- Bails early (no fetch) when `bookListLoading` is already true.

`useSeriesList`:
- Groups books by `series` field; books with no series are excluded.
- Sorts books within each series by `seriesIndex` ascending.
- Sorts series entries alphabetically.
- Returns an empty array when the book list is empty.
- Passes through `loading`, `error`, `errorMessage`.

`useStandaloneBookList`:
- Returns only books where `series` is empty/falsy.
- Returns all books when none belong to a series.
- Returns an empty array when all books belong to a series.
- Passes through `loading`, `error`, `errorMessage`.

---

## Group 3 — Book Mutation Hooks

**Source files:**
- `src/provider/book/hook/use-delete-book.ts`
- `src/provider/book/hook/use-patch-book-metadata.ts`

**Test files to create:**
- `src/provider/book/hook/use-delete-book.test.tsx`
- `src/provider/book/hook/use-patch-book-metadata.test.tsx`

**What to test:**

`useDeleteBook`:
- Optimistically removes the book from context before the request completes.
- Calls `DELETE /api/books/:id` (URL-encoded).
- On success (204): book stays removed, no error set.
- On non-204 response: rolls back the book into context, sets `error: true`.
- On fetch throw: rolls back, sets `error: true` and `errorMessage`.
- Sets `loading: true` during the request and resets it in both paths.
- Sets `error: true` immediately (no fetch) when the book ID is not in the list.

`usePatchBookMetadata`:
- Builds a `FormData` with scalar fields (title, author, etc.) as plain strings.
- Serialises `subjects` and `identifiers` as JSON strings in the FormData.
- Appends `cover` as a `File` blob when provided.
- Calls `PATCH /api/books/:id/metadata`.
- On success: updates context with the returned book; if the returned `id` differs from the request `id`, removes the old key.
- Returns the new `id` on success.
- On error response: reads `body.error` for the message; falls back to `'Save failed'`.
- Sets `loading` and resets it in both paths.

---

## Group 4 — UI Controls/Components

**Source files:**
- `src/control/switch/index.tsx`
- `src/component/collapsible-section/index.tsx`
- `src/component/progress-indicator/index.tsx`
- `src/component/chapter-progress/index.tsx`
- `src/control/number-input/index.tsx`
- `src/control/confirm-modal/index.tsx`
- `src/control/proportional-chapter-slider/index.tsx`

**Test files to create:**
- `src/control/switch/index.test.tsx`
- `src/component/collapsible-section/index.test.tsx`
- `src/component/progress-indicator/index.test.tsx`
- `src/component/chapter-progress/index.test.tsx`
- `src/control/number-input/index.test.tsx`
- `src/control/confirm-modal/index.test.tsx`
- `src/control/proportional-chapter-slider/index.test.tsx`

**What to test:**

`Switch`:
- Renders with `role="switch"` and correct `aria-checked` value.
- Calls `onChange(!checked)` when clicked.
- Calls `onChange(!checked)` when Enter or Space is pressed.
- Does not call `onChange` when `disabled` is true.
- Renders the `label` text when provided.

`CollapsibleSection`:
- Children are hidden by default (uncontrolled).
- Clicking the header toggles children visible/hidden.
- Pressing Enter or Space on the header toggles children.
- Calls `onOpenToggle` callback each time the header is activated.
- Controlled mode: respects the `open` prop; does not show children when `open={false}` even after a click.
- Renders `subTitle` when provided.
- Renders `actions` nodes in the header.

`ProgressIndicator`:
- Renders "Not started" text when value is 0.
- Renders "Completed" text when value is 1.
- Renders a percentage string (e.g. "50%") for mid-range values.
- Renders the SVG element only when value is between 0 and 1 (exclusive).
- Clamps values below 0 to "Not started" and above 1 to "Completed".

`ChapterProgress`:
- Renders "Ch {current} / {total}" when no name is given.
- Renders "Ch {current}: {name} / {total}" when a name is given.

`NumberInput`:
- Calls `onChange` with the parsed `number` when a valid numeric string is typed.
- Calls `onChange` with `undefined` when the field is cleared.
- Calls `onValidChange(name, false)` when an invalid (non-numeric) string is entered.
- Calls `onValidChange(name, true)` when the field recovers from invalid.
- Syncs the displayed value when the external `value` prop changes.

`ConfirmModal`:
- Renders `title` and `children`.
- Calls `onConfirm` when the confirm button is clicked.
- Calls `onCancel` when the cancel button is clicked.
- Renders custom `confirmText` and `cancelText`.

`ProportionalChapterSlider`:
- `chapterPct` logic: returns 0 for chapter 0; returns 100% equivalent for the last chapter; correctly proportions intermediate chapters using `chapterSpineMap`.
- `nearestChapter` logic: returns the chapter index closest to a given percentage.
- These are tested via the rendered tick positions and the `onChange` value emitted on pointer-up.
- When dragging is disabled, pointer-down does not trigger `onDragChange`.

---

## Excluded Files

The following are intentionally not covered:
- Simple context-reader hooks (`use-is-admin`, `use-username`, `use-auth-refresh`) — no logic beyond `useContext` + `useMemo`.
- Provider wrapper components (`auth/provider.tsx`, `book/provider.tsx`, etc.) — thin context wiring.
- Style files, icon components, `main.tsx`, `App.tsx`.
- `provider/theme/use-theme.tsx` — one-liner delegating to `react-jss`.
