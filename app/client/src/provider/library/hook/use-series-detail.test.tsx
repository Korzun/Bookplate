import { waitFor } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';

import { SeriesDetailDocument } from '~/graphql/series';
import { renderHookWithApollo } from '~/test-utils';

import { useSeriesDetail } from './use-series-detail';

const LIBRARY_ID = 'TGlicmFyeTox';

// `useSeriesDetail` reads the current library through `useCurrentLibraryId`
// (`~/provider/library-target`), which itself runs an unconditional
// `ViewerBootstrapDocument` query — see `use-library-entries.test.tsx` for
// the same stub. Stubbing it directly (rather than adding a bootstrap mock
// to every `mocks` array below) keeps these tests focused on
// `SeriesDetailDocument` alone.
vi.mock('~/provider/library-target', () => ({
  useCurrentLibraryId: () => ({ libraryId: LIBRARY_ID, loading: false }),
}));

const seriesResult = (name: string) => ({
  request: { query: SeriesDetailDocument, variables: { libraryId: LIBRARY_ID, name } },
  result: {
    data: {
      __typename: 'Query' as const,
      node: {
        __typename: 'Library' as const,
        id: LIBRARY_ID,
        seriesByName: {
          __typename: 'Series' as const,
          id: 'U2VyaWVzOjE=',
          name,
          author: 'Le Guin',
          publisher: 'Harper',
          totalPages: 900,
          totalSize: 3_000_000,
          subjects: ['Fantasy'],
          progressPercentage: 0.5,
          books: {
            __typename: 'SeriesBooksConnection' as const,
            edges: [
              {
                __typename: 'SeriesBooksConnectionEdge' as const,
                node: {
                  __typename: 'Book' as const,
                  id: 'Qm9vazox',
                  title: 'A Wizard of Earthsea',
                  seriesIndex: 1,
                  hasCover: true,
                  thumbnailUrl: '/api/books/1/cover?width=88',
                  progress: {
                    __typename: 'Progress' as const,
                    id: 'UHJvZ3Jlc3M6MQ==',
                    percentage: 0.5,
                  },
                },
              },
            ],
          },
        },
      },
    },
  },
});

describe('useSeriesDetail', () => {
  it('returns the series with its books', async () => {
    const { result } = renderHookWithApollo(
      () => useSeriesDetail('Earthsea'),
      [seriesResult('Earthsea')]
    );

    await waitFor(() => expect(result.current?.loading).toBe(false));
    expect(result.current?.series?.name).toBe('Earthsea');
    expect(result.current?.series?.books).toHaveLength(1);
    expect(result.current?.error).toBeUndefined();
  });

  it('returns undefined series (not an error) for a name the library does not have', async () => {
    const { result } = renderHookWithApollo(
      () => useSeriesDetail('Nope'),
      [
        {
          request: {
            query: SeriesDetailDocument,
            variables: { libraryId: LIBRARY_ID, name: 'Nope' },
          },
          result: {
            data: {
              __typename: 'Query' as const,
              node: { __typename: 'Library' as const, id: LIBRARY_ID, seriesByName: null },
            },
          },
        },
      ]
    );

    await waitFor(() => expect(result.current?.loading).toBe(false));
    expect(result.current?.series).toBeUndefined();
    expect(result.current?.error).toBeUndefined();
  });

  it('surfaces a transport failure as a message string', async () => {
    const { result } = renderHookWithApollo(
      () => useSeriesDetail('Earthsea'),
      [
        {
          request: {
            query: SeriesDetailDocument,
            variables: { libraryId: LIBRARY_ID, name: 'Earthsea' },
          },
          error: new Error('network down'),
        },
      ]
    );

    await waitFor(() => expect(result.current?.error).toBe('network down'));
    expect(result.current?.series).toBeUndefined();
  });

  it('returns MASKED book refs — it must not unmask centrally', async () => {
    const { result } = renderHookWithApollo(
      () => useSeriesDetail('Earthsea'),
      [seriesResult('Earthsea')]
    );

    await waitFor(() => expect(result.current?.loading).toBe(false));

    const book = result.current?.series?.books[0];
    // Masking in this codebase is a TYPE-level contract, not a runtime one:
    // `gql/fragment-masking.ts`'s generated `useFragment` is a plain
    // identity cast (`return fragmentType as any`), and this app's
    // `ApolloClient` never sets Apollo's real `dataMasking` option, so the
    // object MockLink hands back still HAS `title` at runtime — masking
    // only withholds it from the declared TYPE. The line below proves that:
    // it compiles only because `@ts-expect-error` is suppressing a real
    // type error; if `useSeriesDetail` ever unmasks centrally (defeating
    // the point — see its doc comment) and widens `books`' element type to
    // something with a real `.title`, this starts failing with "Unused
    // '@ts-expect-error' directive" under `tsc` (`npm run lint`), while the
    // `expect` below it still proves the underlying data was returned
    // whole, not stripped by an accidental `.map()` into a plain object.
    // @ts-expect-error — `title` isn't readable on a masked ref without `useFragment`.
    expect(book?.title).toBe('A Wizard of Earthsea');
  });
});
