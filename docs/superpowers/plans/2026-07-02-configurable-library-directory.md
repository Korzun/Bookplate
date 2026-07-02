# Configurable Library Directory Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Let users set the library directory from the Home Assistant add-on Configuration page, as a subpath under `/media`.

**Architecture:** Add a `library_dir` add-on option (`config.yaml`) that Home Assistant writes to `/data/options.json`. `app/server/config.ts` reads it, sanitizes it so it can never escape `/media`, and uses it to resolve the existing `booksDir` field. All downstream code (`index.ts`, migrations, `BookStore`) is unchanged because it still consumes a single absolute `config.booksDir` string.

**Tech Stack:** TypeScript, Node.js, Jest (ts-jest), Home Assistant add-on config schema (YAML).

## Global Constraints

- Library path must resolve **inside `/media`** (the mapped host folder). Never allow escape via `..` or absolute paths.
- Default `library_dir` value is `books`, resolving to `/media/books` — identical to current behavior. Existing installs must be unaffected.
- `BOOKS_DIR` environment variable, when set, takes precedence over `library_dir` (preserves dev / `docker-compose.yml`).
- Tests are colocated (`*.test.ts` next to source) and use real fs with temp dirs (per existing codebase style), not fs mocks.
- React component filenames are kebab-case (N/A here — no React changes).
- Run lint from repo root: `npm run lint`.

---

### Task 1: Configurable library directory resolution

**Files:**
- Modify: `config.yaml` (add `library_dir` to `options` and `schema`)
- Modify: `app/server/config.ts` (add option + `resolveBooksDir` helper)
- Create: `app/server/config.test.ts`

**Interfaces:**
- Consumes: nothing new.
- Produces: `loadConfig(): AppConfig` — unchanged signature. `config.booksDir` remains an absolute path string. New internal, exported helper `resolveBooksDir(libraryDir: string): string` returns an absolute path guaranteed to be inside `/media`.

- [ ] **Step 1: Add the option to `config.yaml`**

Under `options:` add the `library_dir` line, and under `schema:` add its type. The result must read:

```yaml
options:
  library_name: HASS-ODPS
  library_dir: books
  username: admin
  password: changeme
  max_concurrent_uploads: 3
schema:
  library_name: str
  library_dir: str
  username: str
  password: str
  max_concurrent_uploads: int
```

- [ ] **Step 2: Write the failing test**

Create `app/server/config.test.ts`:

```ts
import * as os from 'os';
import * as path from 'path';
import * as fs from 'fs';
import { loadConfig } from './config';

jest.mock('./logger');

let dataDir: string;
const originalEnv = { ...process.env };

function writeOptions(options: Record<string, unknown>): void {
  fs.writeFileSync(path.join(dataDir, 'options.json'), JSON.stringify(options));
}

beforeEach(() => {
  dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'odps-config-'));
  process.env = { ...originalEnv };
  process.env.DATA_DIR = dataDir;
  delete process.env.BOOKS_DIR;
});

afterEach(() => {
  process.env = { ...originalEnv };
  fs.rmSync(dataDir, { recursive: true, force: true });
});

describe('loadConfig booksDir resolution', () => {
  it('defaults to /media/books when library_dir is absent', () => {
    writeOptions({ library_name: 'X' });
    expect(loadConfig().booksDir).toBe('/media/books');
  });

  it('resolves a custom subpath under /media', () => {
    writeOptions({ library_dir: 'library/fiction' });
    expect(loadConfig().booksDir).toBe('/media/library/fiction');
  });

  it('strips leading slashes from the subpath', () => {
    writeOptions({ library_dir: '/books' });
    expect(loadConfig().booksDir).toBe('/media/books');
  });

  it('falls back to /media/books when library_dir escapes /media', () => {
    writeOptions({ library_dir: '../escape' });
    expect(loadConfig().booksDir).toBe('/media/books');
  });

  it('falls back to /media/books when library_dir is empty', () => {
    writeOptions({ library_dir: '   ' });
    expect(loadConfig().booksDir).toBe('/media/books');
  });

  it('lets BOOKS_DIR env var override library_dir', () => {
    process.env.BOOKS_DIR = '/media/override';
    writeOptions({ library_dir: 'library/fiction' });
    expect(loadConfig().booksDir).toBe('/media/override');
  });
});
```

- [ ] **Step 3: Run the test to verify it fails**

Run: `npm test -w app/server -- config.test.ts`
Expected: FAIL — the custom-subpath and sanitization cases fail because `booksDir` is still hardcoded to `/media/books` (the default and env cases may pass, but `resolves a custom subpath under /media` will fail).

- [ ] **Step 4: Implement resolution in `app/server/config.ts`**

