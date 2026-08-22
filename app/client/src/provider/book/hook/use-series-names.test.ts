import type { MockedResponse } from '@apollo/client/testing';
import { waitFor } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';

import type { SeriesNamesQuery } from '~/gql/graphql';
import { SeriesNamesDocument } from '~/graphql/library';
import { renderHookWithApollo } from '~/test-utils';

import { useSeriesNames } from './use-series-names';

const LIBRARY_ID = 'LIB-1';

let currentLibraryId: string | undefined = LIBRARY_ID;
let currentLibraryIdLoading = false;

vi.mock('~/provider/library-target', () => ({
  useCurrentLibraryId: () => ({ libraryId: currentLibraryId, loading: currentLibraryIdLoading }),
}));

const seriesMock = (names: string[]): MockedResponse<SeriesNamesQuery> => ({
  request: { query: SeriesNamesDocument, variables: { libraryId: LIBRARY_ID } },
  result: {
    data: {
      __typename: 'Query',
      node: {
        __typename: 'Library',
        id: LIBRARY_ID,
        series: names.map((name, index) => ({
          __typename: 'Series' as const,
          id: `SERIES-${index}`,
          name,
        })),
      },
    },
  },
});

const errorMock = (): MockedResponse<SeriesNamesQuery> => ({
  request: { query: SeriesNamesDocument, variables: { libraryId: LIBRARY_ID } },
  error: new Error('Failed to fetch series'),
});

const renderProbe = (mocks: MockedResponse[]) => renderHookWithApollo(useSeriesNames, mocks);

describe('useSeriesNames', () => {
  it('fetches Library.series and returns the names in server order', async () => {
    const { result } = renderProbe([seriesMock(['Expanse', 'A Banner', 'The Zone'])]);
    await waitFor(() => expect(result.current?.[0]).toEqual(['Expanse', 'A Banner', 'The Zone']));
  });

  it('starts with loading true', () => {
    const { result } = renderProbe([seriesMock([])]);
    expect(result.current?.[1]).toBe(true);
  });

  it('sets loading false after fetch completes', async () => {
    const { result } = renderProbe([seriesMock([])]);
    await waitFor(() => expect(result.current?.[1]).toBe(false));
  });

  it('sets error string on a failed fetch', async () => {
    const { result } = renderProbe([errorMock()]);
    await waitFor(() => expect(result.current?.[2]).toBe('Failed to fetch series'));
  });

  it('returns empty array by default', () => {
    const { result } = renderProbe([seriesMock(['Expanse'])]);
    expect(result.current?.[0]).toEqual([]);
  });

  it('does not query when there is no library id', () => {
    currentLibraryId = undefined;
    try {
      // No mocks: if the hook queried anyway, MockLink would throw "No more
      // mocked responses" and fail this test loudly rather than pass vacuously.
      const { result } = renderProbe([]);

      expect(result.current?.[1]).toBe(false);
      expect(result.current?.[0]).toEqual([]);
    } finally {
      currentLibraryId = LIBRARY_ID;
    }
  });

  it('reports loading while useCurrentLibraryId itself is still resolving, even though the query is skipped', () => {
    currentLibraryId = undefined;
    currentLibraryIdLoading = true;
    try {
      const { result } = renderProbe([]);

      expect(result.current?.[1]).toBe(true);
      expect(result.current?.[0]).toEqual([]);
    } finally {
      currentLibraryId = LIBRARY_ID;
      currentLibraryIdLoading = false;
    }
  });
});
