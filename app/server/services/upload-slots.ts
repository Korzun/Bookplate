import { randomBytes, randomUUID } from 'crypto';
import * as fs from 'fs';
import * as path from 'path';

/** Hard cap on a single link-uploaded EPUB. */
export const MAX_LINK_UPLOAD_BYTES = 50 * 1024 * 1024;

/**
 * How long a slot (and any file that landed in it) lives, measured from
 * `create`. Covers both "link never used" and "file arrived but the tool
 * never claimed it".
 */
export const UPLOAD_SLOT_TTL_MS = 15 * 60 * 1000;

export type UploadSlotLink = { uploadId: string; token: string; expiresAt: number };

export type ClaimedUpload = { path: string; size: number; filename: string | null };

/**
 * `missing` folds unknown id, another user's id, expired, and already-claimed
 * into one outcome, for the same reason `replace-staging` folds its denials:
 * telling them apart would let a caller probe for other users' upload ids.
 * `pending` covers both an open slot and one mid-receive (`beginReceive`
 * called, `completeReceive` not yet) — from the claimer's side the file simply
 * has not arrived.
 */
export type ClaimOutcome =
  | { kind: 'claimed'; file: ClaimedUpload }
  | { kind: 'missing' }
  | { kind: 'pending' };

export type UploadSlots = {
  create(userId: string, filename?: string | null): UploadSlotLink;
  /** Atomically moves an open slot to 'receiving'; null if token unknown/expired/not open. */
  beginReceive(token: string): { uploadId: string; destPath: string } | null;
  /** 'receiving' → 'filled'; false if the slot is no longer receiving (e.g. swept mid-PUT). */
  completeReceive(uploadId: string, size: number): boolean;
  /** 'receiving' → burned; deletes destPath if present. */
  failReceive(uploadId: string): void;
  /** 'filled' and owned by userId → removed from registry, file ownership passes to caller. */
  claim(uploadId: string, userId: string): ClaimOutcome;
  /** Removes expired slots and their files. Called lazily from every method. */
  sweep(): void;
};

type Entry = {
  readonly uploadId: string;
  readonly token: string;
  readonly userId: string;
  readonly filename: string | null;
  readonly expiresAt: number;
  readonly destPath: string;
  state: 'open' | 'receiving' | 'filled';
  size: number;
};

/**
 * In-memory registry behind the MCP one-time upload links: a tool mints a
 * slot (`create`), the client PUTs the EPUB to the unauthenticated link
 * carrying the secret `token`, and a later tool call `claim`s the file by
 * `uploadId` under its own authenticated user.
 *
 * Two identifiers on purpose: `token` is the bearer secret in the URL and
 * only ever resolves `beginReceive`; `uploadId` is what the model sees and
 * passes back, and only ever resolves `claim` (owner-checked). Neither can
 * stand in for the other, so a leaked uploadId cannot write a file and a
 * leaked URL cannot read one.
 *
 * Like `createReplaceStaging`, expiry is lazy (every method sweeps first, no
 * timer) and the registry is plain process memory — a restart forgets every
 * slot, and the 15-minute TTL bounds the damage. Unlike it there is no
 * directory scan: files here are named `mcp-link-<uploadId>.epub` and only
 * ever exist while a slot references them.
 */
export function createUploadSlots(deps: {
  stagingDir: string;
  ttlMs?: number;
  now?: () => number;
}): UploadSlots {
  const { stagingDir, ttlMs = UPLOAD_SLOT_TTL_MS, now = Date.now } = deps;
  const byId = new Map<string, Entry>();
  const idByToken = new Map<string, string>();

  function unlinkQuiet(filePath: string): void {
    try {
      fs.unlinkSync(filePath);
    } catch {
      /* never written, or already gone */
    }
  }

  // A restart forgets every slot, so any `mcp-link-*.epub` already on disk is
  // an orphan no slot will ever claim.
  try {
    for (const name of fs.readdirSync(stagingDir)) {
      if (/^mcp-link-.*\.epub$/.test(name)) unlinkQuiet(path.join(stagingDir, name));
    }
  } catch {
    /* staging dir does not exist yet */
  }

  function remove(entry: Entry): void {
    byId.delete(entry.uploadId);
    idByToken.delete(entry.token);
  }

  function sweep(): void {
    const t = now();
    for (const entry of byId.values()) {
      if (entry.expiresAt < t) {
        unlinkQuiet(entry.destPath);
        remove(entry);
      }
    }
  }

  function create(userId: string, filename: string | null = null): UploadSlotLink {
    sweep();
    const uploadId = randomUUID();
    // 32 random bytes → 43 base64url chars, no padding.
    const token = randomBytes(32).toString('base64url');
    const expiresAt = now() + ttlMs;
    const entry: Entry = {
      uploadId,
      token,
      userId,
      filename,
      expiresAt,
      destPath: path.join(stagingDir, `mcp-link-${uploadId}.epub`),
      state: 'open',
      size: 0,
    };
    byId.set(uploadId, entry);
    idByToken.set(token, uploadId);
    return { uploadId, token, expiresAt };
  }

  function beginReceive(token: string): { uploadId: string; destPath: string } | null {
    sweep();
    const uploadId = idByToken.get(token);
    const entry = uploadId === undefined ? undefined : byId.get(uploadId);
    if (entry === undefined || entry.state !== 'open') return null;
    // mkdir BEFORE the state change: if it throws, the slot stays open
    // instead of being stranded in 'receiving' with no one to finish it.
    fs.mkdirSync(stagingDir, { recursive: true });
    // Synchronous check-and-set: two racing PUTs cannot both pass.
    entry.state = 'receiving';
    return { uploadId: entry.uploadId, destPath: entry.destPath };
  }

  function completeReceive(uploadId: string, size: number): boolean {
    const entry = byId.get(uploadId);
    if (entry === undefined || entry.state !== 'receiving') return false;
    entry.state = 'filled';
    entry.size = size;
    return true;
  }

  function failReceive(uploadId: string): void {
    const entry = byId.get(uploadId);
    if (entry === undefined || entry.state !== 'receiving') return;
    unlinkQuiet(entry.destPath);
    remove(entry);
  }

  function claim(uploadId: string, userId: string): ClaimOutcome {
    sweep();
    const entry = byId.get(uploadId);
    if (entry === undefined || entry.userId !== userId) return { kind: 'missing' };
    if (entry.state !== 'filled') return { kind: 'pending' };
    remove(entry);
    return {
      kind: 'claimed',
      file: { path: entry.destPath, size: entry.size, filename: entry.filename },
    };
  }

  return { create, beginReceive, completeReceive, failReceive, claim, sweep };
}
