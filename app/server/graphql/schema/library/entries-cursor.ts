import type { PageCursor } from '../../../types';

/**
 * Runtime guard for a cursor decoded off the wire. `PageCursor` itself is
 * just a type — nothing stops `after` from being attacker- or
 * client-supplied garbage that happens to parse as JSON, so every field is
 * checked before the value is trusted as a `PageCursor`.
 */
const isPageCursor = (value: unknown): value is PageCursor =>
  typeof value === 'object' &&
  value !== null &&
  typeof (value as { k?: unknown }).k === 'string' &&
  ((value as { t?: unknown }).t === 's' || (value as { t?: unknown }).t === 'b') &&
  typeof (value as { id?: unknown }).id === 'string';

/**
 * Decodes `after` exactly the way `routes/ui.ts`'s `GET /api/books` decodes
 * its `cursor` query param — base64 JSON, malformed input degrading to `null`
 * (start of the list) rather than an error — so a cursor minted by one API
 * resumes at the same place on the other. The one addition over REST's `as
 * PageCursor` cast is the shape check above: REST hands a JSON-parsed-but-
 * unvalidated value straight to `listBooksPage`, this validates it first.
 * That only changes behaviour for a malformed cursor (falls back to `null`
 * either way in effect, since a shapeless cursor can't match any WHERE
 * clause), never for a well-formed one, so pagination parity is unaffected.
 */
export const decodeCursor = (after: string | null | undefined): PageCursor | null => {
  if (typeof after !== 'string' || after === '') return null;
  let parsed: unknown;
  try {
    parsed = JSON.parse(Buffer.from(after, 'base64').toString('utf-8'));
  } catch {
    return null;
  }
  return isPageCursor(parsed) ? parsed : null;
};

/** Mirrors `nextCursor`'s own encoding in `BookStore.listBooksPage` exactly, so a cursor this resolver mints for an interior edge is interchangeable with one the store mints for `endCursor`. */
export const encodeCursor = (cursor: PageCursor): string =>
  Buffer.from(JSON.stringify(cursor)).toString('base64');
