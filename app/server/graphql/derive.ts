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

import type { MetadataFix, PendingFixState, UndoSnapshot } from '../types';
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

const EMPTY_PENDING_FIX_STATE: PendingFixState = {
  autoFixes: [],
  appliedFixes: [],
  proposals: [],
  undo: null,
};

const isChangesRecord = (value: unknown): value is MetadataFix['changes'] =>
  typeof value === 'object' &&
  value !== null &&
  !Array.isArray(value) &&
  Object.values(value).every(
    (entry) =>
      typeof entry === 'string' ||
      (Array.isArray(entry) && entry.every((item): item is string => typeof item === 'string'))
  );

const isStringArray = (value: unknown): value is string[] =>
  Array.isArray(value) && value.every((item): item is string => typeof item === 'string');

/**
 * `field`/`kind`/`from` are the only members whose absence makes an entry
 * unusable as a `MetadataFix` (they are non-null in the GraphQL type); every
 * other member is defaulted below rather than used to reject the entry.
 */
const isMetadataFixCandidate = (value: unknown): value is Record<string, unknown> => {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) return false;
  const v = value as Record<string, unknown>;
  return typeof v.field === 'string' && typeof v.kind === 'string' && typeof v.from === 'string';
};

const toMetadataFix = (v: Record<string, unknown>): MetadataFix => {
  const fix: MetadataFix = {
    field: v.field as string,
    kind: v.kind as string,
    from: v.from as string,
    to: typeof v.to === 'string' ? v.to : null,
    changes: isChangesRecord(v.changes) ? v.changes : {},
  };
  if (typeof v.reason === 'string') fix.reason = v.reason;
  if (isStringArray(v.fromChips)) fix.fromChips = v.fromChips;
  if (isStringArray(v.toChips)) fix.toChips = v.toChips;
  return fix;
};

const parseMetadataFixArray = (value: unknown): MetadataFix[] =>
  Array.isArray(value) ? value.filter(isMetadataFixCandidate).map(toMetadataFix) : [];

const isUndoKind = (value: unknown): value is UndoSnapshot['kind'] =>
  value === 'apply' || value === 'dismiss';

const parseUndoSnapshot = (value: unknown): UndoSnapshot | null => {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) return null;
  const v = value as Record<string, unknown>;
  if (!isUndoKind(v.kind)) return null;
  return {
    kind: v.kind,
    proposals: parseMetadataFixArray(v.proposals),
    appliedFixes: parseMetadataFixArray(v.appliedFixes),
  };
};

/**
 * Parses `PendingFix.state` (and `PendingFixDto`'s reconstructed JSON) into
 * the typed `PendingFixState` shape both GraphQL readings serve. Total like
 * every other parser in this module: malformed JSON, a non-object top level
 * (including the JSON literal `null` or a top-level array), and missing keys
 * all degrade to the empty state — mirroring the store's own
 * `state.autoFixes ?? []` defaulting in `getPendingFixes` (book-store.ts) —
 * rather than throwing.
 */
export const parsePendingFixState = (json: string): PendingFixState => {
  const parsed = parseJson(json);
  if (typeof parsed !== 'object' || parsed === null || Array.isArray(parsed)) {
    return EMPTY_PENDING_FIX_STATE;
  }
  const v = parsed as Record<string, unknown>;
  return {
    autoFixes: parseMetadataFixArray(v.autoFixes),
    appliedFixes: parseMetadataFixArray(v.appliedFixes),
    proposals: parseMetadataFixArray(v.proposals),
    undo: parseUndoSnapshot(v.undo),
  };
};

/**
 * 7 days, mirrored from `book-store.ts:31`'s `PENDING_FIX_TTL_MS`. Not
 * imported from there: the store constant is a private module-level `const`,
 * and this predicate is meant to be the shared *decision*, not a dependency
 * on the store module from the GraphQL read path.
 */
const PENDING_FIX_TTL_MS = 7 * 24 * 60 * 60 * 1000;

/**
 * Whether a `PendingFix` row should still be visible, mirrored exactly from
 * the keep/drop decision inside `BookStore.getPendingFixes`
 * (`book-store.ts:699-705`): live unless (no proposals and no undo) — the fix
 * is fully resolved — or (no proposals, an undo snapshot present, and
 * `updatedAt` older than the 7-day TTL) — the undo-only tail has expired.
 *
 * A row whose `state` column failed to parse lands here as
 * `EMPTY_PENDING_FIX_STATE` (`parsePendingFixState`'s total fallback), which
 * has no proposals and no undo — the first clause classifies it not-live,
 * matching the store's own delete-on-parse-failure without this predicate
 * needing to know about parsing at all.
 *
 * `now` is a parameter, not `Date.now()` read internally, so this stays a
 * pure function — the TTL-boundary tests in `derive.test.ts` pin an exact
 * `now` rather than racing the clock.
 */
export const isLivePendingFix = (
  state: PendingFixState,
  updatedAt: number,
  now: number
): boolean => {
  const noProposals = state.proposals.length === 0;
  const noUndo = state.undo === null;
  if (noProposals && noUndo) return false;
  const expiredUndo = noProposals && !noUndo && updatedAt < now - PENDING_FIX_TTL_MS;
  return !expiredUndo;
};
