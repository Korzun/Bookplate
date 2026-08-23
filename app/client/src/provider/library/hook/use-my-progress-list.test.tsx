import type { MockedResponse } from '@apollo/client/testing';
import { act, waitFor } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';

import { MyProgressListDocument } from '~/graphql/progress';
import { renderHookWithApollo } from '~/test-utils';

import { useMyProgressList } from './use-my-progress-list';

const LIBRARY_ID = 'LIB-1';
const PAGE_SIZE = 50;

let currentLibraryId: string | undefined = LIBRARY_ID;
let currentLibraryIdLoading = false;

vi.mock('~/provider/library-target', () => ({
  useCurrentLibraryId: () => ({ libraryId: currentLibraryId, loading: currentLibraryIdLoading }),
}));

/**
 * `rows` is a MASKED array (see the hook's own doc comment): fragment
 * fields (`document`, `percentage`, ...) are not visible on the hook's
 * return type without a `useFragment` call this hook deliberately does not
 * make. `id` is a plain sibling selection alongside the fragment spread on
 * `node`, not part of the fragment itself, so it stays visible pre-unmask —
 * enough to prove order and count without reaching into fragment-only
 * fields.
 */
const progressNode = (id: string, overrides: Record<string, unknown> = {}) => ({
  __typename: 'Progress' as const,
  id,
  document: `doc-${id}`,
  percentage: 0.5,
  currentChapter: 1,
  device: 'Kobo',
  timestamp: '2026-01-01T00:00:00.000Z',
  book: null,
  ...overrides,
});

const connection = (
  edges: { cursor: string; node: ReturnType<typeof progressNode> }[],
  pageInfo: { hasNextPage: boolean; endCursor: string | null }
) => ({
  node: {
    __typename: 'Library' as const,
    id: LIBRARY_ID,
    progress: {
      __typename: 'LibraryProgressConnection' as const,
      edges: edges.map((e) => ({
        __typename: 'LibraryProgressConnectionEdge' as const,
        ...e,
      })),
      pageInfo: { __typename: 'PageInfo' as const, ...pageInfo },
    },
  },
});

const firstPageMock = (
  edges: { cursor: string; node: ReturnType<typeof progressNode> }[],
  pageInfo: { hasNextPage: boolean; endCursor: string | null }
) => ({
  request: {
    query: MyProgressListDocument,
    variables: { libraryId: LIBRARY_ID, first: PAGE_SIZE },
  },
  result: { data: { __typename: 'Query' as const, ...connection(edges, pageInfo) } },
});

const fetchMoreMock = (
  after: string,
  edges: { cursor: string; node: ReturnType<typeof progressNode> }[],
  pageInfo: { hasNextPage: boolean; endCursor: string | null }
) => ({
  request: {
    query: MyProgressListDocument,
    variables: { libraryId: LIBRARY_ID, first: PAGE_SIZE, after },
  },
  result: { data: { __typename: 'Query' as const, ...connection(edges, pageInfo) } },
});

const fetchMoreErrorMock = (after: string) => ({
  request: {
    query: MyProgressListDocument,
    variables: { libraryId: LIBRARY_ID, first: PAGE_SIZE, after },
  },
  error: new Error('fetch more failed'),
});

const renderProbe = (mocks: MockedResponse[], skip = false) =>
  renderHookWithApollo(() => useMyProgressList({ skip }), mocks).result;

