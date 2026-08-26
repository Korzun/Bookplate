import type { NormalizedCacheObject } from '@apollo/client';
import type { MockedResponse } from '@apollo/client/testing';
import { act, waitFor } from '@testing-library/react';
import { describe, expect, it } from 'vitest';

import { BookEditFormFragment } from '~/component/book-edit-form';
import { makeFragmentData } from '~/gql';
import type {
  BookResolvePendingFixMutation,
  BookResolvePendingFixMutationVariables,
  LibraryEntriesQueryVariables,
} from '~/gql/graphql';
import { BookResolvePendingFixDocument } from '~/graphql/upload';
import { BookEditDocument } from '~/page/book-edit';
import { LibraryEntriesDocument } from '~/page/library';
import { renderHookWithApollo } from '~/test-utils';

import { useFixActions } from './use-fix-actions';

const BOOK_GID = 'BOOK-1';
/** The id `BOOK_GID` rotates INTO on a successful ACCEPT/UNDO: both re-import
 * the rewritten EPUB through `applyEpubChanges`, which mints a new
 * content-hash book id (`resolve-pending-fix.ts`). */
const NEW_BOOK_GID = 'BOOK-2';
const LIBRARY_ID = 'LIB-1';

// Matches `use-library-entries.ts`'s `PAGE_SIZE` default and its
// `filter: undefined` when no filter is applied — the exact variables the
// live grid reads `Library.entries` with.
const ENTRIES_VARS: LibraryEntriesQueryVariables = {
  libraryId: LIBRARY_ID,
  first: 20,
  filter: undefined,
};

// Deliberately UNANNOTATED — see `use-scan-library.test.tsx`'s identical
// `seededBook` comment: `LibraryEntriesQuery`'s `Book` node member is
// masked, so an explicitly typed literal here fails `tsc`'s excess-property
// check.
const seededBook = {
  __typename: 'Book' as const,
  id: BOOK_GID,
  title: 'Dune',
  author: 'Frank Herbert',
  seriesIndex: 0,
  hasCover: false,
  thumbnailUrl: '',
  progress: null,
};

const seedLibraryEntries = (client: ReturnType<typeof renderHookWithApollo>['client']) =>
  client.writeQuery({
    query: LibraryEntriesDocument,
    variables: ENTRIES_VARS,
    data: {
      __typename: 'Query',
      node: {
        __typename: 'Library',
        id: LIBRARY_ID,
        entries: {
          __typename: 'LibraryEntriesConnection',
          edges: [{ __typename: 'LibraryEntriesConnectionEdge', cursor: 'c1', node: seededBook }],
          pageInfo: { __typename: 'PageInfo', hasNextPage: false, endCursor: null },
        },
      },
    },
  });

const readEntries = (client: ReturnType<typeof renderHookWithApollo>['client']) =>
  client.cache.readQuery({ query: LibraryEntriesDocument, variables: ENTRIES_VARS });

const okPayload = (bookId: string = BOOK_GID) => ({
  __typename: 'BookResolvePendingFixPayload' as const,
  book: { __typename: 'Book' as const, id: bookId, title: 'Dune', author: 'Frank Herbert' },
  library: { __typename: 'Library' as const, id: LIBRARY_ID, pendingFixes: [] },
});

/** Seeds a pre-accept `Book:<id>` entity through the same document
 * `page/book-edit` reads, so the eviction assertions below prove something:
 * without a pre-existing entity `not.toContain` would pass whether or not
 * the hand-written `update` ever ran. Seeding it through `Library.book(id:)`
 * (rather than, say, a grid edge) also reproduces the exact reason
 * `cache.gc()` alone is NOT enough — that field keeps a REFERENCE to the old
 * entity alive, so the orphan is never collected and must be evicted by id.
 * Mirrors `use-update-book-metadata.test.tsx`'s `seedBook`. */
