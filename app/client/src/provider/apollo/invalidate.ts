import type { ApolloCache } from '@apollo/client';

/**
 * Cache invalidation shared by every mutation that changes what a book IS:
 * uploads, metadata edits, pending-fix ACCEPT/UNDO, file replacement,
 * chapter regeneration and deletion.
 *
 * Why one helper: each of those paths grew its own `update` block, and each
 * new one re-missed `Series.books`. That field is `relayStylePagination`,
 * whose `read` silently DROPS any edge whose node it cannot read — so once a
 * rotated `Book:<oldId>` is evicted, a cached series page reads back
 * COMPLETE but one book short, with no incomplete diff to trigger a refetch
 * (`page/series` is cache-first). Evicting the derived fields is the only
 * move that makes the next read miss.
 *
 * Every field below is DERIVED from book rows on the server, so none of them
 * can be patched from a mutation payload:
 *
 *   - `Library.entries` is sorted/filtered/paginated server-side; a changed
 *     title, author or series moves a row somewhere the payload cannot say.
 *     `series`, `subjects` and `authors` feed the edit form's autocomplete and
 *     the filter chips; `seriesNextIndex` and `searchSuggestions` are keyed
 *     by their arguments, and `fieldName`-only eviction drops every variant.
 *   - `Series.*` aggregates (`bookCount`, `totalPages`, …) and `books` are
 *     recomputed from members. The `Series` ENTITY is kept — `name` is what
 *     `Book.series.name` (the book page's series link) and `Library.series`
 *     read — only the derived fields go.
 *
 * `cache.gc()` runs last: evicting `Library.entries` is what unroots the
 * `Book` entities only the grid referenced.
 */
const LIBRARY_DERIVED_FIELDS = [
  'entries',
  'series',
  'subjects',
  'authors',
  'seriesNextIndex',
  'searchSuggestions',
] as const;

const SERIES_DERIVED_FIELDS = [
  'books',
  'bookCount',
  'totalPages',
  'totalSize',
  'progressPercentage',
  'overallRating',
  'subjects',
  'author',
  'publisher',
] as const;

export type BookChange = {
  /** The library whose derived fields go stale. Skipped when unknown. */
  libraryId: string | undefined;
  /** The id the client addressed the mutation with. */
  previousId?: string;
  /**
   * The id the server reports afterwards. Rewriting the EPUB changes its
   * content hash and therefore the global id, so this can differ from
   * `previousId`; `null` means the book was deleted. Either way the
   * `previousId` entity is evicted — normalization wrote the payload into a
   * brand-new entity and cannot know the old one described the same book.
   * Omit both for a change with no prior entity (an upload).
   */
  currentId?: string | null;
  /**
   * Series whose derived fields must be re-read: the book's series before
   * AND after the change, when known. Omitted (not empty) means "every
   * cached series" — the right call when the payload carries no series, as
   * after an upload, a pending-fix ACCEPT or a file replacement.
   */
  seriesIds?: ReadonlyArray<string | undefined>;
};

/** Ids of every normalized entity of `typename` currently in the cache. */
const cachedIds = (cache: ApolloCache, typename: string): string[] => {
  const prefix = `${typename}:`;
  return Object.keys(cache.extract() as Record<string, unknown>)
    .filter((key) => key.startsWith(prefix))
    .map((key) => key.slice(prefix.length));
};

const evictFields = (
  cache: ApolloCache,
  id: string | undefined,
  fields: ReadonlyArray<string>
): void => {
  if (id === undefined) return;
  for (const fieldName of fields) cache.evict({ id, fieldName });
};

export const invalidateBookChange = (cache: ApolloCache, change: BookChange): void => {
  if (change.libraryId !== undefined) {
    evictFields(
      cache,
      cache.identify({ __typename: 'Library', id: change.libraryId }),
      LIBRARY_DERIVED_FIELDS
    );
  }

  const seriesIds =
    change.seriesIds === undefined
      ? cachedIds(cache, 'Series')
      : [...new Set(change.seriesIds)].filter((id): id is string => id !== undefined);
  for (const id of seriesIds) {
    evictFields(cache, cache.identify({ __typename: 'Series', id }), SERIES_DERIVED_FIELDS);
  }

  if (change.previousId !== undefined && change.currentId !== change.previousId) {
    cache.evict({ id: cache.identify({ __typename: 'Book', id: change.previousId }) });
  }

  cache.gc();
};

/**
 * After reading progress changes (set, delete, link): `Series.progressPercentage`
 * is a server aggregate over the series' books, read by the grid's series row
 * and the series page. The progress payload carries no series, so every
 * cached series is invalidated; the field is cheap to re-read.
 */
export const invalidateSeriesProgress = (cache: ApolloCache): void => {
  for (const id of cachedIds(cache, 'Series')) {
    cache.evict({
      id: cache.identify({ __typename: 'Series', id }),
      fieldName: 'progressPercentage',
    });
  }
  cache.gc();
};

/**
 * After a book is rated: `Series.overallRating` is a server aggregate over the
 * series' RATED books (`loaders/series-rating.ts`), read by the grid's series
 * row. Unlike progress, the rating payload's book knows its series, so only
 * that one series is touched; a series the cache has never seen is a no-op.
 */
export const invalidateSeriesRating = (cache: ApolloCache, seriesId: string): void => {
  cache.evict({
    id: cache.identify({ __typename: 'Series', id: seriesId }),
    fieldName: 'overallRating',
  });
  cache.gc();
};

/**
 * `User.progressCount` (the My Progress badge) when a mutation's payload does
 * not carry it — linking a document merges two progress rows into one.
 */
export const invalidateUserProgressCounts = (cache: ApolloCache): void => {
  for (const id of cachedIds(cache, 'User')) {
    cache.evict({ id: cache.identify({ __typename: 'User', id }), fieldName: 'progressCount' });
  }
  cache.gc();
};

/**
 * The admin's request queue (`UserRequestList`) is `bookRequests(status:
 * PENDING)` — a server filter. Declining or fulfilling flips the row's
 * `status` by normalization but cannot remove its edge from a filtered
 * connection, so the queue is dropped and re-read. `User.bookRequests` is
 * one cache field regardless of arguments (`relayStylePagination()` with no
 * keyArgs), so a reader's own unfiltered list goes with it; that list is
 * refetched by its own page after every write it makes.
 */
export const invalidateRequestQueues = (cache: ApolloCache): void => {
  for (const id of cachedIds(cache, 'User')) {
    cache.evict({ id: cache.identify({ __typename: 'User', id }), fieldName: 'bookRequests' });
  }
  cache.gc();
};
