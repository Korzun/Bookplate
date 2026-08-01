/**
 * Pure derivations over the columns SQLite stores as JSON strings.
 *
 * These are shared deliberately: the GraphQL read path reads Prisma rows
 * directly while OPDS reads through BookStore, and both must agree on what a
 * row means. Keeping the interpretation in one pure module is what stops the
 * two paths drifting.
 *
 * Every parser is total — malformed JSON degrades to an empty value rather
 * than throwing, so one bad row cannot fail an entire query.
 */

import { parseCfiSpineIndex, spineIndexToChapter } from '../utils/cfi';

const parseJson = (json: string): unknown => {
  try {
    return JSON.parse(json);
  } catch {
    return null;
  }
};

export type Identifier = { scheme: string; value: string };

const isIdentifier = (value: unknown): value is Identifier =>
  typeof value === 'object' &&
  value !== null &&
  typeof (value as { scheme?: unknown }).scheme === 'string' &&
  typeof (value as { value?: unknown }).value === 'string';

export const parseIdentifiers = (json: string): Identifier[] => {
  const parsed = parseJson(json);
  return Array.isArray(parsed)
    ? parsed.filter(isIdentifier).map(({ scheme, value }) => ({ scheme, value }))
    : [];
};

export const parseStringArray = (json: string): string[] => {
  const parsed = parseJson(json);
  return Array.isArray(parsed) ? parsed.filter((v): v is string => typeof v === 'string') : [];
};

export const parseNumberArray = (json: string): number[] => {
  const parsed = parseJson(json);
  return Array.isArray(parsed)
    ? parsed.filter((v): v is number => typeof v === 'number' && Number.isFinite(v))
    : [];
};

export const parseNullableStringArray = (json: string | null): string[] | null =>
  json === null ? null : parseStringArray(json);

/** `mtime` and `addedAt` are stored as Float epoch milliseconds. */
export const epochToDate = (ms: number): Date => new Date(ms);

/**
 * `Progress.timestamp` is the one epoch column stored in **seconds**, not
 * milliseconds — KOReader's sync protocol writes it that way through
 * `routes/kosync.ts`, and the column is `Int` rather than `Float` for exactly
 * that reason (see `prisma/schema.prisma`).
 *
 * A separate function from `epochToDate` on purpose: passing seconds to a
 * function documented as taking milliseconds lands every reading in January
 * 1970, and the two are indistinguishable at the call site because both are
 * bare numbers. Reach for this one only for `Progress.timestamp`.
 */
export const epochSecondsToDate = (seconds: number): Date => new Date(seconds * 1000);

/**
 * Which 1-based chapter a reading position falls in, or null when it cannot
 * be determined (no spine map, or a `progress` string that is not an EPUB CFI
 * — KOReader also writes its own `/body/DocFragment[...]` form, which carries
 * no spine index).
 *
 * This is the derivation `GET /api/my/progress` performs inline in its route
 * handler (`routes/ui.ts`), lifted out so the GraphQL and REST readings of the
 * same two columns cannot drift — the same reason this module exists for the
 * JSON-string columns. The three branches are REST's, in REST's order:
 * an absent or empty spine map yields nothing, a non-CFI `progress` yields
 * nothing, and `spineIndexToChapter` is the only thing that decides the rest.
 * REST's handler is deliberately left as it is (this migration does not touch
 * `routes/`); it can adopt this function whenever it is next edited.
 */
export const deriveCurrentChapter = (
  progressCfi: string,
  chapterSpineMap: number[] | undefined
): number | null => {
  if (chapterSpineMap === undefined || chapterSpineMap.length === 0) return null;
  const spineIndex = parseCfiSpineIndex(progressCfi);
  if (spineIndex === null) return null;
  return spineIndexToChapter(spineIndex, chapterSpineMap);
};
