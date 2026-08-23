import type { ApolloClient, NormalizedCacheObject } from '@apollo/client';
import { gql } from '@apollo/client';
import { useQuery } from '@apollo/client/react';
import type { MockedResponse } from '@apollo/client/testing';
import { act, waitFor } from '@testing-library/react';
import { describe, expect, it } from 'vitest';

import { useFragment } from '~/gql';
import type {
  BookLinkDocumentMutation,
  BookLinkDocumentMutationVariables,
  LineageType,
  MyProgressCountQuery,
  MyProgressCountQueryVariables,
  MyProgressListQuery,
  MyProgressListQueryVariables,
  ProgressDeleteMutation,
  ProgressDeleteMutationVariables,
  ProgressRowFragmentFragment,
  ProgressSetMutation,
  ProgressSetMutationVariables,
  ViewerBootstrapQuery,
  ViewerBootstrapQueryVariables,
} from '~/gql/graphql';
import {
  BookLinkDocumentDocument,
  MyProgressCountDocument,
  MyProgressListDocument,
  ProgressDeleteDocument,
  ProgressRowFragment,
  ProgressSetDocument,
} from '~/graphql/progress';
import { ViewerBootstrapDocument } from '~/graphql/viewer-bootstrap';
import { renderHookWithApollo } from '~/test-utils';

import { useDeleteProgress, useLinkProgress, useSetMyProgress } from './use-progress-mutations';

const LIBRARY_ID = 'library-1';
const VIEWER_USER_ID = 'user-1';
const myProgressListVariables = { libraryId: LIBRARY_ID, first: 50, after: null };

// The masked query-level node type (`MyProgressListQuery['node'][...]`)
// hides `ProgressRowFragment`'s fields behind a `$fragmentRefs` marker at
// the TYPE level even though nothing strips them at runtime (masking is
// compile-time only in this codebase — see the hook's own doc comment).
// Building fixtures against the concrete fragment type instead is what lets
// this factory actually set `document`/`percentage`/etc.
type ProgressNode = ProgressRowFragmentFragment;

const viewerBootstrapMock = (
  userId: string | null
): MockedResponse<ViewerBootstrapQuery, ViewerBootstrapQueryVariables> => ({
  request: { query: ViewerBootstrapDocument },
  result: {
    data: {
      __typename: 'Query',
      viewer: {
        __typename: 'Viewer',
        username: userId ? 'alice' : 'admin',
        isAdmin: userId === null,
        mustChangePassword: false,
        user: userId ? { __typename: 'User', id: userId } : null,
        library: { __typename: 'Library', id: LIBRARY_ID },
      },
    },
  },
});

/**
 * `useSetMyProgress` reads the viewer's user id off `ViewerBootstrapDocument`
 * — this waits for that mock to actually land in the cache before a test
 * calls `setProgress`, otherwise `userId` is still `undefined` on the first
 * render and every call takes the "not signed in" branch regardless of what
 * mutation mock the test supplied. Mirrors
 * `use-regenerate-sync-password.test.tsx`'s identical helper.
 */
const waitForViewerBootstrap = (client: ApolloClient) =>
  waitFor(() => expect(client.cache.readQuery({ query: ViewerBootstrapDocument })).not.toBeNull());

const progressRow = (
  overrides: Partial<{
    id: string;
    document: string;
    percentage: number;
    currentChapter: number;
    device: string;
    timestamp: string;
    book: ProgressNode['book'];
  }> = {}
): ProgressNode => ({
  __typename: 'Progress',
  id: overrides.id ?? 'progress-existing',
  document: overrides.document ?? 'existing-doc-hash-000000000000',
  percentage: overrides.percentage ?? 0.2,
  currentChapter: overrides.currentChapter ?? 1,
  device: overrides.device ?? 'Kobo',
  timestamp: overrides.timestamp ?? '2026-01-01T00:00:00.000Z',
  book: overrides.book ?? null,
});

const seedMyProgressList = (
  client: ApolloClient,
  edges: { cursor: string; node: ProgressNode }[]
) =>
  client.writeQuery({
    query: MyProgressListDocument,
    variables: myProgressListVariables,
    data: {
      __typename: 'Query',
      node: {
        __typename: 'Library',
        id: LIBRARY_ID,
        progress: {
          __typename: 'LibraryProgressConnection',
          edges: edges.map((e) => ({
            __typename: 'LibraryProgressConnectionEdge' as const,
            ...e,
          })),
          pageInfo: { __typename: 'PageInfo', hasNextPage: false, endCursor: null },
        },
      },
    },
  });

/** I-2: seeds `MyProgressCountDocument`'s cache entry the way the collapsed profile card would — so a test can prove a set/delete mutation's `user.progressCount` reaches this SAME entity purely through normalization. */
const seedMyProgressCount = (client: ApolloClient, userId: string, progressCount: number) =>
  client.writeQuery({
    query: MyProgressCountDocument,
    data: {
      __typename: 'Query',
      viewer: {
        __typename: 'Viewer',
        user: { __typename: 'User', id: userId, progressCount },
      },
    },
  });

