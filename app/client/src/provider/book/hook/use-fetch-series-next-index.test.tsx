import type { MockedResponse } from '@apollo/client/testing';
import { act } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';

import type { SeriesNextIndexQuery } from '~/gql/graphql';
import { SeriesNextIndexDocument } from '~/graphql/library';
import { renderHookWithApollo } from '~/test-utils';

import { useFetchSeriesNextIndex } from './use-fetch-series-next-index';

const LIBRARY_ID = 'LIB-1';

vi.mock('~/provider/library-target', () => ({
  useCurrentLibraryId: () => ({ libraryId: LIBRARY_ID, loading: false }),
}));

const nextIndexMock = (name: string, nextIndex: number): MockedResponse<SeriesNextIndexQuery> => ({
  request: { query: SeriesNextIndexDocument, variables: { libraryId: LIBRARY_ID, name } },
  result: {
    data: {
      __typename: 'Query',
      node: { __typename: 'Library', id: LIBRARY_ID, seriesNextIndex: nextIndex },
    },
  },
});

const errorMock = (name: string): MockedResponse<SeriesNextIndexQuery> => ({
  request: { query: SeriesNextIndexDocument, variables: { libraryId: LIBRARY_ID, name } },
  error: new Error('Failed to fetch next series index'),
});

describe('useFetchSeriesNextIndex', () => {
  it('requests seriesNextIndex for the given name and resolves with it', async () => {
    const { result } = renderHookWithApollo(useFetchSeriesNextIndex, [
      nextIndexMock('The Expanse', 4),
    ]);

    let resolved: number | undefined;
    await act(async () => {
      resolved = await result.current?.('The Expanse');
    });
    expect(resolved).toBe(4);
  });

  it('rejects when the query errors', async () => {
    const { result } = renderHookWithApollo(useFetchSeriesNextIndex, [errorMock('Dune')]);

    await expect(result.current?.('Dune')).rejects.toThrow();
  });

  // The known Apollo trap (see `use-book-validation.ts`'s doc comment):
  // `useLazyQuery`'s execute function RESETS to empty variables when called
  // with no arguments. `MockLink` matches a mock's `request.variables`
  // against the EXACT variables the executed operation carried, so a
  // regression to the bare `execute()` form (relying on the hook-level
  // `variables` default) would send `{}` instead of `{ libraryId, name }` —
  // this mock, keyed to the real variables, would go unmatched and MockLink
  // would throw "No more mocked responses", failing this test loudly.
  it('sends the library id and series name explicitly on each fetch', async () => {
    const { result } = renderHookWithApollo(useFetchSeriesNextIndex, [
      nextIndexMock('A Banner', 2),
    ]);

    let resolved: number | undefined;
    await act(async () => {
      resolved = await result.current?.('A Banner');
    });
    expect(resolved).toBe(2);
  });
});
