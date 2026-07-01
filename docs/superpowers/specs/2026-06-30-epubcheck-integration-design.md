# EPUBCheck validation on upload & edit

**Date:** 2026-06-30
**Branch:** `add-epubcheck`
**Status:** Approved (design)

> **Update (2026-07-02):** `epubcheck-ts` has since been published as the public,
> dual-format package **`@korzun/epubcheck-ts`**. The final implementation consumes
> it as a normal npm registry dependency (`app/server` depends on
> `@korzun/epubcheck-ts@^0.1.0-beta.1`); the git-submodule / npm-workspace approach
> described below (Architecture §1, the dual-format Prerequisite, and the Docker/CI
> submodule wiring) was implemented first and then replaced. Everything else in this
> spec — the validator adapter, the two enforcement points, and the error handling —
> is unchanged. See commit `1bc8d0a`.

## Goal

Validate EPUB files with [`epubcheck-ts`](https://github.com/Korzun/epubcheck-ts)
at the two points where the server takes responsibility for a file:

1. **On upload** — reject EPUBs that fail validation before they enter the library.
2. **On metadata edit** — verify the rewritten EPUB before it replaces the
   existing stored file, so a bad edit can never corrupt a stored book.

The blocking policy is **errors only**: an EPUB is rejected when it has any
`FATAL` or `ERROR` message. `WARNING`/`INFO`/`USAGE` messages never block (they
may be logged/surfaced, but do not stop the operation).

## Dependency: `epubcheck-ts`

`epubcheck-ts` is the author's own, actively-developed, unpublished package.
Relevant facts:

- API: `validateEpub(input: Uint8Array | ArrayBuffer | ReadableStream<Uint8Array>, options?: ValidateOptions): Promise<Report>`
- `Report = { messages: Message[]; epubVersion?: '2.0' | '3.0'; counts: Record<Severity, number>; fatal: boolean; valid: boolean }`
- `Severity = 'FATAL' | 'ERROR' | 'WARNING' | 'INFO' | 'USAGE'`
- `report.valid === (counts.FATAL === 0 && counts.ERROR === 0)` — this is exactly
  our "block on errors only" rule, so the adapter keys off `report.valid`.
- Pure-JS runtime deps only (`css-tree`, `fflate`, `saxes`) — runs in-process,
  no Java/native binary.
- Built with `tsdown` to `dist/`. Takes **bytes**, not a file path.

### Prerequisite: dual-format build (handled in the `epubcheck-ts` repo)

`app/server` compiles to **CommonJS** (`module: "commonjs"`, no `"type"` field;
`ts-node` + `ts-jest` also run as CJS). `epubcheck-ts` is currently **ESM-only**,
which CommonJS cannot `require()`, and `tsc` down-levels dynamic `import()` into
`require()` when targeting CommonJS.

**Resolution (out of scope for this repo, tracked separately):** `epubcheck-ts`
is being made **dual-format** — tsdown emits both `esm` + `cjs`, and its
`exports` map gains a `require` condition. Once that lands, `app/server` imports
it normally with no interop hacks, at runtime and under `ts-jest`. This spec
assumes the dual-format build is available at the pinned submodule commit.

## Architecture

### 1. Submodule wired as an npm workspace

- Add `Korzun/epubcheck-ts` as a git submodule at **`vendor/epubcheck-ts`**
  (creates `.gitmodules`, pinned to a commit SHA).
- Root `package.json`: add `"vendor/epubcheck-ts"` to `workspaces`.
- Root `package.json` `build` script builds it **first**:
  `npm run build -w epubcheck-ts && npm run build -w app/server && npm run build -w app/client`.
- `app/server/package.json`: add `"epubcheck-ts": "*"`. npm symlinks
  `node_modules/epubcheck-ts → vendor/epubcheck-ts`.
- **Build-ordering constraint:** the server's `tsc`, `tsc --noEmit` (lint), and
  `jest` all need `epubcheck-ts/dist` (its `.d.ts` + CJS entry) to exist first.
  We deliberately do **not** add a `prepare` script to `epubcheck-ts`: `prepare`
  would run during the Docker `npm ci --omit=dev` stage, where `tsdown` (a
  devDep) is absent, and fail. Instead `epubcheck-ts` is built explicitly in the
  build step, and CI builds before lint/test.

### 2. Validator adapter — `app/server/services/epub-validator.ts`

A small, independently-testable wrapper. Public surface:

- `class EpubValidationError extends Error` — carries the blocking
  (`FATAL`/`ERROR`) messages and the report `counts`.
- `async function assertValidEpub(bytes: Buffer): Promise<Report>` —
  calls `validateEpub(bytes)`; if `!report.valid`, throws `EpubValidationError`
  containing only the blocking messages; otherwise returns the full report.
  (`Buffer` is a `Uint8Array` subclass, so it is passed through directly.)
- `function formatMessages(messages: Message[])` — maps to the API response
  shape `{ id, severity, message, location? }`.

Types (`Report`, `Message`, `Severity`) are imported from `epubcheck-ts`.

### 3. Enforcement point A — upload (`app/server/routes/ui.ts`, `POST /api/books/upload`)

In the per-file loop, **after** `parseEpub(savedPath)` / `partialMD5(savedPath)`
and **before** `bookStore.addBook`:

```
const bytes = fs.readFileSync(savedPath);
await assertValidEpub(bytes);   // throws EpubValidationError if invalid
```

On `EpubValidationError`: `fs.unlinkSync(savedPath)` (mirroring the existing
parse-failure cleanup) and respond **400**:

```json
{ "error": "EPUB failed validation", "validation": { "messages": [...], "counts": {...} } }
```

### 4. Enforcement point B — metadata edit (`app/server/routes/ui.ts:838`)

Today `writeMetadata(book.path, changes)` rewrites the EPUB **in place**
(`zip.writeZip(filePath)`), so an edit that produced an invalid archive would
overwrite the stored book before anything checked it.

Changes:

- **Refactor `app/server/services/epub-writer.ts`:** extract
  `buildUpdatedEpub(srcPath: string, changes: EpubChanges): Buffer` — the
  existing rewrite logic, ending in `return zip.toBuffer()` instead of
  `zip.writeZip(filePath)`.
- **Edit route flow:**
  1. `const updated = buildUpdatedEpub(book.path, changes)`
  2. `await assertValidEpub(updated)` — on `EpubValidationError`, respond **422**
     `{ error, validation }`; **the original file is untouched**, no reimport.
  3. Persist atomically: write `updated` to a temp file in `booksDir`, then
     `fs.renameSync(temp, book.path)`. The original is replaced only after the
     new bytes validate, and the rename is crash-safe.
  4. `reimportBook` as today.

### 5. Docker & CI

- **Dockerfile** (`builder` / `prod-deps` / `runtime`):
  - `builder`: `COPY vendor/epubcheck-ts/ ./vendor/epubcheck-ts/` and let
    `npm run build` build it (added to the root build script).
  - `prod-deps`: `COPY vendor/epubcheck-ts/package*.json ./vendor/epubcheck-ts/`
    before `npm ci --omit=dev`, so its runtime deps install and the workspace
    symlink is created.
  - `runtime`: `COPY --from=builder /hass-odps/vendor/epubcheck-ts ./vendor/epubcheck-ts`
    so the `node_modules/epubcheck-ts` symlink resolves to the prebuilt `dist/`.
- **CI** (`.github/workflows/ci.yml`, `.github/workflows/release.yml`): add
  `with: submodules: recursive` to the `actions/checkout` steps; ensure the
  build runs before lint/test.

## Data flow

```
Upload:  multipart → multer stage file → parseEpub → assertValidEpub(bytes)
           ├─ invalid → unlink staged file → 400 { error, validation }
           └─ valid   → bookStore.addBook → thumbnail enqueue → 200

Edit:    body → EpubChanges → buildUpdatedEpub(book.path) : Buffer
           → assertValidEpub(buffer)
           ├─ invalid → 422 { error, validation }   (original file unchanged)
           └─ valid   → write temp → rename over book.path → reimportBook → 200
```

## Error handling

| Condition | Status | Body |
|-----------|--------|------|
| Upload: EPUB fails validation | 400 | `{ error: 'EPUB failed validation', validation }` |
| Upload: parse failure (existing) | 400 | `{ error: 'Failed to parse EPUB: …' }` |
| Edit: rewritten EPUB fails validation | 422 | `{ error, validation }` (original untouched) |
| Edit: `buildUpdatedEpub` throws (existing) | 500 | `{ error: 'Failed to update EPUB: …' }` |

`validation = { messages: { id, severity, message, location? }[], counts: Record<Severity, number> }`,
filtered to `FATAL`/`ERROR` messages.

## Testing

- **`app/server/services/epub-validator.test.ts`** — using the in-memory
  `makeEpub()` pattern from `epub-writer.test.ts`:
  - well-formed EPUB → `assertValidEpub` resolves with `report.valid === true`;
  - malformed EPUB (e.g. compressed/incorrect `mimetype`, missing
    `META-INF/container.xml`) → throws `EpubValidationError` with the expected
    blocking messages and excludes non-blocking severities.
- **`app/server/routes/ui.test.ts`**:
  - upload of an invalid EPUB → 400, staged file removed, book not added;
  - metadata edit yielding an invalid EPUB → 422, original bytes unchanged, no
    reimport;
  - existing valid upload/edit paths still succeed.
- Tests require `epubcheck-ts/dist` to be built first (enforced by build order
  locally and in CI).

## Trade-offs & decisions

- **Validation latency:** runs in-process on every upload/edit. Pure-JS;
  negligible for typical books, a few ms more for large EPUBs. Only on write
  paths. Accepted.
- **Status codes:** 400 on upload (consistent with the existing parse-failure
  response); 422 on edit to distinguish "your metadata produced an invalid EPUB"
  from a server error. Accepted.
- **`epub-writer` refactor:** returning a `Buffer` + atomic temp-rename replaces
  the current in-place write. This both enables validate-before-replace and makes
  the write crash-safe. Accepted.
- **Bridge fix lives upstream:** `epubcheck-ts` becomes dual-format rather than
  hacking dynamic-import shims into the CJS server. Accepted (see Prerequisite).

## Out of scope

- The `epubcheck-ts` dual-format build change (separate repo, tracked separately).
- Surfacing non-blocking warnings in the client UI (advisory display) — could be
  a follow-up; this spec only logs/returns them in the response payload.
- Re-validating the entire existing library (batch/backfill).