const progressSetSuccessMock = (args: {
  document: string;
  progressId: string;
  currentChapter: number;
  percentage: number;
  userId?: string;
  /** I-1: attaches the returned `Progress` to a `Book`, matching the shape a first-time set for a known book returns. */
  book?: ProgressNode['book'];
  /** I-2: the payload's `user.progressCount` after this set — defaults to a plausible post-write value. */
  progressCount?: number;
}): MockedResponse<ProgressSetMutation, ProgressSetMutationVariables> => ({
  request: {
    query: ProgressSetDocument,
    variables: {
      input: {
        document: args.document,
        userId: args.userId ?? VIEWER_USER_ID,
        currentChapter: args.currentChapter,
        percentage: args.percentage,
      },
    },
  },
  result: {
    data: {
      __typename: 'Mutation',
      progressSet: {
        __typename: 'ProgressSetPayload',
        // `progressRow(...)` returns a typed `ProgressRowFragmentFragment`
        // variable rather than an inline literal — assigning it here (vs. a
        // fresh literal) is what avoids TypeScript's excess-property check
        // against `progressSet`'s MASKED `progress` field type, which hides
        // `document`/`percentage`/etc. behind a `$fragmentRefs` marker.
        progress: progressRow({
          id: args.progressId,
          document: args.document,
          percentage: args.percentage,
          currentChapter: args.currentChapter,
          device: 'Web',
          timestamp: '2026-08-23T00:00:00.000Z',
          book: args.book,
        }),
        library: { __typename: 'Library', id: LIBRARY_ID },
        user: {
          __typename: 'User',
          id: args.userId ?? VIEWER_USER_ID,
          progressCount: args.progressCount ?? 1,
        },
      },
    },
  },
});

const progressDeleteSuccessMock = (
  progressId: string,
  overrides: Partial<{ userId: string; progressCount: number }> = {}
): MockedResponse<ProgressDeleteMutation, ProgressDeleteMutationVariables> => ({
  request: { query: ProgressDeleteDocument, variables: { id: progressId } },
  result: {
    data: {
      __typename: 'Mutation',
      progressDelete: {
        __typename: 'ProgressDeletePayload',
        deletedId: progressId,
        library: { __typename: 'Library', id: LIBRARY_ID },
        user: {
          __typename: 'User',
          id: overrides.userId ?? VIEWER_USER_ID,
          progressCount: overrides.progressCount ?? 0,
        },
      },
    },
  },
});