const seedBook = (client: ReturnType<typeof renderHookWithApollo>['client'], id: string) =>
  client.writeQuery({
    query: BookEditDocument,
    variables: { libraryId: LIBRARY_ID, bookId: id },
    data: {
      __typename: 'Query',
      node: {
        __typename: 'Library',
        id: LIBRARY_ID,
        book: {
          __typename: 'Book',
          id,
          validation: null,
          pendingFix: null,
          // The form's own fields ride in through the colocated fragment, the
          // sanctioned cast from a concrete shape to the masked one.
          ...makeFragmentData(
            {
              __typename: 'Book',
              id,
              title: 'Dune',
              titleSort: 'Dune',
              author: 'Herbert',
              authorSort: 'Herbert, Frank',
              description: '',
              publisher: '',
              publishDate: '',
              seriesIndex: 0,
              subjects: [],
              series: null,
              identifiers: [],
            },
            BookEditFormFragment
          ),
        },
      },
    },
  });

type ResolveMock = MockedResponse<
  BookResolvePendingFixMutation,
  BookResolvePendingFixMutationVariables
>;

const acceptOneFixMock: ResolveMock = {
  request: {
    query: BookResolvePendingFixDocument,
    variables: {
      id: BOOK_GID,
      action: 'ACCEPT',
      fixes: [{ field: 'title', kind: 'replace', from: 'Old' }],
    },
  },
  result: { data: { __typename: 'Mutation', bookResolvePendingFix: okPayload() } },
};

// Keyed to the bulk-action variables — no `fixes` at all, matching what
// `acceptFixes(BOOK_GID)` (no second argument) actually sends. This proves
// the bulk path resolves against a mock shaped that way; it does NOT prove
// the hook would fail against a mock expecting `fixes: undefined` instead —
// `MockedResponse` variable matching treats an absent key and an explicit
// `undefined` value as equal (see `use-fix-actions.ts`'s own doc comment),
// so no test here can tell those two forms apart.
const acceptAllMock: ResolveMock = {
  request: {
    query: BookResolvePendingFixDocument,
    variables: { id: BOOK_GID, action: 'ACCEPT' },
  },
  result: { data: { __typename: 'Mutation', bookResolvePendingFix: okPayload() } },
};

const dismissAllMock: ResolveMock = {
  request: {
    query: BookResolvePendingFixDocument,
    variables: { id: BOOK_GID, action: 'DISMISS' },
  },
  result: { data: { __typename: 'Mutation', bookResolvePendingFix: okPayload() } },
};

const undoMock: ResolveMock = {
  request: {
    query: BookResolvePendingFixDocument,
    variables: { id: BOOK_GID, action: 'UNDO' },
  },
  result: { data: { __typename: 'Mutation', bookResolvePendingFix: okPayload() } },
};

const clearMock: ResolveMock = {
  request: {
    query: BookResolvePendingFixDocument,
    variables: { id: BOOK_GID, action: 'CLEAR' },
  },
  result: { data: { __typename: 'Mutation', bookResolvePendingFix: okPayload() } },
};

/** What a real ACCEPT returns: the book id has ROTATED. */
const acceptRotatingMock: ResolveMock = {
  request: {
    query: BookResolvePendingFixDocument,
    variables: { id: BOOK_GID, action: 'ACCEPT' },
  },
  result: { data: { __typename: 'Mutation', bookResolvePendingFix: okPayload(NEW_BOOK_GID) } },
};

/** The UNDO of an apply-snapshot rotates the id for the same reason. */
const undoRotatingMock: ResolveMock = {
  request: {
    query: BookResolvePendingFixDocument,
    variables: { id: BOOK_GID, action: 'UNDO' },
  },
  result: { data: { __typename: 'Mutation', bookResolvePendingFix: okPayload(NEW_BOOK_GID) } },
};

const acceptCollisionMock: ResolveMock = {
  request: {
    query: BookResolvePendingFixDocument,
    variables: { id: BOOK_GID, action: 'ACCEPT' },
  },
  result: {
    data: {
      __typename: 'Mutation',
      bookResolvePendingFix: {
        __typename: 'BookHashCollisionError',
        message: 'a book with that content already exists',
      },
    },
  },
};

