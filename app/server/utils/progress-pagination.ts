import { ProgressPageCursor } from '../types';

/** Default page size when none is asked for, and the bounds any request is clamped into. */
const DEFAULT_TAKE = 50;
const MIN_TAKE = 1;
const MAX_TAKE = 100;

/** Decodes the opaque base64 JSON cursor, or null if missing/malformed. */
export function decodeProgressCursor(raw: unknown): ProgressPageCursor | null {
  if (typeof raw !== 'string' || !raw) return null;
  try {
    const parsed = JSON.parse(Buffer.from(raw, 'base64').toString('utf-8')) as unknown;
    if (
      typeof parsed === 'object' &&
      parsed !== null &&
      typeof (parsed as ProgressPageCursor).timestamp === 'number' &&
      typeof (parsed as ProgressPageCursor).document === 'string'
    ) {
      return parsed as ProgressPageCursor;
    }
    return null;
  } catch {
    return null;
  }
}

/**
 * Encodes a progress page cursor. Mirrors `UserStore.getUserProgressPage`'s own
 * `nextCursor` encoding exactly, so a cursor minted here for an interior page
 * edge is interchangeable with one the store mints for the end of a page.
 * `getUserProgressPage` keeps producing its own — this is only for callers
 * that need a cursor per row rather than per page, i.e. GraphQL connection
 * edges.
 */
export function encodeProgressCursor(cursor: ProgressPageCursor): string {
  return Buffer.from(JSON.stringify(cursor)).toString('base64');
}

/** Clamps a requested page size to [1, 100], defaulting to 50 when absent or not a number. */
export function clampProgressTake(n: number | null | undefined): number {
  if (typeof n !== 'number' || isNaN(n)) return DEFAULT_TAKE;
  return Math.min(Math.max(n, MIN_TAKE), MAX_TAKE);
}

/** Parses the `take` query param, clamped to [1, 100], default 50. */
export function parseProgressTake(raw: unknown): number {
  if (typeof raw !== 'string') return DEFAULT_TAKE;
  return clampProgressTake(parseInt(raw, 10));
}
