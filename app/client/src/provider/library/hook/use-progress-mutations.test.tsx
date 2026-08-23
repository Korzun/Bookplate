import type { ApolloClient, NormalizedCacheObject } from '@apollo/client';
import type { MockedResponse } from '@apollo/client/testing';
import { act, waitFor } from '@testing-library/react';
import { describe, expect, it } from 'vitest';

import { useFragment } from '~/gql';
import type {
  BookLinkDocumentMutation,
  BookLinkDocumentMutationVariables,
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
  }> = {}
): ProgressNode => ({
  __typename: 'Progress',
  id: overrides.id ?? 'progress-existing',
  document: overrides.document ?? 'existing-doc-hash-000000000000',
  percentage: overrides.percentage ?? 0.2,
  currentChapter: overrides.currentChapter ?? 1,
  device: overrides.device ?? 'Kobo',
  timestamp: overrides.timestamp ?? '2026-01-01T00:00:00.000Z',
  book: null,
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

const progressSetSuccessMock = (args: {
  document: string;
  progressId: string;
  currentChapter: number;
  percentage: number;
  userId?: string;
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
        }),
        library: { __typename: 'Library', id: LIBRARY_ID },
      },
    },
  },
});

const progressDeleteSuccessMock = (
  progressId: string
): MockedResponse<ProgressDeleteMutation, ProgressDeleteMutationVariables> => ({
  request: { query: ProgressDeleteDocument, variables: { id: progressId } },
  result: {
    data: {
      __typename: 'Mutation',
      progressDelete: {
        __typename: 'ProgressDeletePayload',
        deletedId: progressId,
        library: { __typename: 'Library', id: LIBRARY_ID },
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

  it('returns initial linking/error state', () => {
    const { result } = renderHookWithApollo(() => useLinkProgress(BOOK_GLOBAL_ID), []);
    expect(typeof result.current?.link).toBe('function');
    expect(result.current?.linking).toBe(false);
    expect(result.current?.error).toBeUndefined();
  });

  it('maps DocumentAlreadyLinkedError to an error message', async () => {
    const { result } = renderHookWithApollo(
      () => useLinkProgress(BOOK_GLOBAL_ID),
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

    const ok = await act(() => result.current!.link('doc-1'));

    expect(ok).toBe(false);
    expect(result.current?.error).toBe('This document is already linked to another book');
  });

  it('does not fire a second mutation while one is in flight', async () => {
    const successData: BookLinkDocumentMutation = {
      __typename: 'Mutation',
      bookLinkDocument: {
        __typename: 'BookLinkDocumentPayload',
        book: { __typename: 'Book', id: BOOK_GLOBAL_ID, lineage: [] },
      },
    };
    const mock: MockedResponse<BookLinkDocumentMutation, BookLinkDocumentMutationVariables> = {
      request: {
        query: BookLinkDocumentDocument,
        variables: { id: BOOK_GLOBAL_ID, documentId: 'doc-1' },
      },
      result: { data: successData },
      delay: 20,
    };

    const { result } = renderHookWithApollo(() => useLinkProgress(BOOK_GLOBAL_ID), [mock]);

    act(() => {
      void result.current?.link('doc-1');
    });
    await waitFor(() => expect(result.current?.linking).toBe(true));

    const secondCallOk = await act(() => result.current!.link('doc-1'));
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
    const successData: BookLinkDocumentMutation = {
      __typename: 'Mutation',
      bookLinkDocument: {
        __typename: 'BookLinkDocumentPayload',
        book: {
          __typename: 'Book',
          id: BOOK_GLOBAL_ID,
          lineage: [
            { __typename: 'LinkedDocument', oldId: 'doc-1', newId: BOOK_GLOBAL_ID, type: 'EDIT' },
          ],
        },
      },
    };
    const mock: MockedResponse<BookLinkDocumentMutation, BookLinkDocumentMutationVariables> = {
      request: {
        query: BookLinkDocumentDocument,
        variables: { id: BOOK_GLOBAL_ID, documentId: 'doc-1' },
      },
      result: { data: successData },
    };

    const { result, client } = renderHookWithApollo(() => useLinkProgress(BOOK_GLOBAL_ID), [mock]);

    await act(async () => {
      await result.current?.link('doc-1');
    });

    expect(result.current?.error).toBeUndefined();
    const extracted = client.cache.extract() as NormalizedCacheObject;
    const bookEntity = extracted[`Book:${BOOK_GLOBAL_ID}`] as { lineage?: unknown[] } | undefined;
    expect(bookEntity?.lineage).toEqual([
      { __typename: 'LinkedDocument', oldId: 'doc-1', newId: BOOK_GLOBAL_ID, type: 'EDIT' },
    ]);
  });

  it('sets error and returns false when the mutation throws', async () => {
    const { result } = renderHookWithApollo(
      () => useLinkProgress(BOOK_GLOBAL_ID),
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

    const ok = await act(() => result.current!.link('doc-1'));

    expect(ok).toBe(false);
    expect(result.current?.error).toBe('Network error');
  });
});