describe('useMyProgressList', () => {
  it('returns rows for the current library', async () => {
    const result = renderProbe([
      firstPageMock([{ cursor: 'c1', node: progressNode('p1') }], {
        hasNextPage: false,
        endCursor: null,
      }),
    ]);

    await waitFor(() => expect(result.current?.loading).toBe(false));
    expect(result.current?.error).toBeUndefined();
    expect(result.current?.rows).toHaveLength(1);
    expect(result.current?.rows[0]?.id).toBe('p1');
    expect(result.current?.hasNextPage).toBe(false);
  });

  // Brief-required (Task 6, link modal): `libraryId` is exposed off this
  // hook's own `useCurrentLibraryId()` call — not a second resolution — so
  // `MyProgressContent` can thread it into `MyProgressRow`/`LinkProgressModal`.
  it('returns the current library id', async () => {
    const result = renderProbe([
      firstPageMock([{ cursor: 'c1', node: progressNode('p1') }], {
        hasNextPage: false,
        endCursor: null,
      }),
    ]);

    await waitFor(() => expect(result.current?.loading).toBe(false));
    expect(result.current?.libraryId).toBe(LIBRARY_ID);
  });

  it('appends the next page via loadMore without dropping the first', async () => {
    const result = renderProbe([
      firstPageMock([{ cursor: 'c1', node: progressNode('p1') }], {
        hasNextPage: true,
        endCursor: 'c1',
      }),
      fetchMoreMock('c1', [{ cursor: 'c2', node: progressNode('p2') }], {
        hasNextPage: false,
        endCursor: 'c2',
      }),
    ]);

    await waitFor(() => expect(result.current?.loading).toBe(false));
    expect(result.current?.rows).toHaveLength(1);
    expect(result.current?.hasNextPage).toBe(true);

    act(() => result.current?.loadMore());

    await waitFor(() => expect(result.current?.rows).toHaveLength(2));
    expect(result.current?.rows.map((r) => r.id)).toEqual(['p1', 'p2']);
    expect(result.current?.hasNextPage).toBe(false);
    expect(result.current?.error).toBeUndefined();
    expect(result.current?.loadingMore).toBe(false);
  });

  it('keeps existing rows when loadMore fails, and offers a retry via error', async () => {
    const result = renderProbe([
      firstPageMock([{ cursor: 'c1', node: progressNode('p1') }], {
        hasNextPage: true,
        endCursor: 'c1',
      }),
      fetchMoreErrorMock('c1'),
    ]);

    await waitFor(() => expect(result.current?.loading).toBe(false));
    expect(result.current?.rows).toHaveLength(1);

    act(() => result.current?.loadMore());

    await waitFor(() => expect(result.current?.error).toBe('fetch more failed'));
    expect(result.current?.rows).toHaveLength(1);
    expect(result.current?.rows[0]?.id).toBe('p1');
    expect(result.current?.hasNextPage).toBe(true);
    expect(result.current?.loadingMore).toBe(false);
  });

  it('does not query when there is no library id', () => {
    currentLibraryId = undefined;
    try {
      // No mocks at all: if the hook fired MyProgressList anyway, MockLink
      // would throw "No more mocked responses" and fail this test loudly
      // rather than let it pass vacuously.
      const result = renderProbe([]);

      expect(result.current?.loading).toBe(false);
      expect(result.current?.rows).toEqual([]);
      expect(result.current?.error).toBeUndefined();
    } finally {
      currentLibraryId = LIBRARY_ID;
    }
  });

  it('reports loading while useCurrentLibraryId itself is still resolving, even though the query is skipped', () => {
    currentLibraryId = undefined;
    currentLibraryIdLoading = true;
    try {
      const result = renderProbe([]);

      expect(result.current?.loading).toBe(true);
      expect(result.current?.rows).toEqual([]);
    } finally {
      currentLibraryId = LIBRARY_ID;
      currentLibraryIdLoading = false;
    }
  });

  it('fetches nothing while skip is true, even with a valid library id', () => {
    // No mocks at all: if the hook fired MyProgressList anyway, MockLink
    // would throw "No more mocked responses" and fail this test loudly —
    // this is the same "throws on an unmatched operation" mechanism the
    // component-level test in `my-progress/index.test.tsx` relies on.
    const result = renderProbe([], true);

    expect(result.current?.loading).toBe(false);
    expect(result.current?.rows).toEqual([]);
    expect(result.current?.error).toBeUndefined();
  });
});
