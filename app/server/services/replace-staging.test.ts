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
    expect(staging.consume('no-such-id', 'alice')).toBeNull();
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

    expect(asBob).toBeNull();
    expect(fs.existsSync(alicePath)).toBe(true);
    // Alice can still consume it afterwards — bob's denied attempt did not
    // burn her one-time use.
    expect(staging.consume(id, 'alice')).not.toBeNull();
  });

  it('consume deletes the file and unregisters the id — a second consume or resolve then returns null', () => {
    const staging = createReplaceStaging({ stagingDir });
    const id = staging.stage(Buffer.from('epub-bytes'), 'alice', 'book.epub');
    const filePath = staging.resolve(id, 'alice')!.path;

    const consumed = staging.consume(id, 'alice');

    expect(consumed?.path).toBe(filePath);
    expect(fs.existsSync(filePath)).toBe(false);
    expect(staging.resolve(id, 'alice')).toBeNull();
    expect(staging.consume(id, 'alice')).toBeNull();
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
});