describe('useSetMyProgress', () => {
  it('returns initial saving/error state', () => {
    const { result } = renderHookWithApollo(() => useSetMyProgress('doc-1'), []);
    expect(typeof result.current?.setProgress).toBe('function');
    expect(result.current?.saving).toBe(false);
    expect(result.current?.error).toBeUndefined();
  });

  // Step 1 requirement #1: a set must make the new percentage visible
  // immediately. Here the progress row is brand new — no `Progress` entity
  // for `NEW_DOCUMENT` exists in the cache yet, so normalization alone
  // (which only overwrites an ALREADY-referenced entity's fields) is not
  // enough; the row must actually be inserted into the connection's edges.
  it('adds the new progress to the cached connection after a set', async () => {
    const NEW_DOCUMENT = 'new-doc-hash-00000000000000000';
    const NEW_PROGRESS_ID = 'progress-new';

    const { result, client } = renderHookWithApollo(() => useSetMyProgress(NEW_DOCUMENT), [
      viewerBootstrapMock(VIEWER_USER_ID),
      progressSetSuccessMock({
        document: NEW_DOCUMENT,
        progressId: NEW_PROGRESS_ID,
        currentChapter: 3,
        percentage: 0.5,
      }),
    ] as MockedResponse[]);
    await waitForViewerBootstrap(client);
    act(() => seedMyProgressList(client, [{ cursor: 'progress-existing', node: progressRow() }]));

    await act(async () => {
      await result.current?.setProgress({ currentChapter: 3, percentage: 0.5 });
    });

    expect(result.current?.error).toBeUndefined();
    const cached = client.cache.readQuery({
      query: MyProgressListDocument,
      variables: myProgressListVariables,
    });
    const edges = cached?.node?.__typename === 'Library' ? cached.node.progress.edges : undefined;
    expect(edges).toHaveLength(2);
    expect(edges?.map((e) => e.node.id)).toContain(NEW_PROGRESS_ID);
  });

  // I-1 (final whole-branch review): a FIRST-TIME set for a book with no
  // prior progress row left `Book.progress` cached as the `null` the server
  // returned before anything existed — nothing overwrote it afterwards, so
  // `page/book`'s progressbar, "Clear Progress", the library grid, and the
  // series page all kept showing no progress for the rest of the session.
  // Every OTHER set-progress test in this file uses a fixture whose
  // `Book.progress` is either absent or already non-null, which is why this
  // gap survived task review: this is the one test that seeds a `Book`
  // entity with `progress: null` BEFORE the set, mirroring
  // `useDeleteProgress`'s own "nulls Book.progress..." test in reverse.
  it('inserts a Book.progress reference when a first-time set has no prior cached progress', async () => {
    const NEW_DOCUMENT = 'brand-new-doc-hash-000000000000';
    const NEW_PROGRESS_ID = 'progress-brand-new';
    const BOOK_ID = 'book-42';

    const { result, client } = renderHookWithApollo(() => useSetMyProgress(NEW_DOCUMENT), [
      viewerBootstrapMock(VIEWER_USER_ID),
      progressSetSuccessMock({
        document: NEW_DOCUMENT,
        progressId: NEW_PROGRESS_ID,
        currentChapter: 2,
        percentage: 0.3,
        book: {
          __typename: 'Book',
          id: BOOK_ID,
          title: 'Dune',
          author: 'Frank Herbert',
          hasCover: true,
          thumbnailUrl: 'thumb.png',
        },
      }),
    ] as MockedResponse[]);
    await waitForViewerBootstrap(client);

    // Seeds the Book entity the way `BookDetailDocument`/`BookRowFragment`
    // would cache it BEFORE any progress exists: `progress: null`, exactly
    // the shape `useDeleteProgress`'s own "nulls Book.progress..." test
    // writes on the other side of the same field.
    act(() => {
      client.cache.writeFragment({
        id: client.cache.identify({ __typename: 'Book', id: BOOK_ID }),
        fragment: gql`
          fragment BookNoProgressForTest on Book {
            id
            progress {
              id
            }
          }
        `,
        data: { __typename: 'Book', id: BOOK_ID, progress: null },
      });
    });

    await act(async () => {
      await result.current?.setProgress({ currentChapter: 2, percentage: 0.3 });
    });

    expect(result.current?.error).toBeUndefined();
    const bookRead = client.cache.readFragment({
      id: client.cache.identify({ __typename: 'Book', id: BOOK_ID }),
      fragment: gql`
        fragment BookProgressAfterSetForTest on Book {
          id
          progress {
            id
            percentage
            currentChapter
          }
        }
      `,
    });
    expect(bookRead).toEqual({
      __typename: 'Book',
      id: BOOK_ID,
      progress: {
        __typename: 'Progress',
        id: NEW_PROGRESS_ID,
        percentage: 0.3,
        currentChapter: 2,
      },
    });
  });

  // I-2 (final whole-branch review): the profile card's "N books synced"
  // subtitle (`MyProgressCountDocument`) reads `Viewer.user.progressCount`
  // off the SAME `User:<id>` entity `progressSet`'s new `user` field
  // targets — asserted directly against that OTHER query's cache read, not
  // just against `progressSet`'s own response, to pin the "normalization
  // suffices, no hand-written update" claim per this migration's rule.
  it('normalizes user.progressCount onto the already-cached User entity after a set, without a hand-written update', async () => {
    const { result, client } = renderHookWithApollo(() => useSetMyProgress('doc-1'), [
      viewerBootstrapMock(VIEWER_USER_ID),
      progressSetSuccessMock({
        document: 'doc-1',
        progressId: 'progress-1',
        currentChapter: 1,
        percentage: 0.1,
        progressCount: 6,
      }),
    ] as MockedResponse[]);
    await waitForViewerBootstrap(client);
    act(() => seedMyProgressCount(client, VIEWER_USER_ID, 5));

    await act(async () => {
      await result.current?.setProgress({ currentChapter: 1, percentage: 0.1 });
    });

    expect(result.current?.error).toBeUndefined();
    const cached = client.cache.readQuery<MyProgressCountQuery, MyProgressCountQueryVariables>({
      query: MyProgressCountDocument,
    });
    expect(cached?.viewer.user?.progressCount).toBe(6);
  });

  // The other half of point #1 in this hook's doc comment: when the set
  // targets a document that ALREADY has a cached, already-listed `Progress`
  // row, Apollo's normalization alone updates it in place — the
  // `cache.modify` insert is skipped (via `alreadyListed`) rather than
  // growing a duplicate edge. This is the "normalization suffices" case
  // Global Constraints requires be asserted directly, not just claimed.
  it('updates an already-listed progress row via normalization alone, without duplicating the edge', async () => {
    const EXISTING_DOCUMENT = 'existing-doc-hash-000000000000';
    const EXISTING_PROGRESS_ID = 'progress-existing';

    const { result, client } = renderHookWithApollo(() => useSetMyProgress(EXISTING_DOCUMENT), [
      viewerBootstrapMock(VIEWER_USER_ID),
      progressSetSuccessMock({
        document: EXISTING_DOCUMENT,
        progressId: EXISTING_PROGRESS_ID,
        currentChapter: 5,
        percentage: 0.75,
      }),
    ] as MockedResponse[]);
    await waitForViewerBootstrap(client);
    act(() =>
      seedMyProgressList(client, [
        { cursor: EXISTING_PROGRESS_ID, node: progressRow({ id: EXISTING_PROGRESS_ID }) },
      ])
    );

    await act(async () => {
      await result.current?.setProgress({ currentChapter: 5, percentage: 0.75 });
    });

    expect(result.current?.error).toBeUndefined();
    const cached = client.cache.readQuery({
      query: MyProgressListDocument,
      variables: myProgressListVariables,
    });
    const edges = cached?.node?.__typename === 'Library' ? cached.node.progress.edges : undefined;
    expect(edges).toHaveLength(1);
    // `edge.node`'s TYPE is masked (fields live behind `$fragmentRefs`, per
    // this codebase's compile-time-only masking) even though nothing strips
    // them at runtime — `useFragment` is the identity-cast unmask, the same
    // idiom `use-book-validation.test.tsx` uses to read a masked field back.
    const row = useFragment(ProgressRowFragment, edges?.[0]?.node);
    expect(row?.percentage).toBe(0.75);
    expect(row?.currentChapter).toBe(5);
  });

  it('sets error and returns false when the mutation throws', async () => {
    const { result, client } = renderHookWithApollo(() => useSetMyProgress('doc-1'), [
      viewerBootstrapMock(VIEWER_USER_ID),
      {
        request: {
          query: ProgressSetDocument,
          variables: {
            input: {
              document: 'doc-1',
              userId: VIEWER_USER_ID,
              currentChapter: 1,
              percentage: 0.1,
            },
          },
        },
        error: new Error('Network error'),
      },
    ] as MockedResponse[]);
    await waitForViewerBootstrap(client);

    await act(async () => {
      await result.current?.setProgress({ currentChapter: 1, percentage: 0.1 });
    });

    expect(result.current?.error).toBe('Network error');
  });

  // The typed-union error branch: `ProgressSetResult` is a two-member union
  // (`ProgressSetPayload | InvalidInputError`), and `useLinkProgress` already
  // covers its own typed-error branch (`DocumentAlreadyLinkedError`) — this
  // closes the same gap here so the ladder's `result.status === 'error'`
  // path isn't only exercised via a thrown exception.
  it('maps InvalidInputError to an error message', async () => {
    const { result, client } = renderHookWithApollo(() => useSetMyProgress('doc-1'), [
      viewerBootstrapMock(VIEWER_USER_ID),
      {
        request: {
          query: ProgressSetDocument,
          variables: {
            input: {
              document: 'doc-1',
              userId: VIEWER_USER_ID,
              currentChapter: 1,
              percentage: 0.1,
            },
          },
        },
        result: {
          data: {
            __typename: 'Mutation',
            progressSet: {
              __typename: 'InvalidInputError',
              message: 'percentage must be between 0 and 1',
            },
          },
        },
      },
    ] as MockedResponse[]);
    await waitForViewerBootstrap(client);

    const ok = await act(() => result.current!.setProgress({ currentChapter: 1, percentage: 0.1 }));

    expect(ok).toBe(false);
    expect(result.current?.error).toBe('percentage must be between 0 and 1');
  });

  it('does not fire a second mutation while one is in flight', async () => {
    const { result, client } = renderHookWithApollo(() => useSetMyProgress('doc-1'), [
      viewerBootstrapMock(VIEWER_USER_ID),
      {
        ...progressSetSuccessMock({
          document: 'doc-1',
          progressId: 'progress-1',
          currentChapter: 1,
          percentage: 0.1,
        }),
        delay: 20,
      },
    ] as MockedResponse[]);
    await waitForViewerBootstrap(client);

    act(() => {
      void result.current?.setProgress({ currentChapter: 1, percentage: 0.1 });
    });
    await waitFor(() => expect(result.current?.saving).toBe(true));

    // Only ONE mock is queued; if the in-flight guard were removed, this
    // second call would try to consume a SECOND response from a `MockLink`
    // with none left, surfacing as an error instead of resolving `false`
    // silently.
    const secondCallOk = await act(() =>
      result.current!.setProgress({ currentChapter: 1, percentage: 0.1 })
    );
    expect(secondCallOk).toBe(false);
    expect(result.current?.error).toBeUndefined();

    await waitFor(() => expect(result.current?.saving).toBe(false));
  });

  // The identity-seam guard: `progressSet` takes the RAW content hash, never
  // the `Progress` global id. `DOCUMENT` and `PROGRESS_ID` are deliberately
  // unrelated literals so a coincidental match cannot make this pass.
  it('sends the RAW document to progressSet, never the Progress global id', async () => {
    const DOCUMENT = 'a'.repeat(32);
    const PROGRESS_ID = 'UHJvZ3Jlc3M6MQ==';

    const { result, client } = renderHookWithApollo(() => useSetMyProgress(DOCUMENT), [
      viewerBootstrapMock(VIEWER_USER_ID),
      progressSetSuccessMock({
        document: DOCUMENT,
        progressId: PROGRESS_ID,
        currentChapter: 3,
        percentage: 0.5,
      }),
    ] as MockedResponse[]);
    await waitForViewerBootstrap(client);

    await act(async () => {
      await result.current?.setProgress({ currentChapter: 3, percentage: 0.5 });
    });

    // MockLink throws on an unmatched operation, so a mutation carrying
    // PROGRESS_ID where DOCUMENT belongs would fail to match and surface as
    // an error — that is what makes this assertion load-bearing rather than
    // co-incidentally true.
    expect(result.current?.error).toBeUndefined();
  });
});

