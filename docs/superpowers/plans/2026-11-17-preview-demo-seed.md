# Preview Demo Seed Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** When the container starts with `SEED_DEMO=1`, wipe the data and library, then seed a fixed demo data set (users, real books, edge-case books, ratings, requests, reading history, a device) before serving.

**Architecture:** `config.ts` gains `seedDemo` / `seedPassword`. `index.ts` empties `DATA_DIR` and `BOOKS_DIR` (guarded) before opening the DB, then passes a `seed` hook to `startBookplate`, which runs it right after `ensureAdminUser` and before the startup scan. The seeder lives in `app/server/demo-seed/`: it imports committed CC0 EPUBs (plus edge-case copies derived at seed time) through the real `importEpub` pipeline, then writes activity through existing services.

**Tech Stack:** Node/TypeScript, Prisma (SQLite), Vitest, fflate (already used by `epub-zip.ts` / `epub-writer.ts`), Docker.

**Spec:** `docs/superpowers/specs/2026-11-17-preview-demo-seed-design.md`

## Global Constraints

- The seed runs only when `SEED_DEMO` is exactly `1` (read through `config.ts`'s `envVar`, so blank = unset). Without it, startup behaves exactly as today.
- `SEED_DEMO=1` without `SEED_PASSWORD` fails startup with a clear error.
- Seeded users `alice`, `bob`, `carol` all use `SEED_PASSWORD`; the admin keeps `ADMIN_USER`/`ADMIN_PASS`.
- Emails use `example.com` only (`alice@example.com`, `bob@example.com`).
- Books are imported through `services/import-epub.ts` `importEpub` — never inserted as raw `Book` rows. Validation warnings and the pending fix must be what that pipeline produces.
- Direct Prisma writes are allowed only where no service exists: ratings, `DeviceUser` access.
- Wipe empties both directories' contents (not the directories themselves — they are volume mount points) and refuses when either path is `/`, both are equal, or one contains the other.
- Any seed error exits the process non-zero.
- Reading history timestamps are relative to seed time, spread over the last 21 days.
- Fixtures are CC0 Standard Ebooks EPUBs; sources recorded in `app/server/demo-seed/fixtures/README.md`.
- Never stage the untracked `core.105933` in the repo root; use explicit `git add` paths.

## Review Focus

- `SEED_DEMO` unset, `0`, `true` or blank on a populated library → nothing is deleted and no seeding runs.
- A seed failure (e.g. a fixture missing) → process exits non-zero instead of the async IIFE's `unhandledRejection` handler logging and leaving a process with nothing listening.
- `importEpub` auto-fixes can rotate a book id → every later reference (progress `document`, request fulfilment, ratings) uses the id `importEpub` returned, not the pre-import fingerprint.
- Wiping a Docker volume mount point itself fails with `EBUSY` → only children are removed.
- Second start on an already-seeded volume → wipe + seed succeeds and yields the same data (no "username exists" or duplicate-book failures).

---

### Task 1: Config — `seedDemo` and `seedPassword`

**Files:**
- Modify: `app/server/types.ts` (`AppConfig`)
- Modify: `app/server/config.ts` (`loadConfig`)
- Test: `app/server/config.test.ts`

**Interfaces:**
- Produces: `AppConfig.seedDemo: boolean`, `AppConfig.seedPassword: string | undefined`.

- [ ] **Step 1: Write the failing tests** in `config.test.ts`, following the file's existing env-stubbing pattern:
  - `seedDemo` is `false` when `SEED_DEMO` is unset, `''`, `'  '`, `'0'`, `'true'`.
  - `seedDemo` is `true` when `SEED_DEMO='1'` (and `' 1 '`, since `envVar` trims) with `SEED_PASSWORD='pw'`; `seedPassword === 'pw'`.
  - `SEED_PASSWORD` is read with `{ trim: false }` (`' pw '` stays `' pw '`).
  - `loadConfig()` throws an error whose message contains `SEED_PASSWORD` when `SEED_DEMO='1'` and `SEED_PASSWORD` is unset or blank.
- [ ] **Step 2: Run** `cd app/server && npx vitest run config.test.ts` — expect the new tests to FAIL.
- [ ] **Step 3: Implement** — add both fields to `AppConfig` with a doc comment saying `seedDemo` wipes data; in `loadConfig`, `seedDemo = envVar('SEED_DEMO') === '1'`, `seedPassword = envVar('SEED_PASSWORD', { trim: false })`, throw when `seedDemo && !seedPassword`. Update any `AppConfig` literals in tests/fixtures that the typechecker flags (`npx tsc --noEmit -p tsconfig.test.json` if present, else `npx tsc --noEmit`).
- [ ] **Step 4: Run** `npx vitest run config.test.ts` — PASS; and the typecheck — clean.
- [ ] **Step 5: Commit** `git add app/server/types.ts app/server/config.ts app/server/config.test.ts <any fixture files touched>` / `git commit -m "feat(config): SEED_DEMO and SEED_PASSWORD"`

### Task 2: Guarded directory reset

**Files:**
- Create: `app/server/demo-seed/reset.ts`
- Test: `app/server/demo-seed/reset.test.ts`

**Interfaces:**
- Produces: `resetDemoDirs(dataDir: string, booksDir: string): void` — throws `Error` (message names the offending path) on a refused pair; otherwise removes every child of both directories (creating a missing directory rather than failing) and leaves the directories themselves.

- [ ] **Step 1: Write the failing tests** (temp dirs under `os.tmpdir()`):
  - Removes files and nested subdirectories inside both dirs; both dirs still exist afterwards and are empty.
  - Creates a dir that does not exist yet.
  - Throws, and deletes nothing, for: `('/', x)`, `(x, '/')`, `(x, x)`, `(x, path.join(x, 'books'))`, `(path.join(y, 'data'), y)`; also when paths differ only by a trailing slash or `..` segment (compare `path.resolve`d paths).
- [ ] **Step 2: Run** `npx vitest run demo-seed/reset.test.ts` — FAIL.
- [ ] **Step 3: Implement** with `path.resolve`, a containment check via `path.relative` (not string prefix), and `fs.rmSync(child, { recursive: true, force: true })` per `fs.readdirSync` entry. Validate both paths before deleting anything.
- [ ] **Step 4: Run** — PASS.
- [ ] **Step 5: Commit** `git add app/server/demo-seed/reset.ts app/server/demo-seed/reset.test.ts` / `git commit -m "feat(seed): guarded reset of data and library dirs"`

### Task 3: Fixtures and derived edge-case EPUBs

**Files:**
- Create: `app/server/demo-seed/fixtures/*.epub` (8 files, below), `app/server/demo-seed/fixtures/README.md`
- Create: `app/server/demo-seed/fixtures.ts`
- Test: `app/server/demo-seed/fixtures.test.ts`

**Interfaces:**
- Produces:
  - `demoFixturesDir(): string` — `path.join(serverRootFrom(__dirname), 'demo-seed', 'fixtures')` (works under tsx and compiled `dist/demo-seed/`).
  - `FIXTURES` — a const record of the 8 fixture filenames keyed by short name: `princessOfMars`, `godsOfMars`, `warlordOfMars`, `prideAndPrejudice`, `frankenstein`, `timeMachine`, `dracula`, `sherlockHolmes`.
  - `deriveNoCover(src: string, dest: string): void` — copy with the cover image file, its manifest item and the `cover` meta / `cover-image` property removed.
  - `deriveAllCapsTitle(src: string, dest: string): void` — copy with `dc:title` upper-cased (use `buildUpdatedEpub(src, { title })` from `services/epub-writer.ts`).
  - `deriveWithWarning(src: string, dest: string): void` — copy damaged so `validateEpubReport` reports ≥1 `WARNING` and no `ERROR`/`FATAL` at threshold `Error`. Start with adding an undeclared file (e.g. `OEBPS/notes.txt`) not in the manifest; if that isn't a WARNING in this validator, try another damage until the test passes, and record which in a comment.

Fixture downloads (append `?source=download`; plain URLs return HTML):
`https://standardebooks.org/ebooks/<slug>/downloads/<file>.epub` with
- `edgar-rice-burroughs/a-princess-of-mars` → `edgar-rice-burroughs_a-princess-of-mars.epub`
- `edgar-rice-burroughs/the-gods-of-mars`
- `edgar-rice-burroughs/the-warlord-of-mars`
- `jane-austen/pride-and-prejudice`
- `mary-shelley/frankenstein`
- `h-g-wells/the-time-machine`
- `bram-stoker/dracula`
- `arthur-conan-doyle/the-adventures-of-sherlock-holmes`

(file name pattern `<author-slug>_<book-slug>.epub`). If a slug 404s, substitute another CC0 Standard Ebooks title and note it in the README. The Martian books already carry `belongs-to-collection` "Martian" with `group-position` 1–3.

- [ ] **Step 1: Download** the 8 EPUBs into `app/server/demo-seed/fixtures/`, verify each is `application/epub+zip` (`unzip -l` lists `mimetype`), and write `README.md`: one line per file with its source URL, "Released under CC0 by Standard Ebooks", and a note that these are demo-seed fixtures shipped in the image.
- [ ] **Step 2: Write the failing tests** in `fixtures.test.ts`:
  - every `FIXTURES` file exists in `demoFixturesDir()` and `parseEpub` returns a non-empty title.
  - `deriveNoCover` output: `parseEpub` gives no cover (`coverData` null/undefined); title unchanged.
  - `deriveAllCapsTitle` output: title equals the source title upper-cased.
  - `deriveWithWarning` output: `validateEpubReport(bytes, 'Error')` is valid and has ≥1 message with severity `WARNING`.
- [ ] **Step 3: Run** `npx vitest run demo-seed/fixtures.test.ts` — FAIL.
- [ ] **Step 4: Implement** `fixtures.ts` (use `fflate` `unzipSync` + `packEpub` from `services/epub-zip.ts` for the no-cover and warning derivations).
- [ ] **Step 5: Run** — PASS.
- [ ] **Step 6: Commit** `git add app/server/demo-seed/fixtures app/server/demo-seed/fixtures.ts app/server/demo-seed/fixtures.test.ts` / `git commit -m "feat(seed): CC0 fixture EPUBs and edge-case derivations"`

### Task 4: The seeder

**Files:**
- Create: `app/server/demo-seed/seed.ts`
- Test: `app/server/demo-seed/seed.test.ts`

**Interfaces:**
- Consumes: Task 1's `AppConfig.seedPassword`; Task 3's `demoFixturesDir`, `FIXTURES`, `derive*`; `importEpub` + `ImportEpubDeps` (`services/import-epub.ts`); `getStagingDir` (`services/book-paths.ts`); `createUser` (`services/user.ts`); `hashLoginPassword` (`services/password.ts`); `setUserEmail`, `markEmailVerified` (`services/email.ts`); `createBookRequest`, `fulfillBookRequest`, `declineBookRequest` (`services/book-request.ts`); `saveProgress` (`services/progress.ts`, accepts a `timestamp` in seconds); `createDevice` (`services/device.ts`).
- Produces: `seedDemo(deps: ImportEpubDeps, opts?: { now?: number; fixturesDir?: string }): Promise<DemoSeedSummary>` where `DemoSeedSummary = { users: string[]; books: Record<string, string[]> /* username → book ids */ }`. Throws on any failure (any `importEpub` result other than `imported`, any service outcome other than success, `createUser` returning `false`).

Data set (exact):
- **alice** — email `alice@example.com`, verified. Books: the 3 Martian books, Pride and Prejudice, Sherlock Holmes (as-is); Time Machine via `deriveNoCover`; Dracula via `deriveAllCapsTitle` (must yield a `PendingFix` row); Frankenstein via `deriveWithWarning` (its `Validation` must hold a `WARNING`). Ratings (direct `prisma.book.update`, all five rating columns + `ratedAt`): A Princess of Mars 5/5/4/4/5, Pride and Prejudice 5/4/5/5/4, Sherlock Holmes 4/4/4/4/3, The Gods of Mars 3/4/3/3/3. Progress via `saveProgress` with device name `Kobo Libra 2` and a fixed `device_id` (`demo-kobo-libra-2`): A Princess of Mars finished (1.0), The Gods of Mars 0.15, Pride and Prejudice 0.42, Sherlock Holmes 0.70 — each reached through several backdated saves spread over the last 21 days (sessions > 600 s apart so `ProgressHistory` gets separate rows). Requests: pending "The Wind in the Willows" / "Kenneth Grahame"; fulfilled "The Warlord of Mars" / "Edgar Rice Burroughs" → fulfilled with alice's Warlord book id; declined "Dune" / "Frank Herbert", reason "Not available as a DRM-free EPUB".
- **bob** — email `bob@example.com`, verified. Books: Pride and Prejudice and The Time Machine (as-is). Request: pending "Treasure Island" / "Robert Louis Stevenson".
- **carol** — no email, no books, `mustChangePassword` false.
- **Device** — `createDevice` named `Kobo Libra 2` (other `DeviceInput` fields: the defaults the device UI uses — read `graphql` device create mutation), plus `prisma.deviceUser.create` for alice.

Stage each EPUB by copying (or deriving) into `getStagingDir(config.booksDir)` with a unique name before `importEpub`, since `addBook` moves the staged file. Pass `originalName` as the fixture filename.

- [ ] **Step 1: Write the failing tests** in `seed.test.ts` using a temp-dir harness like `services/import-epub.test.ts` (fresh SQLite via `runMigrations`, a stub thumbnail queue). Set the file's timeout high (`{ timeout: 180_000 }`) — imports and password hashing are slow on ARM. Tests:
  - after `seedDemo`: users `alice`, `bob`, `carol` exist; `validateUser` (or `authenticate`) accepts `SEED_PASSWORD` for each.
  - alice has 9 books, bob 2, carol 0; the three Martian books share one series with indices 1, 2, 3.
  - alice's Time Machine has no cover; her Dracula has a `PendingFix` row; her Frankenstein's validation has a `WARNING` message.
  - alice has 4 rated books; 4 `Progress` rows whose `document` ids all exist in `books` for alice; `ProgressHistory` for alice has ≥ 8 rows, all with `endTimestamp` within `[now − 21 days, now]`.
  - alice's requests: one each of `pending`, `fulfilled` (with `bookId` set to her Warlord book), `declined` (reason as above); bob has one `pending`.
  - device `Kobo Libra 2` exists and alice is in its `DeviceUser` rows.
  - alice and bob have verified emails; carol's `email` is null.
  - **repeatability:** two seeds into two fresh temp roots with the same `now` give equal sets of usernames, book ids per user, request (title, status) pairs and progress (document, percentage) pairs.
- [ ] **Step 2: Run** `npx vitest run demo-seed/seed.test.ts` — FAIL.
- [ ] **Step 3: Implement** `seed.ts`.
- [ ] **Step 4: Run** — PASS.
- [ ] **Step 5: Commit** `git add app/server/demo-seed/seed.ts app/server/demo-seed/seed.test.ts` / `git commit -m "feat(seed): demo data set seeder"`

### Task 5: Wire it into startup, the image, and the docs

**Files:**
- Modify: `app/server/startup.ts` (`StartupDeps`, `startBookplate`)
- Modify: `app/server/startup.test.ts`
- Modify: `app/server/index.ts`
- Modify: `Dockerfile` (runtime stage)
- Modify: `README.md` (Coolify section)
- Check: `.dockerignore` does not exclude `app/server/demo-seed/fixtures`

**Interfaces:**
- Consumes: Task 1 config fields, Task 2 `resetDemoDirs`, Task 4 `seedDemo`.
- Produces: `StartupDeps.seed?: () => Promise<void>` — awaited immediately after `ensureAdminUser`, before the startup scan; errors propagate (not swallowed by the scan's try/catch).

- [ ] **Step 1: Write the failing tests** in `startup.test.ts`, following its existing call-order pattern: `seed` runs after `ensureAdminUser` and before the scan; when `seed` rejects, `startBookplate` rejects and `server.listen` is never called; with no `seed`, behaviour is unchanged (existing tests stay green).
- [ ] **Step 2: Run** `npx vitest run startup.test.ts` — FAIL.
- [ ] **Step 3: Implement**
  - `startup.ts`: add the optional hook and call it as specified.
  - `index.ts`: right after `loadConfig()`, before the `mkdirSync` calls: `if (config.seedDemo) { log.warn('SEED_DEMO=1: wiping DATA_DIR and BOOKS_DIR and seeding demo data'); resetDemoDirs(config.dataDir, config.booksDir); }`. Pass `seed: config.seedDemo ? async () => { const s = await seedDemo({ prisma, config, editionsRoot, thumbnailQueue }); log.info(...summary...); } : undefined` to `startBookplate`. Make the IIFE exit non-zero on rejection: wrap its body or append `.catch((err) => { log.error(...); process.exit(1); })` — the `unhandledRejection` handler alone only logs.
  - `Dockerfile` runtime stage: `COPY app/server/demo-seed/fixtures ./app/server/demo-seed/fixtures` (next to the other `app/server` copies).
  - `README.md` Coolify section: a short "Preview / demo data" note — `SEED_DEMO=1` wipes `/data` and `/media/books` on **every start** and seeds demo users `alice`/`bob`/`carol` (password `SEED_PASSWORD`); never set it on a real library.
- [ ] **Step 4: Run** `npx vitest run startup.test.ts config.test.ts demo-seed` — PASS; `npm run build -w app/server` (or `cd app/server && npm run build`) — succeeds and `dist/demo-seed/seed.js` exists; `npm run lint` — clean.
- [ ] **Step 5: Commit** `git add app/server/startup.ts app/server/startup.test.ts app/server/index.ts Dockerfile README.md` / `git commit -m "feat(seed): run the demo seed at startup behind SEED_DEMO"`

### After the tasks (controller, not an implementer)

Deploying to the preview is outside the repo: push `preview-seed` to `preview` and set `SEED_DEMO=1` and `SEED_PASSWORD` on the Coolify "Bookplate (preview)" app — only with the user's go-ahead for the push. Then confirm `/api/health`, log in as alice, and check the library, requests and stats show the seeded data.
