import type { MockedResponse } from '@apollo/client/testing';
import { waitFor } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';

import type { LibrarySubjectsQuery } from '~/gql/graphql';
import { LibrarySubjectsDocument } from '~/graphql/library';
import { renderHookWithApollo } from '~/test-utils';

import { useLibrarySubjects } from './use-library-subjects';

const LIBRARY_ID = 'LIB-1';

let currentLibraryId: string | undefined = LIBRARY_ID;
let currentLibraryIdLoading = false;

vi.mock('~/provider/library-target', () => ({
  useCurrentLibraryId: () => ({ libraryId: currentLibraryId, loading: currentLibraryIdLoading }),
}));

const subjectsMock = (subjects: string[]): MockedResponse<LibrarySubjectsQuery> => ({
  request: { query: LibrarySubjectsDocument, variables: { libraryId: LIBRARY_ID } },
  result: {
    data: {
      __typename: 'Query',
      node: { __typename: 'Library', id: LIBRARY_ID, subjects },
    },
  },
});

const errorMock = (): MockedResponse<LibrarySubjectsQuery> => ({
  request: { query: LibrarySubjectsDocument, variables: { libraryId: LIBRARY_ID } },
  error: new Error('subjects fetch failed'),
});

const renderProbe = (mocks: MockedResponse[]) => renderHookWithApollo(useLibrarySubjects, mocks);

describe('useLibrarySubjects', () => {
  it('fetches Library.subjects and returns them', async () => {
    const { result } = renderProbe([subjectsMock(['Fiction', 'History'])]);
    await waitFor(() => expect(result.current?.[0]).toEqual(['Fiction', 'History']));
    expect(result.current?.[2]).toBeUndefined();
  });

  it('starts with loading true', () => {
    const { result } = renderProbe([subjectsMock([])]);
    expect(result.current?.[1]).toBe(true);
  });

  it('sets loading false after the fetch completes', async () => {
    const { result } = renderProbe([subjectsMock([])]);
    await waitFor(() => expect(result.current?.[1]).toBe(false));
  });

  it('sets an error string on a failed fetch', async () => {
    const { result } = renderProbe([errorMock()]);
    await waitFor(() => expect(result.current?.[2]).toBe('subjects fetch failed'));
    expect(result.current?.[0]).toEqual([]);
  });

  it('returns an empty array by default', () => {
    const { result } = renderProbe([subjectsMock(['Fiction'])]);
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

  // A skipped `useQuery` reports `loading: false` — without folding in
  // `useCurrentLibraryId`'s own `loading`, a caller reading this hook's
  // `loading` during the bootstrap round trip (libraryId still resolving)
  // would see `[], loading: false`: a false "no subjects" read.
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