describe('useDeleteProgress', () => {
  it('returns initial deleting/error state', () => {
    const { result } = renderHookWithApollo(() => useDeleteProgress(), []);
    expect(typeof result.current?.deleteProgress).toBe('function');
    expect(result.current?.deleting).toBe(false);
    expect(result.current?.error).toBeUndefined();
  });

  it('removes the row from the cached connection after a delete', async () => {
    const KEEP_ID = 'progress-keep';
    const DELETE_ID = 'progress-delete';

    const { result, client } = renderHookWithApollo(
      () => useDeleteProgress(),
      [progressDeleteSuccessMock(DELETE_ID)]
    );
    act(() =>
      seedMyProgressList(client, [
        { cursor: KEEP_ID, node: progressRow({ id: KEEP_ID, document: 'keep-doc' }) },
        { cursor: DELETE_ID, node: progressRow({ id: DELETE_ID, document: 'delete-doc' }) },
      ])
    );

    await act(async () => {
      await result.current?.deleteProgress(DELETE_ID);
    });

    expect(result.current?.error).toBeUndefined();
    const extracted = client.cache.extract() as NormalizedCacheObject;
    expect(Object.keys(extracted)).not.toContain(`Progress:${DELETE_ID}`);

    const cached = client.cache.readQuery({
      query: MyProgressListDocument,
      variables: myProgressListVariables,
    });
    const edges = cached?.node?.__typename === 'Library' ? cached.node.progress.edges : undefined;
    expect(edges).toHaveLength(1);
    expect(edges?.[0]?.node.id).toBe(KEEP_ID);
  });

  // I-2 (final whole-branch review): same claim as `useSetMyProgress`'s
  // identical test, the delete side — asserted against
  // `MyProgressCountDocument`'s OWN cache read, not `progressDelete`'s
  // response, so a hand-written `update` reaching into that query (rather
  // than normalization doing it for free) can't make this pass by accident.
  it('normalizes user.progressCount onto the already-cached User entity after a delete, without a hand-written update', async () => {
    const DELETE_ID = 'progress-delete-count';

    const { result, client } = renderHookWithApollo(
      () => useDeleteProgress(),
      [progressDeleteSuccessMock(DELETE_ID, { progressCount: 4 })]
    );
    act(() => {
      seedMyProgressList(client, [{ cursor: DELETE_ID, node: progressRow({ id: DELETE_ID }) }]);
      seedMyProgressCount(client, VIEWER_USER_ID, 5);
    });

    await act(async () => {
      await result.current?.deleteProgress(DELETE_ID);
    });

    expect(result.current?.error).toBeUndefined();
    const cached = client.cache.readQuery<MyProgressCountQuery, MyProgressCountQueryVariables>({
      query: MyProgressCountDocument,
    });
    expect(cached?.viewer.user?.progressCount).toBe(4);
  });

  // Task 7 (`page/book` teardown): `BookDetailDocument` reads `Book.progress`
  // as a plain object (`{ id percentage currentChapter }`, no `book`
  // sub-selection on the `Progress` side), which Apollo still normalizes as
  // a `Reference` — evicting the referenced `Progress` entity without also
  // clearing this field would leave `Book:<id>` cache-incomplete, driving a
  // pointless (or, in a test, unmocked and failing) refetch the next time
  // anything reads it. `writeFragment` seeds the `Book` entity the same
  // shape-only way `BookDetailDocument` would (no `Progress.book` link
  // cached at all), matching the scenario this hook's own doc comment
  // describes as unrecoverable via `readFragment` on the `Progress` side.
  it('nulls Book.progress when the deleted row is referenced from a cached Book entity', async () => {
    const PROGRESS_ID = 'progress-1';
    const BOOK_ID = 'book-1';

    const { result, client } = renderHookWithApollo(
      () => useDeleteProgress(),
      [progressDeleteSuccessMock(PROGRESS_ID)]
    );

    act(() => {
      client.cache.writeFragment({
        id: client.cache.identify({ __typename: 'Book', id: BOOK_ID }),
        fragment: gql`
          fragment BookWithProgressForTest on Book {
            id
            progress {
              id
              percentage
              currentChapter
            }
          }
        `,
        data: {
          __typename: 'Book',
          id: BOOK_ID,
          progress: {
            __typename: 'Progress',
            id: PROGRESS_ID,
            percentage: 0.5,
            currentChapter: 3,
          },
        },
      });
    });

    await act(async () => {
      await result.current?.deleteProgress(PROGRESS_ID);
    });

    expect(result.current?.error).toBeUndefined();
    const bookRead = client.cache.readFragment({
      id: client.cache.identify({ __typename: 'Book', id: BOOK_ID }),
      fragment: gql`
        fragment BookProgressOnlyForTest on Book {
          id
          progress {
            id
          }
        }
      `,
    });
    expect(bookRead).toEqual({ __typename: 'Book', id: BOOK_ID, progress: null });
  });

  it('maps a delete failure to an error message and leaves the row in place', async () => {
    const KEEP_ID = 'progress-keep';

    const { result, client } = renderHookWithApollo(
      () => useDeleteProgress(),
      [
        {
          request: { query: ProgressDeleteDocument, variables: { id: KEEP_ID } },
          result: { data: { __typename: 'Mutation', progressDelete: null } },
        },
      ]
    );
    act(() =>
      seedMyProgressList(client, [{ cursor: KEEP_ID, node: progressRow({ id: KEEP_ID }) }])
    );

    const ok = await act(() => result.current!.deleteProgress(KEEP_ID));

    expect(ok).toBe(false);
    expect(result.current?.error).toBe('Failed to delete progress');

    const cached = client.cache.readQuery({
      query: MyProgressListDocument,
      variables: myProgressListVariables,
    });
    const edges = cached?.node?.__typename === 'Library' ? cached.node.progress.edges : undefined;
    expect(edges).toHaveLength(1);
    expect(edges?.[0]?.node.id).toBe(KEEP_ID);
  });

  it('does not fire a second mutation while one is in flight', async () => {
    const { result } = renderHookWithApollo(
      () => useDeleteProgress(),
      [{ ...progressDeleteSuccessMock('progress-1'), delay: 20 }]
    );

    act(() => {
      void result.current?.deleteProgress('progress-1');
    });
    await waitFor(() => expect(result.current?.deleting).toBe(true));

    const secondCallOk = await act(() => result.current!.deleteProgress('progress-1'));
    expect(secondCallOk).toBe(false);
    expect(result.current?.error).toBeUndefined();

    await waitFor(() => expect(result.current?.deleting).toBe(false));
  });

  // The identity-seam guard, the delete half: `progressDelete` takes the
  // Progress GLOBAL id, never the raw document. `DOCUMENT` and `PROGRESS_ID`
  // are deliberately unrelated literals.
  it('sends the Progress GLOBAL id to progressDelete, never the raw document', async () => {
    // 'a'.repeat(32) is the sibling identity test's raw-document literal
    // (see the inverse test below) — kept out of this one so this test's
    // own mock can only match on PROGRESS_ID.
    const PROGRESS_ID = 'UHJvZ3Jlc3M6MQ==';

    const { result } = renderHookWithApollo(
      () => useDeleteProgress(),
      [progressDeleteSuccessMock(PROGRESS_ID)]
    );

    await act(async () => {
      await result.current?.deleteProgress(PROGRESS_ID);
    });

    expect(result.current?.error).toBeUndefined();
  });

  it('does not accept the raw document in place of the Progress global id', async () => {
    const DOCUMENT = 'a'.repeat(32);
    const PROGRESS_ID = 'UHJvZ3Jlc3M6MQ==';

    // Only a mock keyed to { id: PROGRESS_ID } is queued — passing DOCUMENT
    // has no matching mock, so MockLink's "no more mocked responses" throw
    // is what proves this hook forwards the caller's id UNCHANGED (never a
    // derived/decoded value) rather than silently accepting either kind.
    const { result } = renderHookWithApollo(
      () => useDeleteProgress(),
      [progressDeleteSuccessMock(PROGRESS_ID)]
    );

    await act(async () => {
      await result.current?.deleteProgress(DOCUMENT);
    });

    expect(result.current?.error).toBeDefined();
  });
});