Add `library_dir` to the `Options` interface (after `library_name`):

```ts
interface Options {
  library_name: string;
  library_dir: string;
  username: string;
  password: string;
  max_concurrent_uploads: number;
  thumbnail_widths: number[];
}
```

Add the default in the `options` object literal (after `library_name`):

```ts
  let options: Options = {
    library_name: 'HASS-ODPS',
    library_dir: 'books',
    username: 'admin',
    password: 'changeme',
    max_concurrent_uploads: 3,
    thumbnail_widths: [88, 160],
  };
```

Add the parse line inside the reassignment block (after `library_name: parsed.library_name ?? options.library_name,`):

```ts
        library_dir: parsed.library_dir ?? options.library_dir,
```

Add the `resolveBooksDir` helper above `loadConfig` (below `const log = logger('Config');`):

```ts
const MEDIA_ROOT = '/media';

export function resolveBooksDir(libraryDir: string): string {
  const fallback = path.join(MEDIA_ROOT, 'books');
  const cleaned = libraryDir.trim().replace(/^\/+/, '');
  if (cleaned === '') {
    log.warn(`Empty library_dir, using ${fallback}`);
    return fallback;
  }
  const resolved = path.resolve(MEDIA_ROOT, cleaned);
  const rel = path.relative(MEDIA_ROOT, resolved);
  if (rel === '' || rel.startsWith('..') || path.isAbsolute(rel)) {
    log.warn(`library_dir "${libraryDir}" escapes ${MEDIA_ROOT}, using ${fallback}`);
    return fallback;
  }
  return resolved;
}
```

Change the `booksDir` line in the returned config from:

```ts
    booksDir: process.env.BOOKS_DIR ?? '/media/books',
```

to:

```ts
    booksDir: process.env.BOOKS_DIR ?? resolveBooksDir(options.library_dir),
```

- [ ] **Step 5: Run the test to verify it passes**

Run: `npm test -w app/server -- config.test.ts`
Expected: PASS (all 6 cases).

- [ ] **Step 6: Run lint**

Run: `npm run lint`
Expected: no errors.

- [ ] **Step 7: Commit**

```bash
git add config.yaml app/server/config.ts app/server/config.test.ts
git commit -m "feat: configurable library directory"
```

---

### Task 2: Changelog and version bump

**Files:**
- Modify: `CHANGELOG.md`
- Modify: `config.yaml` (version)
- Modify: `package.json` (version)

**Interfaces:**
- Consumes: nothing.
- Produces: nothing (metadata only).

- [ ] **Step 1: Add the CHANGELOG entry**

Insert a new section at the top of `CHANGELOG.md`, above `## 1.2.9`:

```markdown
## 1.2.10

- feat: configurable library directory
```

- [ ] **Step 2: Bump the version in `config.yaml`**

Change `version: "1.2.9"` to `version: "1.2.10"`.

- [ ] **Step 3: Bump the version in `package.json`**

Change `"version": "1.2.9"` to `"version": "1.2.10"`.

- [ ] **Step 4: Verify the versions match**

Run: `grep -R '1.2.10' config.yaml package.json CHANGELOG.md`
Expected: one match in each of the three files.

- [ ] **Step 5: Commit**

```bash
git add CHANGELOG.md config.yaml package.json
git commit -m "chore: bump version to 1.2.10"
```

---

## Self-Review

**Spec coverage:**
- New `library_dir` option in `config.yaml` (options + schema) → Task 1, Step 1. ✓
- Read + default `books` in `config.ts` → Task 1, Step 4. ✓
- `BOOKS_DIR` precedence → Task 1, Step 4 (`process.env.BOOKS_DIR ??`), test Step 2. ✓
- Sanitization (strip leading `/`, normalize, reject `..`/empty, fallback + warn) → `resolveBooksDir`, Task 1, Step 4; tests Step 2. ✓
- Always resolves inside `/media` → `resolveBooksDir` via `path.relative` guard. ✓
- Non-destructive on change (no file moves) → no code added; existing `index.ts` `mkdirSync(booksDir, {recursive:true})` handles empty new dir. No task needed. ✓
- Tests colocated in `config.test.ts` covering default/custom/traversal/empty/env → Task 1, Step 2. ✓
- CHANGELOG + version bump → Task 2. ✓
- Out of scope (in-app UI, auto-move, absolute paths) → not implemented. ✓

**Placeholder scan:** No TBD/TODO; all code shown in full. ✓

**Type consistency:** `resolveBooksDir(libraryDir: string): string` defined and called consistently; `Options.library_dir: string` used in interface, default, and parse. `config.booksDir` remains `string` per `AppConfig`. ✓
