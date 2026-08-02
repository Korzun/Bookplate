import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';

import { createReplaceStaging } from './replace-staging';

let stagingDir: string;

beforeEach(() => {
  stagingDir = fs.mkdtempSync(path.join(os.tmpdir(), 'replace-staging-'));
});

afterEach(() => {
  fs.rmSync(stagingDir, { recursive: true, force: true });
});

describe('createReplaceStaging', () => {
  it('stages bytes and resolves them back for the staging user, without deleting the file', () => {
    const staging = createReplaceStaging({ stagingDir });
    const id = staging.stage(Buffer.from('epub-bytes'), 'alice', 'book.epub');

    const resolved = staging.resolve(id, 'alice');

    expect(resolved).not.toBeNull();
    expect(resolved?.originalName).toBe('book.epub');
    expect(fs.readFileSync(resolved!.path)).toEqual(Buffer.from('epub-bytes'));
    // resolve() does not consume — a second resolve still finds it.
    expect(staging.resolve(id, 'alice')).not.toBeNull();
    expect(fs.existsSync(resolved!.path)).toBe(true);
  });

  it('returns null for an unknown stagedUploadId', () => {
    const staging = createReplaceStaging({ stagingDir });

    expect(staging.resolve('no-such-id', 'alice')).toBeNull();
    expect(staging.consume('no-such-id', 'alice')).toBe(false);
  });

  it('denies resolve to a user who did not stage the file (foreign), indistinguishably from unknown', () => {
    const staging = createReplaceStaging({ stagingDir });
    const id = staging.stage(Buffer.from('alice-bytes'), 'alice', 'book.epub');

    const asBob = staging.resolve(id, 'bob');

    expect(asBob).toBeNull();
    // The owning user can still resolve it — proves the denial is genuinely
    // about identity, not that the entry silently vanished.
    expect(staging.resolve(id, 'alice')).not.toBeNull();
  });

  it('denies consume to a foreign user and leaves the staged file untouched on disk', () => {
    const staging = createReplaceStaging({ stagingDir });
    const id = staging.stage(Buffer.from('alice-bytes'), 'alice', 'book.epub');
    const alicePath = staging.resolve(id, 'alice')!.path;

    const asBob = staging.consume(id, 'bob');

    expect(asBob).toBe(false);
    expect(fs.existsSync(alicePath)).toBe(true);
    // Alice can still consume it afterwards — bob's denied attempt did not
    // burn her one-time use.
    expect(staging.consume(id, 'alice')).toBe(true);
  });

  it('consume deletes the file and unregisters the id — a second consume or resolve then returns null', () => {
    const staging = createReplaceStaging({ stagingDir });
    const id = staging.stage(Buffer.from('epub-bytes'), 'alice', 'book.epub');
    const filePath = staging.resolve(id, 'alice')!.path;

    const consumed = staging.consume(id, 'alice');

    expect(consumed).toBe(true);
    expect(fs.existsSync(filePath)).toBe(false);
    expect(staging.resolve(id, 'alice')).toBeNull();
    expect(staging.consume(id, 'alice')).toBe(false);
  });

  it('a second concurrent consume of the same id is denied — consume is atomic, not merely non-throwing', () => {
    // Simulates two in-flight bookReplace calls racing to finalize the same
    // stagedUploadId: whichever consume() runs first wins; the second must
    // see the entry already gone, not double-succeed. `consume` has no
    // internal `await`, so two synchronous calls (even from two "concurrent"
    // async callers) can never interleave mid-function — the second call's
    // `entries.get` always observes the first call's `entries.delete`.
    const staging = createReplaceStaging({ stagingDir });
    const id = staging.stage(Buffer.from('epub-bytes'), 'alice', 'book.epub');

    const first = staging.consume(id, 'alice');
    const second = staging.consume(id, 'alice');

    expect(first).toBe(true);
    expect(second).toBe(false);
  });

  it('resolve and consume deny an entry past its TTL even with no intervening stage() call', () => {
    // Regression for the gap sweep()-only enforcement left: `sweep()` only
    // runs from `stage()`, so on a server where nobody stages a new file, a
    // long-expired entry stayed fully resolvable and consumable forever.
    let now = 0;
    const staging = createReplaceStaging({ stagingDir, ttlMs: 1000, now: () => now });
    const id = staging.stage(Buffer.from('old'), 'alice', 'old.epub');
    const filePath = staging.resolve(id, 'alice')!.path;

    now = 999_999_999; // far past TTL — no stage() call in between

    expect(staging.resolve(id, 'alice')).toBeNull();
    expect(staging.consume(id, 'alice')).toBe(false);
    // Evicted as a side effect of being read past its TTL, not left to leak
    // until some future stage() call's sweep happens to find it.
    expect(fs.existsSync(filePath)).toBe(false);
  });

  it('pins the TTL boundary: exactly-ttlMs-old still resolves, one unit older does not', () => {
    let now = 0;
    const staging = createReplaceStaging({ stagingDir, ttlMs: 1000, now: () => now });
    const id = staging.stage(Buffer.from('boundary'), 'alice', 'boundary.epub');

    now = 1000; // age === ttlMs exactly
    expect(staging.resolve(id, 'alice')).not.toBeNull();

    now = 1001; // one unit past
    expect(staging.resolve(id, 'alice')).toBeNull();
  });

  it('sweeps an expired entry on the next stage() call: resolve returns null and the file is removed', () => {
    let now = 0;
    const staging = createReplaceStaging({ stagingDir, ttlMs: 1000, now: () => now });
    const oldId = staging.stage(Buffer.from('old'), 'alice', 'old.epub');
    const oldPath = staging.resolve(oldId, 'alice')!.path;

    now = 2000; // past the 1000ms TTL
    // Sweep runs at the top of stage(), not on a timer — triggering it here
    // is the documented mechanism, not an implementation detail being tested.
    staging.stage(Buffer.from('new'), 'alice', 'new.epub');

    expect(staging.resolve(oldId, 'alice')).toBeNull();
    expect(fs.existsSync(oldPath)).toBe(false);
  });

  it('does not sweep an entry that is still within the TTL window', () => {
    let now = 0;
    const staging = createReplaceStaging({ stagingDir, ttlMs: 1000, now: () => now });
    const id = staging.stage(Buffer.from('fresh'), 'alice', 'fresh.epub');

    now = 500; // inside the 1000ms TTL
    staging.stage(Buffer.from('other'), 'alice', 'other.epub');

    expect(staging.resolve(id, 'alice')).not.toBeNull();
  });

  it('sweeps an orphaned staged file left by a prior process, by file mtime alone (no registry entry)', () => {
    // Simulates a server restart: the in-memory registry is empty (fresh
    // service instance), but a previously staged file is still on disk. The
    // sweep must find and remove it by scanning the directory itself, not by
    // consulting the (necessarily empty) registry.
    const orphanPath = path.join(stagingDir, 'replace-staged-orphan-from-prior-process.epub');
    fs.writeFileSync(orphanPath, 'orphan');
    const oldMtime = new Date(Date.now() - 2000);
    fs.utimesSync(orphanPath, oldMtime, oldMtime);

    let now = Date.now();
    const staging = createReplaceStaging({ stagingDir, ttlMs: 1000, now: () => now });
    staging.stage(Buffer.from('new'), 'alice', 'new.epub');

    expect(fs.existsSync(orphanPath)).toBe(false);
  });

  it('does not sweep an unrelated file in the staging directory (no matching prefix)', () => {
    const unrelated = path.join(stagingDir, 'analyze-some-other-tmp-file.epub');
    fs.writeFileSync(unrelated, 'unrelated');
    const oldMtime = new Date(Date.now() - 2000);
    fs.utimesSync(unrelated, oldMtime, oldMtime);

    const staging = createReplaceStaging({ stagingDir, ttlMs: 1000 });
    staging.stage(Buffer.from('new'), 'alice', 'new.epub');

    expect(fs.existsSync(unrelated)).toBe(true);
  });

  describe('kind (Task 3b: generalized to cover uploads)', () => {
    it('defaults stage/resolve/consume to "epub", so every pre-3b call site keeps behaving identically', () => {
      const staging = createReplaceStaging({ stagingDir });
      const id = staging.stage(Buffer.from('epub-bytes'), 'alice', 'book.epub');

      const resolved = staging.resolve(id, 'alice');

      expect(resolved).not.toBeNull();
      expect(resolved?.mimeType).toBeNull();
      expect(staging.consume(id, 'alice')).toBe(true);
    });

    it('stages a "cover" entry and resolves it back with its mimeType, only under the "cover" kind', () => {
      const staging = createReplaceStaging({ stagingDir });
      const id = staging.stage(
        Buffer.from('png-bytes'),
        'alice',
        'cover.png',
        'cover',
        'image/png'
      );

      const resolved = staging.resolve(id, 'alice', 'cover');

      expect(resolved).not.toBeNull();
      expect(resolved?.originalName).toBe('cover.png');
      expect(resolved?.mimeType).toBe('image/png');
      expect(fs.readFileSync(resolved!.path)).toEqual(Buffer.from('png-bytes'));
    });

    it('denies resolve/consume of a "cover"-staged entry under the "epub" kind, indistinguishably from unknown', () => {
      const staging = createReplaceStaging({ stagingDir });
      const id = staging.stage(
        Buffer.from('png-bytes'),
        'alice',
        'cover.png',
        'cover',
        'image/png'
      );

      expect(staging.resolve(id, 'alice', 'epub')).toBeNull();
      expect(staging.consume(id, 'alice', 'epub')).toBe(false);
      // The right kind still works — proves the denial is genuinely about
      // kind, not that the entry silently vanished.
      expect(staging.resolve(id, 'alice', 'cover')).not.toBeNull();
    });

    it('denies resolve/consume of an "epub"-staged entry under the "cover" kind, indistinguishably from unknown', () => {
      const staging = createReplaceStaging({ stagingDir });
      const id = staging.stage(Buffer.from('epub-bytes'), 'alice', 'book.epub', 'epub');

      expect(staging.resolve(id, 'alice', 'cover')).toBeNull();
      expect(staging.consume(id, 'alice', 'cover')).toBe(false);
      expect(staging.resolve(id, 'alice', 'epub')).not.toBeNull();
    });

    it('keeps "epub" and "cover" entries independently staged, resolved, and consumed under the same shared registry', () => {
      const staging = createReplaceStaging({ stagingDir });
      const epubId = staging.stage(Buffer.from('epub-bytes'), 'alice', 'book.epub', 'epub');
      const coverId = staging.stage(
        Buffer.from('cover-bytes'),
        'alice',
        'cover.png',
        'cover',
        'image/png'
      );

      expect(staging.consume(coverId, 'alice', 'cover')).toBe(true);
      // Consuming the cover entry did not disturb the unrelated epub entry.
      expect(staging.resolve(epubId, 'alice', 'epub')).not.toBeNull();
      expect(staging.resolve(coverId, 'alice', 'cover')).toBeNull();
    });
  });
});
