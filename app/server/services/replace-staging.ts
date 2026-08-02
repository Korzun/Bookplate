import { randomUUID } from 'crypto';
import * as fs from 'fs';
import * as path from 'path';

/**
 * Filename prefix for every file this service writes into `stagingDir`,
 * distinct from the legacy `analyze-*`/`replace-*` throwaway tmp files
 * `routes/ui.ts`'s `/replace/analyze` and `/replace` write into the same
 * directory — so the directory-scan half of `sweep()` only ever touches
 * files this service owns, never a legacy route's in-flight tmp file.
 */
const STAGED_PREFIX = 'replace-staged-';

const DEFAULT_TTL_MS = 30 * 60 * 1000;

/**
 * `'epub'` is the original replace-staging design (bookAnalyzeReplace/
 * bookReplace). `'cover'` is Task 3b's generalization (bookUpdateMetadata's
 * `stagedCoverId`) — same registry, same TTL/eviction rules, same file, just
 * a second axis `findOwned` matches on. A staged entry's `kind` is fixed at
 * `stage()` time and is checked exactly like `userId`: a mismatch is folded
 * into the same indistinguishable `null`/`false` denial as unknown/expired/
 * foreign, not a distinct outcome — see `findOwned`'s doc comment. This is
 * what makes "a replace-staged EPUB used as `stagedCoverId`" fail exactly
 * like a foreign or expired id, rather than some third, more informative
 * shape a caller could use to fingerprint valid ids by kind.
 */
export type StagedKind = 'epub' | 'cover';

export type StagedFile = {
  readonly path: string;
  readonly originalName: string;
  /**
   * The uploaded MIME type, as multer reported it (`req.file.mimetype`).
   * `null` for `'epub'`-kind entries, which have never needed one — the
   * `stage()` callers on that path (`POST /api/books/replace-staging`) don't
   * pass one. `'cover'`-kind entries always carry one:
   * `bookUpdateMetadata`'s `stagedCoverId` branch needs it to populate
   * `EpubChanges.coverMime`, exactly as REST's multipart branch reads
   * `req.file.mimetype` for the same field.
   */
  readonly mimeType: string | null;
};

type StagedEntry = StagedFile & {
  readonly userId: string;
  readonly createdAt: number;
  readonly kind: StagedKind;
};

export type ReplaceStaging = {
  /**
   * Persists `bytes` under a fresh id, owned by `userId`, tagged `kind`.
   * Runs the lazy TTL sweep first. `kind` defaults to `'epub'` — every call
   * site that predates Task 3b (the replace-staging route, `bookAnalyzeReplace`,
   * `bookReplace`, and their tests) keeps compiling and behaving identically
   * without being touched; only the new cover-staging path passes `'cover'`
   * explicitly. `mimeType` defaults to `null` for the same reason.
   */
  stage: (
    bytes: Buffer,
    userId: string,
    originalName: string,
    kind?: StagedKind,
    mimeType?: string | null
  ) => string;
  /**
   * Reads back a staged file without consuming it. `null` for unknown,
   * expired, foreign, OR kind-mismatched (a `'cover'` lookup against an
   * `'epub'`-staged id, or vice versa) — see `StagedKind`'s doc comment for
   * why the mismatch case is folded into the same denial rather than
   * surfaced distinctly. `kind` defaults to `'epub'`, matching `stage()`'s
   * default and keeping every pre-3b call site unchanged.
   */
  resolve: (id: string, userId: string, kind?: StagedKind) => StagedFile | null;
  /**
   * Deletes a staged file (registry entry + disk file) and reports whether
   * there was one to delete. `true` on success, `false` for unknown,
   * expired, foreign, or kind-mismatched — in the `false` case the file (if
   * any, and if not the caller's) is left untouched. Deliberately not
   * `StagedFile`: by the time this returns, the path it would carry has
   * already been unlinked, so a caller that tried to read from it would get
   * ENOENT — callers that need the bytes/path must `resolve()` first, then
   * `consume()` once done (see `bookReplace`'s doc comment for why the two
   * calls are split that way). `kind` defaults to `'epub'`, same as `resolve`.
   */
  consume: (id: string, userId: string, kind?: StagedKind) => boolean;
};

export type ReplaceStagingDeps = {
  stagingDir: string;
  /** Default 30 minutes, matching the spec's "Replace staging" paragraph. */
  ttlMs?: number;
  /** Injectable clock, for tests only — production callers omit it. */
  now?: () => number;
};

