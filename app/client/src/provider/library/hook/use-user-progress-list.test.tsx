import type { MockedResponse } from '@apollo/client/testing';
import { act, waitFor } from '@testing-library/react';
import { describe, expect, it } from 'vitest';

import { UserProgressListDocument } from '~/graphql/progress';
import { renderHookWithApollo } from '~/test-utils';

import { useUserProgressList } from './use-user-progress-list';

const TARGET_USER_ID = 'user-target-99';
const PAGE_SIZE = 50;

/**
 * A distinct id this hook is NEVER given — see the "roots at Query.user"
 * test below for why it matters that this literal differs from
 * `TARGET_USER_ID`.
 */
const VIEWER_ID = 'user-viewer-1';

/**
 * `rows` is a MASKED array (see the hook's own doc comment): fragment
 * fields (`document`, `percentage`, ...) are not visible on the hook's
 * return type without a `useFragment` call this hook deliberately does not
 * make. `id` is a plain sibling selection on `node` alongside the fragment
 * spread, not part of the fragment itself, so it stays visible pre-unmask.
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
  userId: string,
  edges: { cursor: string; node: ReturnType<typeof progressNode> }[],
  pageInfo: { hasNextPage: boolean; endCursor: string | null }
) => ({
  user: {
    __typename: 'User' as const,
    id: userId,
    library: {
      __typename: 'Library' as const,
      id: `lib-for-${userId}`,
      progress: {
        __typename: 'LibraryProgressConnection' as const,
        edges: edges.map((e) => ({
          __typename: 'LibraryProgressConnectionEdge' as const,
          ...e,
        })),
        pageInfo: { __typename: 'PageInfo' as const, ...pageInfo },
      },
    },
  },
});

const firstPageMock = (
  userId: string,
  edges: { cursor: string; node: ReturnType<typeof progressNode> }[],
  pageInfo: { hasNextPage: boolean; endCursor: string | null }
) => ({
  request: {
    query: UserProgressListDocument,
    variables: { userId, first: PAGE_SIZE },
  },
  result: { data: { __typename: 'Query' as const, ...connection(userId, edges, pageInfo) } },
});

const fetchMoreMock = (
  userId: string,
  after: string,
  edges: { cursor: string; node: ReturnType<typeof progressNode> }[],
  pageInfo: { hasNextPage: boolean; endCursor: string | null }
) => ({
  request: {
    query: UserProgressListDocument,
    variables: { userId, first: PAGE_SIZE, after },
  },
  result: { data: { __typename: 'Query' as const, ...connection(userId, edges, pageInfo) } },
});

const fetchMoreErrorMock = (userId: string, after: string) => ({
  request: {
    query: UserProgressListDocument,
    variables: { userId, first: PAGE_SIZE, after },
  },
  error: new Error('fetch more failed'),
});

const renderProbe = (userId: string, mocks: MockedResponse[], skip = false) =>
  renderHookWithApollo(() => useUserProgressList(userId, { skip }), mocks).result;

describe('useUserProgressList', () => {
  it('returns rows for the target user', async () => {
    const result = renderProbe(TARGET_USER_ID, [
      firstPageMock(TARGET_USER_ID, [{ cursor: 'c1', node: progressNode('p1') }], {
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

  // Brief-required: proves the query roots at `Query.user(id: $userId)` for
  // the TARGET user this hook is explicitly given, not some other
  // (e.g. viewer's own) id. `VIEWER_ID` is a deliberately different literal
  // that is never passed to the hook and has no matching mock — if the hook
  // substituted it (or any id besides its own `userId` argument) anywhere,
  // `MockLink` would throw "No more mocked responses" instead of resolving,
  // and the assertions below would never be reached. Unlike
  // `useMyProgressList`, this hook has no `useCurrentLibraryId`-style
  // internal id resolution at all — `userId` is a plain argument, which is
  // itself why there is nothing to mock/stub here besides the query.
  it('roots at Query.user for the target user, not any other id', async () => {
    const result = renderProbe(TARGET_USER_ID, [
      firstPageMock(TARGET_USER_ID, [{ cursor: 'c1', node: progressNode('p1') }], {
        hasNextPage: false,
        endCursor: null,
      }),
    ]);

    await waitFor(() => expect(result.current?.loading).toBe(false));
    expect(result.current?.rows.map((r) => r.id)).toEqual(['p1']);
    expect(VIEWER_ID).not.toBe(TARGET_USER_ID);
  });

  it('appends the next page via loadMore without dropping the first', async () => {
    const result = renderProbe(TARGET_USER_ID, [
      firstPageMock(TARGET_USER_ID, [{ cursor: 'c1', node: progressNode('p1') }], {
        hasNextPage: true,
        endCursor: 'c1',
      }),
      fetchMoreMock(TARGET_USER_ID, 'c1', [{ cursor: 'c2', node: progressNode('p2') }], {
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
    const result = renderProbe(TARGET_USER_ID, [
      firstPageMock(TARGET_USER_ID, [{ cursor: 'c1', node: progressNode('p1') }], {
        hasNextPage: true,
        endCursor: 'c1',
      }),
      fetchMoreErrorMock(TARGET_USER_ID, 'c1'),
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

  it('fetches nothing while skip is true, even with a valid user id', () => {
    // No mocks at all: if the hook fired UserProgressList anyway, MockLink
    // would throw "No more mocked responses" and fail this test loudly.
    const result = renderProbe(TARGET_USER_ID, [], true);

    expect(result.current?.loading).toBe(false);
    expect(result.current?.rows).toEqual([]);
    expect(result.current?.error).toBeUndefined();
  });
});
