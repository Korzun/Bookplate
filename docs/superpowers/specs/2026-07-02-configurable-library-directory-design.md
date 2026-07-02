# Configurable library directory

## Goal

Let the user choose where the book library lives, configured from the Home
Assistant add-on **Configuration** page (the "Home Assistant settings").

Today `booksDir` is hardcoded to `/media/books` in `app/server/config.ts`,
overridable only by the `BOOKS_DIR` environment variable (used in dev via
`docker-compose.yml`). This adds a first-class add-on option so users can point
the library at any subfolder of the mapped `/media` share.

## Constraints

- Home Assistant add-ons can only reach **mapped** host folders. This add-on
  maps `media:rw` and `data:rw` (see `config.yaml`), so any library path must
  resolve inside `/media` (or `/data`). We use `/media`.
- The option is expressed as a **subpath under `/media`**, not an absolute path.
  This makes it impossible for the user to point outside the mapped folder.
  - `books` → `/media/books`
  - `library/fiction` → `/media/library/fiction`
- `booksDir` is resolved once at startup and consumed by `index.ts` (dir
  creation, migrations, `BookStore`, per-user folders). Changing the option
  restarts the add-on, which re-resolves it — no live reconfiguration needed.

## Design

### 1. New add-on option — `config.yaml`

Add to `options`:

```yaml
library_dir: books
```

Add to `schema`:

```yaml
library_dir: str
```

The default `books` reproduces today's exact behavior (`/media/books`), so
existing installs are unaffected after upgrade.

### 2. Resolve and sanitize — `app/server/config.ts`

- Add `library_dir: string` to the `Options` interface, default `'books'`, and
  read it from `options.json` alongside the other options.
- Compute `booksDir` with this precedence:
  1. `process.env.BOOKS_DIR` if set (keeps dev / `docker-compose` unchanged),
     else
  2. `/media/` joined with the **sanitized** `library_dir`.
- **Sanitization** guarantees the resolved path stays inside `/media`:
  - Trim whitespace; strip leading `/`.
  - Normalize the path.
  - If the value is empty after trimming, or normalization escapes `/media`
    (e.g. contains `..` traversal that resolves above the media root), fall back
    to the default `books` and log a warning.
  - The resolved `booksDir` is always `path.join('/media', <clean subpath>)`.

`AppConfig.booksDir` (in `app/server/types.ts`) is unchanged — still a single
absolute string. Only its source changes.

### 3. Behavior when the directory changes

Non-destructive. When the user changes `library_dir`, the app simply points at
the new directory. `index.ts` already runs
`fs.mkdirSync(config.booksDir, { recursive: true })`, so a missing new directory
is created empty. No files are moved at startup.

If the user had books in the old location, those files remain there. Moving
existing books to the new directory is the user's responsibility. (Auto-move at
startup is intentionally out of scope — it would require persisting the previous
path and handling partial/failed bulk moves.)

### 4. Tests — `app/server/config.test.ts` (colocated)

Cover the resolution logic:

- Default (no `library_dir` in options) → `booksDir === '/media/books'`.
- Custom subpath (`library/fiction`) → `booksDir === '/media/library/fiction'`.
- Traversal (`../escape`) and empty string → sanitized fallback to
  `/media/books` (+ warning).
- `BOOKS_DIR` env var takes precedence over `library_dir`.

### 5. Docs and versioning

- CHANGELOG entry: `feat: configurable library directory`.
- Version bump in `config.yaml` and `package.json` following the existing
  pattern (next patch/minor after 1.2.9).

## Out of scope (YAGNI)

- In-app settings UI for the library path (this is an add-on-config setting).
- Auto-migration / moving of existing book files.
- Arbitrary absolute paths outside the mapped `/media` folder.
