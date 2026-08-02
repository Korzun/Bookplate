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

export type StagedFile = {
  readonly path: string;
  readonly originalName: string;
};

type StagedEntry = StagedFile & {
  readonly userId: string;
  readonly createdAt: number;
};

export type ReplaceStaging = {
  /** Persists `bytes` under a fresh id, owned by `userId`. Runs the lazy TTL sweep first. */
  stage: (bytes: Buffer, userId: string, originalName: string) => string;
  /** Reads back a staged file without consuming it. `null` for unknown, expired, or foreign. */
  resolve: (id: string, userId: string) => StagedFile | null;
  /**
   * Deletes a staged file (registry entry + disk file) and reports whether
   * there was one to delete. `true` on success, `false` for unknown,
   * expired, or foreign — in the `false` case the file (if any, and if not
   * the caller's) is left untouched. Deliberately not `StagedFile`: by the
   * time this returns, the path it would carry has already been unlinked,
   * so a caller that tried to read from it would get ENOENT — callers that
   * need the bytes/path must `resolve()` first, then `consume()` once done
   * (see `bookReplace`'s doc comment for why the two calls are split that
   * way).
   */
  consume: (id: string, userId: string) => boolean;
};

export type ReplaceStagingDeps = {
  stagingDir: string;
  /** Default 30 minutes, matching the spec's "Replace staging" paragraph. */
  ttlMs?: number;
  /** Injectable clock, for tests only — production callers omit it. */
  now?: () => number;
};

/**
 * The staged-upload half of the `bookAnalyzeReplace`/`bookReplace` design
 * (spec, §"Seams that stay REST" → "Replace staging"): `POST
 * /api/books/replace-staging` writes the uploaded EPUB here, keyed to the
 * *authenticated* caller (never a `?user=`/admin-named target — see that
 * route's doc comment), and hands back an opaque id. `bookAnalyzeReplace`
 * reads it via `resolve` (repeatable, non-destructive); `bookReplace` reads
 * it via `consume` (one-time, deletes on success) so a client uploads once
 * and can run both GraphQL steps against the same bytes, where REST uploaded
 * the file twice.
 *
 * Functional, not a class: `stage`/`resolve`/`consume` close over one
 * `Map<id, StagedEntry>` and the `stagingDir`/`ttlMs`/`now` this factory was
 * given, matching this file's "functional style, no classes" instruction —
 * `book-store.ts`'s methods are the only precedent for a class-shaped
 * service in this codebase, and it predates this instruction.
 *
 * Denial (`null`) is deliberately indistinguishable across "no such id",
 * "TTL-expired", and "staged by a different user" — the same reasoning
 * `node-scope.ts`'s `NO_MATCH_USER_ID` doc comment gives for node lookups:
 * confirming *which* of the three is true would leak information a denied
 * caller has no business learning.
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

  function stage(bytes: Buffer, userId: string, originalName: string): string {
    sweep();
    fs.mkdirSync(stagingDir, { recursive: true });
    const id = randomUUID();
    const filePath = path.join(stagingDir, `${STAGED_PREFIX}${id}.epub`);
    fs.writeFileSync(filePath, bytes);
    entries.set(id, { userId, path: filePath, originalName, createdAt: now() });
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
   */
  function findOwned(id: string, userId: string): StagedEntry | null {
    const entry = entries.get(id);
    if (entry === undefined || entry.userId !== userId) return null;
    if (entry.createdAt < now() - ttlMs) {
      entries.delete(id);
      unlinkQuiet(entry.path);
      return null;
    }
    return entry;
  }

  function resolve(id: string, userId: string): StagedFile | null {
    const entry = findOwned(id, userId);
    return entry === null ? null : { path: entry.path, originalName: entry.originalName };
  }

  function consume(id: string, userId: string): boolean {
    const entry = findOwned(id, userId);
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
