import { gql, InMemoryCache, type NormalizedCacheObject } from '@apollo/client';
import { describe, expect, it } from 'vitest';

import { SeriesBookRowFragment } from '~/component/book-row/from-series-book';
import { makeFragmentData } from '~/gql';
import { UserRequestListDocument } from '~/graphql/book-request';
import { LibrarySubjectsDocument, SeriesNamesDocument } from '~/graphql/library';
import { MyProgressCountDocument } from '~/graphql/progress';
import { BookChaptersDocument } from '~/page/book/query';
import { LibraryEntriesDocument } from '~/page/library';
import { SeriesDetailDocument } from '~/page/series';

import { cacheConfig } from './cache';
import {
  invalidateBookChange,
  invalidateRequestQueues,
  invalidateSeriesProgress,
  invalidateSeriesRating,
  invalidateUserProgressCounts,
} from './invalidate';

const LIBRARY_ID = 'LIB-1';
const BOOK_ID = 'BOOK-1';
const NEW_BOOK_ID = 'BOOK-2';
const SERIES_A = 'SERIES-A';
const SERIES_B = 'SERIES-B';
const USER_ID = 'USER-1';

const entriesVariables = { libraryId: LIBRARY_ID, first: 20, filter: {} };

const seedEntries = (cache: InMemoryCache) =>
  cache.writeQuery({
    query: LibraryEntriesDocument,
    variables: entriesVariables,
    data: {
      __typename: 'Query',
      node: {
        __typename: 'Library',
        id: LIBRARY_ID,
        entries: {
          __typename: 'LibraryEntriesConnection',
          edges: [],
          pageInfo: { __typename: 'PageInfo', hasNextPage: false, endCursor: null },
        },
      },
    },
  });

const seedSeriesNames = (cache: InMemoryCache) =>
  cache.writeQuery({
    query: SeriesNamesDocument,
    variables: { libraryId: LIBRARY_ID },
    data: {
      __typename: 'Query',
      node: {
        __typename: 'Library',
        id: LIBRARY_ID,
        series: [{ __typename: 'Series', id: SERIES_A, name: 'Dune' }],
      },
    },
  });

const seedSubjects = (cache: InMemoryCache) =>
  cache.writeQuery({
    query: LibrarySubjectsDocument,
    variables: { libraryId: LIBRARY_ID },
    data: {
      __typename: 'Query',
      node: { __typename: 'Library', id: LIBRARY_ID, subjects: ['Fantasy'] },
    },
  });

const seedSeriesDetail = (cache: InMemoryCache, seriesId: string, name: string, bookId: string) =>
  cache.writeQuery({
    query: SeriesDetailDocument,
    variables: { libraryId: LIBRARY_ID, name },
    data: {
      __typename: 'Query',
      node: {
        __typename: 'Library',
        id: LIBRARY_ID,
        seriesByName: {
          __typename: 'Series',
          id: seriesId,
          name,
          author: 'Herbert',
          publisher: '',
          totalPages: 10,
          totalSize: 10,
          subjects: [],
          progressPercentage: 0.5,
          overallRating: null,
          books: {
            __typename: 'SeriesBooksConnection',
            edges: [
              {
                __typename: 'SeriesBooksConnectionEdge',
                node: {
                  __typename: 'Book' as const,
                  id: bookId,
                  ...makeFragmentData(
                    {
                      __typename: 'Book' as const,
                      id: bookId,
                      title: 'Dune',
                      seriesIndex: 1,
                      hasCover: false,
                      thumbnailUrl: '/t.jpg',
                      progress: null,
                      rating: { __typename: 'BookRating' as const, overall: null },
                    },
                    SeriesBookRowFragment
                  ),
                },
              },
            ],
          },
        },
      },
    },
  });

/** Roots the Book under `Library.book(id:)`, as any book-page visit does. */
const seedBookDetail = (cache: InMemoryCache, bookId: string) =>
  cache.writeQuery({
    query: BookChaptersDocument,
    variables: { libraryId: LIBRARY_ID, bookId },
    data: {
      __typename: 'Query',
      node: {
        __typename: 'Library',
        id: LIBRARY_ID,
        book: { __typename: 'Book', id: bookId, chapterNames: [], chapterSpineMap: [] },
      },
    },
  });

const readSeriesDetail = (cache: InMemoryCache, name: string) =>
  cache.readQuery({ query: SeriesDetailDocument, variables: { libraryId: LIBRARY_ID, name } });

