import type { ApolloCache } from '@apollo/client';

import { SeriesBookRowFragment } from '~/component/book-row/from-series-book';
import { makeFragmentData } from '~/gql';
import { UserRequestListDocument } from '~/graphql/book-request';
import { SeriesNamesDocument } from '~/graphql/library';
import { MyProgressCountDocument } from '~/graphql/progress';

/**
 * Test-only cache seeds for the reads that cache invalidation must make MISS.
 * Shared because the same three reads — a series page, a series-name list and
 * the admin's pending-request queue — are asserted against from a dozen
 * mutation call sites. `~/page/series` is imported lazily, the way
 * `page/book/index.test.tsx` imports `~/page/library`, to keep a route module
 * out of every hook test's import graph.
 */
const seriesDetailDocument = async () => (await import('~/page/series')).SeriesDetailDocument;

export type SeriesSeed = { libraryId: string; seriesId: string; name: string; bookId: string };

export const seedSeriesDetail = async (
  cache: ApolloCache,
  { libraryId, seriesId, name, bookId }: SeriesSeed
) =>
  cache.writeQuery({
    query: await seriesDetailDocument(),
    variables: { libraryId, name },
    data: {
      __typename: 'Query',
      node: {
        __typename: 'Library',
        id: libraryId,
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

export const readSeriesDetail = async (
  cache: ApolloCache,
  { libraryId, name }: { libraryId: string; name: string }
) => cache.readQuery({ query: await seriesDetailDocument(), variables: { libraryId, name } });

export const seedSeriesNames = (
  cache: ApolloCache,
  { libraryId, series }: { libraryId: string; series: { id: string; name: string }[] }
) =>
  cache.writeQuery({
    query: SeriesNamesDocument,
    variables: { libraryId },
    data: {
      __typename: 'Query',
      node: {
        __typename: 'Library',
        id: libraryId,
        series: series.map((s) => ({ __typename: 'Series' as const, ...s })),
      },
    },
  });

export const readSeriesNames = (cache: ApolloCache, { libraryId }: { libraryId: string }) =>
  cache.readQuery({ query: SeriesNamesDocument, variables: { libraryId } });

export const seedRequestQueue = (
  cache: ApolloCache,
  { userId, libraryId }: { userId: string; libraryId: string }
) =>
  cache.writeQuery({
    query: UserRequestListDocument,
    variables: { userId },
    data: {
      __typename: 'Query',
      user: {
        __typename: 'User',
        id: userId,
        username: 'bob',
        library: { __typename: 'Library', id: libraryId },
        bookRequests: {
          __typename: 'UserBookRequestsConnection',
          edges: [],
          pageInfo: { __typename: 'PageInfo', hasNextPage: false, endCursor: null },
        },
      },
    },
  });

export const readRequestQueue = (cache: ApolloCache, { userId }: { userId: string }) =>
  cache.readQuery({ query: UserRequestListDocument, variables: { userId } });

export const seedProgressCount = (cache: ApolloCache, userId: string, progressCount: number) =>
  cache.writeQuery({
    query: MyProgressCountDocument,
    data: {
      __typename: 'Query',
      viewer: { __typename: 'Viewer', user: { __typename: 'User', id: userId, progressCount } },
    },
  });

export const readProgressCount = (cache: ApolloCache) =>
  cache.readQuery({ query: MyProgressCountDocument });