describe('useFixActions', () => {
  it('accepts a single named fix', async () => {
    const { result } = renderHookWithApollo(() => useFixActions(), [acceptOneFixMock]);

    await expect(
      result.current?.acceptFixes(BOOK_GID, [{ field: 'title', kind: 'replace', from: 'Old' }])
    ).resolves.toMatchObject({ ok: true });
  });

  it('reports a typed error as false and surfaces its message', async () => {
    const { result } = renderHookWithApollo(() => useFixActions(), [acceptCollisionMock]);

    await expect(result.current?.acceptFixes(BOOK_GID)).resolves.toMatchObject({ ok: false });
    await waitFor(() =>
      expect(result.current?.error).toBe('a book with that content already exists')
    );
  });

  // Covers the bulk path: calling `acceptFixes` with no `fixes` argument
  // resolves against `acceptAllMock`, whose variables carry no `fixes` key.
  // This does NOT prove the hook omits the key rather than sending it as
  // `undefined` — see `acceptAllMock`'s own comment above for why no test
  // in this file can draw that distinction.
  it('resolves the bulk action when no fixes are named', async () => {
    const { result } = renderHookWithApollo(() => useFixActions(), [acceptAllMock]);

    await expect(result.current?.acceptFixes(BOOK_GID)).resolves.toMatchObject({ ok: true });
  });

  it('resolves the dismiss action when no fixes are named', async () => {
    const { result } = renderHookWithApollo(() => useFixActions(), [dismissAllMock]);

    await expect(result.current?.dismissFixes(BOOK_GID)).resolves.toMatchObject({ ok: true });
  });

  it('sends the UNDO action', async () => {
    const { result } = renderHookWithApollo(() => useFixActions(), [undoMock]);

    await expect(result.current?.undoFixes(BOOK_GID)).resolves.toMatchObject({ ok: true });
  });

  it('sends the CLEAR action', async () => {
    const { result } = renderHookWithApollo(() => useFixActions(), [clearMock]);

    await expect(result.current?.clearFixes(BOOK_GID)).resolves.toMatchObject({ ok: true });
  });

  it('reports a network failure as false and surfaces its message', async () => {
    const { result } = renderHookWithApollo(
      () => useFixActions(),
      [
        {
          request: {
            query: BookResolvePendingFixDocument,
            variables: { id: BOOK_GID, action: 'CLEAR' },
          },
          error: new Error('network down'),
        },
      ]
    );

    await expect(result.current?.clearFixes(BOOK_GID)).resolves.toMatchObject({ ok: false });
    await waitFor(() => expect(result.current?.error).toBe('network down'));
  });

  // ACCEPT/UNDO rewrite the EPUB and change the fields the grid sorts and
  // filters on, so both move a book's position in `Library.entries` — a
  // move the mutation payload cannot express. DISMISS/CLEAR below prove the
  // OTHER half: they touch only the pending-fix row, already reconciled by
  // the payload's own `library { pendingFixes }` selection, so they must
  // NOT evict anything.
  it('evicts the LibraryEntries connection on ACCEPT', async () => {
    const { result, client } = renderHookWithApollo(() => useFixActions(), [acceptAllMock]);
    act(() => seedLibraryEntries(client));
    expect(readEntries(client)).not.toBeNull();

    await expect(result.current?.acceptFixes(BOOK_GID)).resolves.toMatchObject({ ok: true });

    expect(readEntries(client)).toBeNull();
  });

  it('evicts the LibraryEntries connection on UNDO', async () => {
    const { result, client } = renderHookWithApollo(() => useFixActions(), [undoMock]);
    act(() => seedLibraryEntries(client));
    expect(readEntries(client)).not.toBeNull();

    await expect(result.current?.undoFixes(BOOK_GID)).resolves.toMatchObject({ ok: true });

    expect(readEntries(client)).toBeNull();
  });

  it('leaves the LibraryEntries connection alone on DISMISS', async () => {
    const { result, client } = renderHookWithApollo(() => useFixActions(), [dismissAllMock]);
    act(() => seedLibraryEntries(client));
    expect(readEntries(client)).not.toBeNull();

    await expect(result.current?.dismissFixes(BOOK_GID)).resolves.toMatchObject({ ok: true });

    expect(readEntries(client)).not.toBeNull();
  });

  it('leaves the LibraryEntries connection alone on CLEAR', async () => {
    const { result, client } = renderHookWithApollo(() => useFixActions(), [clearMock]);
    act(() => seedLibraryEntries(client));
    expect(readEntries(client)).not.toBeNull();

    await expect(result.current?.clearFixes(BOOK_GID)).resolves.toMatchObject({ ok: true });

    expect(readEntries(client)).not.toBeNull();
  });

  // REGRESSION (whole-step review I-2). ACCEPT/UNDO both re-import the
  // rewritten EPUB, so the payload's `book.id` may differ from the `id`
  // argument. Normalization writes a brand-new `Book:<newId>` entity and
  // cannot know the old one described the same book, so the pre-accept
  // entity would otherwise linger with stale metadata — and `cache.gc()`
  // cannot collect it while a `Library.book(id:)` field from a prior /book
  // or /book-edit visit still references it. Same behaviour
  // `use-update-book-metadata.ts` and `use-regen-chapters.ts` already have
  // on the identical `applyEpubChanges` path.
  it('evicts the old Book entity when ACCEPT rotates the id', async () => {
    const { result, client } = renderHookWithApollo(() => useFixActions(), [acceptRotatingMock]);
    act(() => seedBook(client, BOOK_GID));
    expect((client.cache.extract() as NormalizedCacheObject)[`Book:${BOOK_GID}`]).toBeDefined();

    await expect(result.current?.acceptFixes(BOOK_GID)).resolves.toMatchObject({ ok: true });

    expect(Object.keys(client.cache.extract() as NormalizedCacheObject)).not.toContain(
      `Book:${BOOK_GID}`
    );
  });

  it('evicts the old Book entity when UNDO rotates the id', async () => {
    const { result, client } = renderHookWithApollo(() => useFixActions(), [undoRotatingMock]);
    act(() => seedBook(client, BOOK_GID));
    expect((client.cache.extract() as NormalizedCacheObject)[`Book:${BOOK_GID}`]).toBeDefined();

    await expect(result.current?.undoFixes(BOOK_GID)).resolves.toMatchObject({ ok: true });

    expect(Object.keys(client.cache.extract() as NormalizedCacheObject)).not.toContain(
      `Book:${BOOK_GID}`
    );
  });

  // The other half of the branch: a no-op ACCEPT (nothing actionable) returns
  // the SAME book id, and the entity must survive — evicting it would throw
  // away metadata nothing has replaced.
  it('keeps the Book entity when ACCEPT does not rotate the id', async () => {
    const { result, client } = renderHookWithApollo(() => useFixActions(), [acceptAllMock]);
    act(() => seedBook(client, BOOK_GID));

    await expect(result.current?.acceptFixes(BOOK_GID)).resolves.toMatchObject({ ok: true });

    expect((client.cache.extract() as NormalizedCacheObject)[`Book:${BOOK_GID}`]).toBeDefined();
  });

  // The rotated id is what the queue re-keys its live transport item on
  // (whole-step review C-1) — without it the merge join breaks and the same
  // book renders as two cards.
  it('reports the resulting book id so callers can follow a rotation', async () => {
    const { result } = renderHookWithApollo(() => useFixActions(), [acceptRotatingMock]);

    await expect(result.current?.acceptFixes(BOOK_GID)).resolves.toEqual({
      ok: true,
      bookGlobalId: NEW_BOOK_GID,
    });
  });

  // A typed error member (no `library` payload to evict from) must not
  // crash `update` — it should just no-op.
  it('does not evict on a failed ACCEPT (typed error, no payload)', async () => {
    const { result, client } = renderHookWithApollo(() => useFixActions(), [acceptCollisionMock]);
    act(() => seedLibraryEntries(client));
    expect(readEntries(client)).not.toBeNull();

    await expect(result.current?.acceptFixes(BOOK_GID)).resolves.toMatchObject({ ok: false });

    expect(readEntries(client)).not.toBeNull();
  });
});