const readEntries = (cache: InMemoryCache) =>
  cache.readQuery({ query: LibraryEntriesDocument, variables: entriesVariables });

const readSeriesNames = (cache: InMemoryCache) =>
  cache.readQuery({ query: SeriesNamesDocument, variables: { libraryId: LIBRARY_ID } });

const readSubjects = (cache: InMemoryCache) =>
  cache.readQuery({ query: LibrarySubjectsDocument, variables: { libraryId: LIBRARY_ID } });

const entityKeys = (cache: InMemoryCache) => Object.keys(cache.extract() as NormalizedCacheObject);

const seriesEntity = (cache: InMemoryCache, id: string) =>
  (cache.extract() as NormalizedCacheObject)[`Series:${id}`] as Record<string, unknown>;

/** The grid row's aggregate, as a visit to the library would have cached it. */
const seedSeriesRating = (cache: InMemoryCache, id: string, overallRating: number) =>
  cache.writeFragment({
    id: cache.identify({ __typename: 'Series', id }),
    fragment: gql`
      fragment SeriesRatingSeed on Series {
        id
        overallRating
      }
    `,
    data: { __typename: 'Series', id, overallRating },
  });

describe('invalidateBookChange', () => {
  it('evicts every library field derived from book metadata', () => {
    const cache = new InMemoryCache(cacheConfig);
    seedEntries(cache);
    seedSeriesNames(cache);
    seedSubjects(cache);

    invalidateBookChange(cache, { libraryId: LIBRARY_ID, previousId: BOOK_ID, currentId: BOOK_ID });

    expect(readEntries(cache)).toBeNull();
    expect(readSeriesNames(cache)).toBeNull();
    expect(readSubjects(cache)).toBeNull();
  });

  it('evicts the derived fields of the named series only, keeping the Series entity and its name', () => {
    const cache = new InMemoryCache(cacheConfig);
    seedSeriesDetail(cache, SERIES_A, 'Dune', BOOK_ID);
    seedSeriesDetail(cache, SERIES_B, 'Emma', 'BOOK-9');

    invalidateBookChange(cache, {
      libraryId: undefined,
      previousId: BOOK_ID,
      currentId: BOOK_ID,
      seriesIds: [SERIES_A, undefined],
    });

    expect(readSeriesDetail(cache, 'Dune')).toBeNull();
    expect(readSeriesDetail(cache, 'Emma')).not.toBeNull();
    expect(seriesEntity(cache, SERIES_A)).toMatchObject({ name: 'Dune' });
    // Every `books(...)` variant goes: an evict by field name alone covers all
    // of a keyed field's argument variants.
    expect(Object.keys(seriesEntity(cache, SERIES_A)).some((key) => key.startsWith('books'))).toBe(
      false
    );
    expect(seriesEntity(cache, SERIES_A)).not.toHaveProperty('progressPercentage');
  });

  it('evicts the derived fields of every cached series when none are named', () => {
    const cache = new InMemoryCache(cacheConfig);
    seedSeriesDetail(cache, SERIES_A, 'Dune', BOOK_ID);
    seedSeriesDetail(cache, SERIES_B, 'Emma', 'BOOK-9');

    invalidateBookChange(cache, { libraryId: LIBRARY_ID });

    expect(readSeriesDetail(cache, 'Dune')).toBeNull();
    expect(readSeriesDetail(cache, 'Emma')).toBeNull();
  });

  it('evicts the previous Book entity when the id rotated', () => {
    const cache = new InMemoryCache(cacheConfig);
    seedSeriesDetail(cache, SERIES_A, 'Dune', BOOK_ID);
    seedBookDetail(cache, BOOK_ID);

    invalidateBookChange(cache, {
      libraryId: LIBRARY_ID,
      previousId: BOOK_ID,
      currentId: NEW_BOOK_ID,
    });

    expect(entityKeys(cache)).not.toContain(`Book:${BOOK_ID}`);
  });

  it('evicts the previous Book entity when the book was deleted', () => {
    const cache = new InMemoryCache(cacheConfig);
    seedSeriesDetail(cache, SERIES_A, 'Dune', BOOK_ID);
    seedBookDetail(cache, BOOK_ID);

    invalidateBookChange(cache, { libraryId: LIBRARY_ID, previousId: BOOK_ID, currentId: null });

    expect(entityKeys(cache)).not.toContain(`Book:${BOOK_ID}`);
  });

  it('keeps the Book entity when the id is unchanged', () => {
    const cache = new InMemoryCache(cacheConfig);
    seedSeriesDetail(cache, SERIES_A, 'Dune', BOOK_ID);
    seedBookDetail(cache, BOOK_ID);

    invalidateBookChange(cache, { libraryId: LIBRARY_ID, previousId: BOOK_ID, currentId: BOOK_ID });

    expect(entityKeys(cache)).toContain(`Book:${BOOK_ID}`);
  });
});

