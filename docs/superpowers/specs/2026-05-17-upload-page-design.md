# Upload Page Design

**Date:** 2026-05-17
**Branch:** feat/react-migration

## Summary

Move `UploadZone` and `LibraryScan` off the library page onto a dedicated `/upload` page. The page shows each book's upload progress individually with a progress bar and `x/xmb` byte counter. Success and failure are shown inline per item rather than as toasts.

---

## Architecture

### New route

`/upload` → `UploadPage` (`client/src/page/upload/index.tsx`)

### Component tree

```
UploadPage
├── UploadZone         (drop zone — calls addFiles from hook, no local result state)
├── upload queue list
│   └── UploadItem × N (icon + filename + progress bar + x/xmb counter)
└── LibraryScan        (admin only — inline result text, no toast)
```

### New hook: `useUploadQueue`

**Location:** `client/src/provider/book/hook/use-upload-queue.ts`

Owns all queue state. Each item shape:

```ts
type UploadItem = {
  id: string;          // uuid, client-side only
  file: File;
  status: 'queued' | 'uploading' | 'done' | 'error';
  bytesUploaded: number;
  errorMessage?: string;
};
```

- Uses `XMLHttpRequest` per file (not `fetch`) — required for `upload.onprogress` byte events
- Rolling concurrency: as each upload finishes the next queued item starts immediately, keeping ≤ N uploads in flight at all times
- `N` is read from `GET /api/config` on mount; falls back to `3` on fetch failure
- Calls `fetchBookList()` after each successful upload

### New API endpoint: `GET /api/config`

Returns client-facing config:

```json
{ "maxConcurrentUploads": 3 }
```

### HA add-on config

`config.yaml` gains a new option:

```yaml
options:
  max_concurrent_uploads: 3
schema:
  max_concurrent_uploads: int
```

`AppConfig` and `app/config.ts` are updated to load and expose this field. The server passes it through to `GET /api/config`.

---

## Component detail

### `UploadItem` (`client/src/component/upload-item/index.tsx`)

| Status | Icon | Bar colour | Right label |
|---|---|---|---|
| `queued` | `ClockIcon` (Tabler, new) | gray, empty | `0.9 MB` |
| `uploading` | `UploadIcon` (Tabler, new) | blue, fills via XHR progress | `0.7 / 1.1 MB` |
| `done` | `CheckIcon` (exists) | green, full | `1.2 / 1.2 MB` |
| `error` | `CircleXIcon` (exists) | red, frozen | error message |

Two new icons are required: `clock` and `upload` from [Tabler Icons](https://tabler.io/icons). These follow the existing icon component pattern in `client/src/icon/`.

### `UploadZone` simplification

Strips all toast and result state. Accepts `addFiles: (files: FileList) => void` and handles drag/drop/click. `dragOver` boolean is its only local state.

### `LibraryScan` refactor

Removes the `Toast` import. Scan result is rendered as a small text line below the button — same content as today (`Scan complete: 3 imported, 0 removed` / `Scan failed`), just inline.

---

## Navigation

The header nav is currently gated by `isAdmin`. Since uploading is available to all authenticated users, the Upload link is moved outside the admin gate. Library and Users links remain admin-only.

Result for admins: `Library | Upload | Users`
Result for regular users: `Upload`

---

## Data flow

1. User drops or selects files → `addFiles(files)` appends them as `queued` items
2. Hook immediately starts up to N uploads
3. XHR `upload.onprogress` fires with `loaded`/`total` → `bytesUploaded` updates → bar fills
4. XHR `load` (HTTP 200): status → `done`, `fetchBookList()` called
5. XHR `load` (non-200) or `error`/`abort`: status → `error`, `errorMessage` from response body if available
6. When a slot frees, next `queued` item starts immediately
7. Dropping more files while uploads are running: new items append as `queued` and join the rolling queue
8. Queue items persist until the user navigates away

## Edge cases

- **Same filename uploaded twice:** both go through — server overwrites on disk (existing behaviour)
- **Config fetch failure:** falls back to `maxConcurrentUploads = 3`

---

## Testing

- `useUploadQueue`: `renderHook` tests stub `XMLHttpRequest`, verify concurrency limit, progress updates, done and error transitions
- `UploadItem`: snapshot/state test for each of the four status variants
- `GET /api/config`: unit test verifying correct value returned from `AppConfig`

---

## Files changed / created

| Path | Change |
|---|---|
| `config.yaml` | Add `max_concurrent_uploads` option and schema |
| `app/types.ts` | Add `maxConcurrentUploads` to `AppConfig` |
| `app/config.ts` | Load `max_concurrent_uploads` from options |
| `app/routes/ui.ts` | Add `GET /api/config` endpoint |
| `client/src/icon/clock.tsx` | New icon (Tabler) |
| `client/src/icon/upload.tsx` | New icon (Tabler) |
| `client/src/provider/book/hook/use-upload-queue.ts` | New hook |
| `client/src/provider/book/hook/use-upload-queue.test.tsx` | Tests |
| `client/src/component/upload-item/index.tsx` | New component |
| `client/src/component/upload-item/style.ts` | New styles |
| `client/src/component/upload-zone/index.tsx` | Simplify — remove toast/result state |
| `client/src/component/library-scan/index.tsx` | Replace toast with inline result |
| `client/src/page/upload/index.tsx` | New page |
| `client/src/page/upload/style.ts` | New styles |
| `client/src/page/index.ts` | Export `UploadPage` |
| `client/src/router/path-internal.ts` | Add `upload()` path |
| `client/src/router/component.tsx` | Add `/upload` route |
| `client/src/component/header/index.tsx` | Add Upload nav link outside admin gate |
