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
  return Array.isArray(parsed) ? parsed.filter(isIdentifier) : [];
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
