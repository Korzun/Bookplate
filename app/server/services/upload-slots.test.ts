import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';

import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { createUploadSlots, UPLOAD_SLOT_TTL_MS } from './upload-slots';

describe('upload slots', () => {
  let dir: string;
  let clock: number;
  const now = () => clock;
  const make = () => createUploadSlots({ stagingDir: dir, now });

  beforeEach(() => {
    dir = fs.mkdtempSync(path.join(os.tmpdir(), 'upload-slots-'));
    clock = 1_000_000;
  });
  afterEach(() => {
    fs.rmSync(dir, { recursive: true, force: true });
  });

  function fill(slots: ReturnType<typeof make>, userId: string) {
    const link = slots.create(userId, 'book.epub');
    const recv = slots.beginReceive(link.token);
    if (recv === null) throw new Error('beginReceive failed');
    fs.writeFileSync(recv.destPath, 'bytes');
    slots.completeReceive(link.uploadId, 5);
    return { link, destPath: recv.destPath };
  }

  it('create returns distinct uploadId and a 43-char base64url token', () => {
    const slots = make();
    const a = slots.create('u1');
    const b = slots.create('u1');
    expect(a.uploadId).not.toBe(b.uploadId);
    expect(a.token).toMatch(/^[A-Za-z0-9_-]{43}$/);
    expect(a.token).not.toBe(a.uploadId);
    expect(a.expiresAt).toBe(clock + 15 * 60 * 1000);
    expect(UPLOAD_SLOT_TTL_MS).toBe(15 * 60 * 1000);
  });

  it('beginReceive works once per token', () => {
    const slots = make();
    const { token, uploadId } = slots.create('u1');
    const first = slots.beginReceive(token);
    expect(first?.uploadId).toBe(uploadId);
    expect(first?.destPath).toBe(path.join(dir, `mcp-link-${uploadId}.epub`));
    expect(slots.beginReceive(token)).toBeNull();
  });

  it('claim before completeReceive is pending', () => {
    const slots = make();
    const { token, uploadId } = slots.create('u1', 'x.epub');
    expect(slots.claim(uploadId, 'u1')).toEqual({ kind: 'pending' });
    const recv = slots.beginReceive(token)!;
    expect(slots.claim(uploadId, 'u1')).toEqual({ kind: 'pending' });
    fs.writeFileSync(recv.destPath, 'abc');
    slots.completeReceive(uploadId, 3);
    expect(slots.claim(uploadId, 'u1')).toEqual({
      kind: 'claimed',
      file: { path: recv.destPath, size: 3, filename: 'x.epub' },
    });
  });

  it('claim by another user is missing, and the owner can still claim afterwards', () => {
    const slots = make();
    const { link } = fill(slots, 'u1');
    expect(slots.claim(link.uploadId, 'u2')).toEqual({ kind: 'missing' });
    expect(slots.claim(link.uploadId, 'u1').kind).toBe('claimed');
  });

  it('claim is single-use', () => {
    const slots = make();
    const { link } = fill(slots, 'u1');
    expect(slots.claim(link.uploadId, 'u1').kind).toBe('claimed');
    expect(slots.claim(link.uploadId, 'u1')).toEqual({ kind: 'missing' });
  });

  it('expired slots are missing and their files deleted', () => {
    const slots = make();
    const open = slots.create('u1');
    const { link, destPath } = fill(slots, 'u1');
    clock += UPLOAD_SLOT_TTL_MS + 1;
    expect(slots.beginReceive(open.token)).toBeNull();
    expect(slots.claim(link.uploadId, 'u1')).toEqual({ kind: 'missing' });
    expect(fs.existsSync(destPath)).toBe(false);
  });

  it('failReceive deletes the partial file and burns the token', () => {
    const slots = make();
    const link = slots.create('u1');
    const recv = slots.beginReceive(link.token)!;
    fs.writeFileSync(recv.destPath, 'partial');
    slots.failReceive(link.uploadId);
    expect(fs.existsSync(recv.destPath)).toBe(false);
    expect(slots.beginReceive(link.token)).toBeNull();
    expect(slots.claim(link.uploadId, 'u1')).toEqual({ kind: 'missing' });
  });
});