/**
 * Fixed allowlist, `'cover'`-kind MIME type → on-disk extension. Every value
 * here is a literal, never derived from the input string — the map is keyed
 * on `mimeType`, but nothing in the returned extension is built FROM it, so
 * there is no substring of a hostile `mimeType` that can end up inside a
 * filename. Covers the MIME types `coverUpload`'s own `image/*` `fileFilter`
 * (`routes/ui.ts:128-134`) actually admits in practice; anything else
 * (unrecognised, or not even a real MIME string) falls back to `.bin` in
 * `extensionFor` below.
 */
const COVER_EXTENSIONS: Readonly<Record<string, string>> = {
  'image/png': '.png',
  'image/jpeg': '.jpg',
  'image/jpg': '.jpg',
  'image/gif': '.gif',
  'image/webp': '.webp',
  'image/svg+xml': '.svg',
  'image/bmp': '.bmp',
  'image/avif': '.avif',
  'image/heic': '.heic',
  'image/heif': '.heif',
  'image/tiff': '.tiff',
  'image/x-icon': '.ico',
};

/**
 * On-disk extension for a staged file. `'epub'` keeps the original fixed
 * `.epub` (unchanged from pre-3b behaviour — `sweep()`'s orphan scan matches
 * by `STAGED_PREFIX` alone, never by extension, so this was always cosmetic
 * for that path and stays that way).
 *
 * `'cover'` looks `mimeType` up in `COVER_EXTENSIONS` above and falls back to
 * `.bin` for anything not in that fixed set — review finding M-4: an earlier
 * version derived the extension directly from `mimeType`'s substring after
 * the `/` (e.g. `.split('/')[1]`), which is `req.file.mimetype`, i.e. the
 * `Content-Type` of a client-supplied multipart part, only checked for an
 * `image/` prefix (`routes/ui.ts:131-133`) — attacker-controlled beyond that.
 * `/` cannot appear in the derived substring (it's the split delimiter), so
 * traversal via `/` was never possible, but on Windows `\` is also a path
 * separator, and a hostile `Content-Type: image/..\..\evil` would have
 * produced a `path.join` argument containing `..\..`; an absurdly long
 * subtype also risked `ENAMETOOLONG` (a masked 500). The allowlist closes
 * both: every possible return value is one of the fixed literals above, so
 * neither the mimeType's length nor its characters can ever reach the
 * filename.
 */
function extensionFor(kind: StagedKind, mimeType: string | null): string {
  if (kind === 'epub') return '.epub';
  if (mimeType !== null && mimeType in COVER_EXTENSIONS) return COVER_EXTENSIONS[mimeType];
  return '.bin';
}

/**
 * The staged-upload half of the `bookAnalyzeReplace`/`bookReplace` design
 * (spec, §"Seams that stay REST" → "Replace staging"): `POST
 * /api/books/replace-staging` writes the uploaded EPUB here, keyed to the
 * *authenticated* caller (never a `?user=`/admin-named target — see that
 * route's doc comment), and hands back an opaque id. `bookAnalyzeReplace`
 * reads it via `resolve` (repeatable, non-destructive); `bookReplace` reads
 * it via `consume` (one-time, deletes on success) so a client uploads once
 * and can run both GraphQL steps against the same bytes, where REST uploaded
 * the file twice. Task 3b's `POST /api/books/cover-staging` writes into the
 * same registry, tagged `kind: 'cover'` — see `StagedKind`'s doc comment.
 *
 * Functional, not a class: `stage`/`resolve`/`consume` close over one
 * `Map<id, StagedEntry>` and the `stagingDir`/`ttlMs`/`now` this factory was
 * given, matching this file's "functional style, no classes" instruction —
 * `book-store.ts`'s methods are the only precedent for a class-shaped
 * service in this codebase, and it predates this instruction.
 *
 * Denial (`null`) is deliberately indistinguishable across "no such id",
 * "TTL-expired", "staged by a different user", AND (since Task 3b) "staged
 * as the other kind" — the same reasoning `node-scope.ts`'s `NO_MATCH_USER_ID`
 * doc comment gives for node lookups: confirming *which* of these is true
 * would leak information a denied caller has no business learning.
 *
 * TTL sweep is lazy (spec: "checked on each staging call", i.e. `stage()`,
 * never a timer): `sweep()` first drops any in-memory entry whose
 * `createdAt` has aged out (deleting its file too), then separately scans
 * `stagingDir` for `STAGED_PREFIX`-named files by `mtime` alone, with no
 * regard to the in-memory registry. That second pass is what "server-restart
 * orphans are handled by the same sweep" (spec) means: the registry is a
 * plain in-memory `Map`, empty again after every restart, so a file staged
 * by a now-dead process is unreachable via `resolve`/`consume` from the
 * moment the process restarts — but it is not immortal on disk, because the
 * directory scan finds and removes it once its `mtime` ages past `ttlMs`,
 * independent of whether any registry entry for it ever existed in this
 * process's lifetime.
 */