describe('invalidateBookChange — series rating', () => {
  it('evicts overallRating on the changed series, since a rewrite can move a book between series', () => {
    const cache = new InMemoryCache(cacheConfig);
    seedSeriesRating(cache, SERIES_A, 4);
    seedSeriesRating(cache, SERIES_B, 2);

    invalidateBookChange(cache, { libraryId: LIBRARY_ID, seriesIds: [SERIES_A] });

    expect(seriesEntity(cache, SERIES_A)).not.toHaveProperty('overallRating');
    expect(seriesEntity(cache, SERIES_B)).toHaveProperty('overallRating', 2);
  });
});

describe('invalidateSeriesRating', () => {
  it('evicts overallRating on the named series only', () => {
    const cache = new InMemoryCache(cacheConfig);
    seedSeriesRating(cache, SERIES_A, 4);
    seedSeriesRating(cache, SERIES_B, 2);

    invalidateSeriesRating(cache, SERIES_A);

    expect(seriesEntity(cache, SERIES_A)).not.toHaveProperty('overallRating');
    expect(seriesEntity(cache, SERIES_B)).toHaveProperty('overallRating', 2);
  });

  it('is a no-op for a series the cache has never seen', () => {
    const cache = new InMemoryCache(cacheConfig);
    seedSeriesRating(cache, SERIES_A, 4);

    invalidateSeriesRating(cache, 'SERIES-UNKNOWN');

    expect(seriesEntity(cache, SERIES_A)).toHaveProperty('overallRating', 4);
    expect(entityKeys(cache)).not.toContain('Series:SERIES-UNKNOWN');
  });
});

describe('invalidateSeriesProgress', () => {
  it('evicts progressPercentage on every cached series but keeps their book lists', () => {
    const cache = new InMemoryCache(cacheConfig);
    seedSeriesDetail(cache, SERIES_A, 'Dune', BOOK_ID);
    seedSeriesDetail(cache, SERIES_B, 'Emma', 'BOOK-9');

    invalidateSeriesProgress(cache);

    expect(readSeriesDetail(cache, 'Dune')).toBeNull();
    expect(readSeriesDetail(cache, 'Emma')).toBeNull();
    // `books` is keyed on its page size (`cacheConfig`), so the stored field
    // name carries the argument — match any variant.
    expect(Object.keys(seriesEntity(cache, SERIES_A)).some((key) => key.startsWith('books'))).toBe(
      true
    );
    expect(seriesEntity(cache, SERIES_A)).not.toHaveProperty('progressPercentage');
  });
});

describe('invalidateUserProgressCounts', () => {
  it('evicts progressCount on every cached user', () => {
    const cache = new InMemoryCache(cacheConfig);
    cache.writeQuery({
      query: MyProgressCountDocument,
      data: {
        __typename: 'Query',
        viewer: {
          __typename: 'Viewer',
          user: { __typename: 'User', id: USER_ID, progressCount: 3 },
        },
      },
    });

    invalidateUserProgressCounts(cache);

    expect(cache.readQuery({ query: MyProgressCountDocument })).toBeNull();
  });
});

describe('invalidateRequestQueues', () => {
  it('evicts the bookRequests connection on every cached user', () => {
    const cache = new InMemoryCache(cacheConfig);
    cache.writeQuery({
      query: UserRequestListDocument,
      variables: { userId: USER_ID },
      data: {
        __typename: 'Query',
        user: {
          __typename: 'User',
          id: USER_ID,
          username: 'bob',
          library: { __typename: 'Library', id: LIBRARY_ID },
          bookRequests: {
            __typename: 'UserBookRequestsConnection',
            edges: [],
            pageInfo: { __typename: 'PageInfo', hasNextPage: false, endCursor: null },
          },
        },
      },
    });

    invalidateRequestQueues(cache);

    expect(
      cache.readQuery({ query: UserRequestListDocument, variables: { userId: USER_ID } })
    ).toBeNull();
  });
});
