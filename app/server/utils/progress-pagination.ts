import { ProgressPageCursor } from '../types';

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

/** Parses the `take` query param, clamped to [1, 100], default 50. */
export function parseProgressTake(raw: unknown): number {
  if (typeof raw !== 'string') return 50;
  const n = parseInt(raw, 10);
  return isNaN(n) ? 50 : Math.min(Math.max(n, 1), 100);
}