export function createReplaceStaging(deps: ReplaceStagingDeps): ReplaceStaging {
  const { stagingDir, ttlMs = DEFAULT_TTL_MS, now = Date.now } = deps;
  const entries = new Map<string, StagedEntry>();

  function unlinkQuiet(filePath: string): void {
    try {
      fs.unlinkSync(filePath);
    } catch {
      /* already gone — another sweep, another consume(), or never written */
    }
  }

  function sweep(): void {
    const cutoff = now() - ttlMs;

    for (const [id, entry] of entries) {
      if (entry.createdAt < cutoff) {
        unlinkQuiet(entry.path);
        entries.delete(id);
      }
    }

    let files: string[];
    try {
      files = fs.readdirSync(stagingDir);
    } catch {
      return; // directory doesn't exist yet — nothing to sweep
    }
    for (const file of files) {
      if (!file.startsWith(STAGED_PREFIX)) continue;
      const full = path.join(stagingDir, file);
      try {
        if (fs.statSync(full).mtimeMs < cutoff) unlinkQuiet(full);
      } catch {
        /* raced with a concurrent delete of the same file — fine */
      }
    }
  }

  function stage(
    bytes: Buffer,
    userId: string,
    originalName: string,
    kind: StagedKind = 'epub',
    mimeType: string | null = null
  ): string {
    sweep();
    fs.mkdirSync(stagingDir, { recursive: true });
    const id = randomUUID();
    const filePath = path.join(stagingDir, `${STAGED_PREFIX}${id}${extensionFor(kind, mimeType)}`);
    fs.writeFileSync(filePath, bytes);
    entries.set(id, { userId, path: filePath, originalName, mimeType, createdAt: now(), kind });
    return id;
  }

  /**
   * The single lookup both `resolve` and `consume` build on — id match, then
   * owner match, then age. Age-checked HERE, not only in `sweep()`: `sweep()`
   * runs exclusively from `stage()` (the spec's "checked on each staging
   * call"), so on a server where nobody stages a new file an expired entry
   * would otherwise stay fully resolvable/consumable indefinitely — reviewer
   * finding I-1, reproduced with a `now` past `ttlMs` and no intervening
   * `stage()` call. An expired entry found here is evicted immediately
   * (registry entry removed, file unlinked) rather than left for some future
   * sweep to find — the same cleanup `sweep()` itself would eventually do,
   * just not deferred.
   *
   * The boundary matches `sweep()`'s own comparison exactly (`createdAt <
   * cutoff` is expired, so `createdAt === cutoff` — exactly `ttlMs` old — is
   * NOT expired): one shared definition of "expired," not two that could
   * drift apart.
   *
   * `kind` is checked alongside `userId`, not after the age check: it is the
   * same kind of identity mismatch (wrong caller / wrong kind of upload),
   * folded into the identical `null` denial — see `StagedKind`'s doc comment.
   */
  function findOwned(id: string, userId: string, kind: StagedKind): StagedEntry | null {
    const entry = entries.get(id);
    if (entry === undefined || entry.userId !== userId || entry.kind !== kind) return null;
    if (entry.createdAt < now() - ttlMs) {
      entries.delete(id);
      unlinkQuiet(entry.path);
      return null;
    }
    return entry;
  }

  function resolve(id: string, userId: string, kind: StagedKind = 'epub'): StagedFile | null {
    const entry = findOwned(id, userId, kind);
    return entry === null
      ? null
      : { path: entry.path, originalName: entry.originalName, mimeType: entry.mimeType };
  }

  function consume(id: string, userId: string, kind: StagedKind = 'epub'): boolean {
    const entry = findOwned(id, userId, kind);
    if (entry === null) return false;
    // No `await` anywhere between the lookup above and the delete below —
    // `consume` is a single synchronous function, so two "concurrent" async
    // callers racing to finalize the same id can never interleave mid-call:
    // whichever one the event loop runs first completes entirely (registry
    // entry gone, file unlinked) before the other one's `entries.get` ever
    // runs, so the second call's `findOwned` genuinely finds nothing rather
    // than merely tolerating a double-delete.
    entries.delete(id);
    unlinkQuiet(entry.path);
    return true;
  }

  return { stage, resolve, consume };
}