describe('useLinkProgress', () => {
  const BOOK_GLOBAL_ID = 'book-global-1';
  const ORPHAN_PROGRESS_ID = 'progress-orphan';

  const linkSuccessData = (
    lineage: { __typename: 'LinkedDocument'; oldId: string; newId: string; type: LineageType }[]
  ): BookLinkDocumentMutation => ({
    __typename: 'Mutation',
    bookLinkDocument: {
      __typename: 'BookLinkDocumentPayload',
      book: { __typename: 'Book', id: BOOK_GLOBAL_ID, lineage },
    },
  });

  it('returns initial linking/error state', () => {
    const { result } = renderHookWithApollo(() => useLinkProgress(BOOK_GLOBAL_ID, LIBRARY_ID), []);
    expect(typeof result.current?.link).toBe('function');
    expect(result.current?.linking).toBe(false);
    expect(result.current?.error).toBeUndefined();
  });

  it('maps DocumentAlreadyLinkedError to an error message', async () => {
    const { result } = renderHookWithApollo(
      () => useLinkProgress(BOOK_GLOBAL_ID, LIBRARY_ID),
      [
        {
          request: {
            query: BookLinkDocumentDocument,
            variables: { id: BOOK_GLOBAL_ID, documentId: 'doc-1' },
          },
          result: {
            data: {
              __typename: 'Mutation',
              bookLinkDocument: {
                __typename: 'DocumentAlreadyLinkedError',
                message: 'This document is already linked to another book',
              },
            },
          },
        },
      ]
    );

    const ok = await act(() => result.current!.link('doc-1', ORPHAN_PROGRESS_ID));

    expect(ok).toBe(false);
    expect(result.current?.error).toBe('This document is already linked to another book');
  });

  it('does not fire a second mutation while one is in flight', async () => {
    const mock: MockedResponse<BookLinkDocumentMutation, BookLinkDocumentMutationVariables> = {
      request: {
        query: BookLinkDocumentDocument,
        variables: { id: BOOK_GLOBAL_ID, documentId: 'doc-1' },
      },
      result: { data: linkSuccessData([]) },
      delay: 20,
    };

    const { result } = renderHookWithApollo(
      () => useLinkProgress(BOOK_GLOBAL_ID, LIBRARY_ID),
      [mock]
    );

    act(() => {
      void result.current?.link('doc-1', ORPHAN_PROGRESS_ID);
    });
    await waitFor(() => expect(result.current?.linking).toBe(true));

    const secondCallOk = await act(() => result.current!.link('doc-1', ORPHAN_PROGRESS_ID));
    expect(secondCallOk).toBe(false);
    expect(result.current?.error).toBeUndefined();

    await waitFor(() => expect(result.current?.linking).toBe(false));
  });

  // Normalization-suffices claim, pinned directly against the cache (Global
  // Constraints: a claim like this must be asserted, not just left as an
  // absence of hand-written `update` code). `book { id lineage { ... } }` is
  // re-selected in full, so Apollo overwrites the existing `Book:<id>`
  // entity's `lineage` field on its own.
  it('normalizes the returned book.lineage onto the Book entity without a hand-written update', async () => {
    const mock: MockedResponse<BookLinkDocumentMutation, BookLinkDocumentMutationVariables> = {
      request: {
        query: BookLinkDocumentDocument,
        variables: { id: BOOK_GLOBAL_ID, documentId: 'doc-1' },
      },
      result: {
        data: linkSuccessData([
          { __typename: 'LinkedDocument', oldId: 'doc-1', newId: BOOK_GLOBAL_ID, type: 'EDIT' },
        ]),
      },
    };

    const { result, client } = renderHookWithApollo(
      () => useLinkProgress(BOOK_GLOBAL_ID, LIBRARY_ID),
      [mock]
    );

    await act(async () => {
      await result.current?.link('doc-1', ORPHAN_PROGRESS_ID);
    });

    expect(result.current?.error).toBeUndefined();
    const extracted = client.cache.extract() as NormalizedCacheObject;
    const bookEntity = extracted[`Book:${BOOK_GLOBAL_ID}`] as { lineage?: unknown[] } | undefined;
    expect(bookEntity?.lineage).toEqual([
      { __typename: 'LinkedDocument', oldId: 'doc-1', newId: BOOK_GLOBAL_ID, type: 'EDIT' },
    ]);
  });

  // Fix round 1: the reviewer traced that with no eviction, a linked orphan
  // row rendered from `MyProgressListDocument` shows exactly what it showed
  // before the link — the server migrates the orphan `Progress` row inside
  // `linkDocument`'s own transaction, but the CACHE never hears about it,
  // since `BookLinkDocumentPayload` carries no `progress` field at all
  // (schema-verified). `progressId` is threaded in as `link`'s second
  // argument — the caller already has it, since this is only ever invoked
  // from a component rendering that exact orphan row — and evicted directly,
  // the same shape `useDeleteProgress` uses.
  //
  // I-3 (final whole-branch review): the entity-level evict alone drops the
  // stale orphan but does NOT put anything back in its place — the
  // connection just has one fewer edge (see the "re-fetches Library.progress
  // ... reappears attached" test below for the actual reattachment claim).
  // This test now asserts `readQuery` returns `null`, not an empty `edges`
  // array: the FIELD-level evict added for I-3 wipes the whole cached page
  // (mirroring `useDeleteBook`'s identical "invalidates the connection so a
  // subsequent read misses the cache" test, `use-delete-book.test.tsx`),
  // which is what forces the next read to hit the network at all.
  it('evicts the stale orphan Progress entity and invalidates Library.progress after a link', async () => {
    const mock: MockedResponse<BookLinkDocumentMutation, BookLinkDocumentMutationVariables> = {
      request: {
        query: BookLinkDocumentDocument,
        variables: { id: BOOK_GLOBAL_ID, documentId: 'doc-1' },
      },
      result: { data: linkSuccessData([]) },
    };

    const { result, client } = renderHookWithApollo(
      () => useLinkProgress(BOOK_GLOBAL_ID, LIBRARY_ID),
      [mock]
    );
    act(() =>
      seedMyProgressList(client, [
        { cursor: ORPHAN_PROGRESS_ID, node: progressRow({ id: ORPHAN_PROGRESS_ID }) },
      ])
    );

    await act(async () => {
      await result.current?.link('doc-1', ORPHAN_PROGRESS_ID);
    });

    expect(result.current?.error).toBeUndefined();
    const extracted = client.cache.extract() as NormalizedCacheObject;
    expect(Object.keys(extracted)).not.toContain(`Progress:${ORPHAN_PROGRESS_ID}`);

    const cached = client.cache.readQuery({
      query: MyProgressListDocument,
      variables: myProgressListVariables,
    });
    expect(cached).toBeNull();
  });

  // I-3 (final whole-branch review): the fix's actual point — not just that
  // the stale row is GONE, but that it REAPPEARS, correctly attached to its
  // book, once the invalidated connection refetches. Mounts a REAL, active
  // `useQuery(MyProgressListDocument)` alongside `useLinkProgress`: the
  // field-level evict makes the watched query's cached data incomplete,
  // which (default `cache-first` fetch policy) drives Apollo to refetch
  // over the network automatically — the same mechanism
  // `useDeleteProgress`'s own doc comment traces for `page/book`. The
  // refetch mock returns the row under a DIFFERENT `Progress` id (the
  // server re-keys it — see this hook's own doc comment) WITH `book`
  // attached, so a test that only checked "the old id is gone" could not
  // tell this apart from the row simply staying gone.
  it('re-fetches Library.progress after a link so the row reappears attached to its book', async () => {
    const RELINK_BOOK_ID = 'book-relink-target';
    const RELINKED_PROGRESS_ID = 'progress-relinked';

    const linkMock: MockedResponse<BookLinkDocumentMutation, BookLinkDocumentMutationVariables> = {
      request: {
        query: BookLinkDocumentDocument,
        variables: { id: RELINK_BOOK_ID, documentId: 'doc-1' },
      },
      result: { data: linkSuccessData([]) },
    };

    const initialFetchMock: MockedResponse<MyProgressListQuery, MyProgressListQueryVariables> = {
      request: { query: MyProgressListDocument, variables: myProgressListVariables },
      result: {
        data: {
          __typename: 'Query',
          node: {
            __typename: 'Library',
            id: LIBRARY_ID,
            progress: {
              __typename: 'LibraryProgressConnection',
              edges: [
                {
                  __typename: 'LibraryProgressConnectionEdge',
                  cursor: ORPHAN_PROGRESS_ID,
                  node: progressRow({ id: ORPHAN_PROGRESS_ID, document: 'doc-1' }),
                },
              ],
              pageInfo: { __typename: 'PageInfo', hasNextPage: false, endCursor: null },
            },
          },
        },
      },
    };

    const refetchMock: MockedResponse<MyProgressListQuery, MyProgressListQueryVariables> = {
      request: { query: MyProgressListDocument, variables: myProgressListVariables },
      result: {
        data: {
          __typename: 'Query',
          node: {
            __typename: 'Library',
            id: LIBRARY_ID,
            progress: {
              __typename: 'LibraryProgressConnection',
              edges: [
                {
                  __typename: 'LibraryProgressConnectionEdge',
                  cursor: RELINKED_PROGRESS_ID,
                  node: progressRow({
                    id: RELINKED_PROGRESS_ID,
                    document: RELINK_BOOK_ID,
                    book: {
                      __typename: 'Book',
                      id: RELINK_BOOK_ID,
                      title: 'Dune',
                      author: 'Frank Herbert',
                      hasCover: true,
                      thumbnailUrl: 'thumb.png',
                    },
                  }),
                },
              ],
              pageInfo: { __typename: 'PageInfo', hasNextPage: false, endCursor: null },
            },
          },
        },
      },
    };

    const useLinkProgressWithActiveList = () => ({
      list: useQuery(MyProgressListDocument, { variables: myProgressListVariables }),
      link: useLinkProgress(RELINK_BOOK_ID, LIBRARY_ID),
    });

    const { result, client } = renderHookWithApollo(useLinkProgressWithActiveList, [
      initialFetchMock,
      linkMock,
      refetchMock,
    ] as MockedResponse[]);

    await waitFor(() => expect(result.current?.list.data).toBeDefined());

    await act(async () => {
      await result.current?.link.link('doc-1', ORPHAN_PROGRESS_ID);
    });

    await waitFor(() => {
      const cached = client.cache.readQuery({
        query: MyProgressListDocument,
        variables: myProgressListVariables,
      });
      const edges = cached?.node?.__typename === 'Library' ? cached.node.progress.edges : undefined;
      expect(edges).toHaveLength(1);
    });

    const cached = client.cache.readQuery({
      query: MyProgressListDocument,
      variables: myProgressListVariables,
    });
    const edges = cached?.node?.__typename === 'Library' ? cached.node.progress.edges : undefined;
    expect(edges?.[0]?.node.id).toBe(RELINKED_PROGRESS_ID);
    const row = useFragment(ProgressRowFragment, edges?.[0]?.node);
    expect(row?.book?.id).toBe(RELINK_BOOK_ID);
  });

  it('sets error and returns false when the mutation throws', async () => {
    const { result } = renderHookWithApollo(
      () => useLinkProgress(BOOK_GLOBAL_ID, LIBRARY_ID),
      [
        {
          request: {
            query: BookLinkDocumentDocument,
            variables: { id: BOOK_GLOBAL_ID, documentId: 'doc-1' },
          },
          error: new Error('Network error'),
        },
      ]
    );

    const ok = await act(() => result.current!.link('doc-1', ORPHAN_PROGRESS_ID));

    expect(ok).toBe(false);
    expect(result.current?.error).toBe('Network error');
  });
});
