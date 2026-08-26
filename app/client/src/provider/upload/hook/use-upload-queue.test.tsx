import type { NormalizedCacheObject } from '@apollo/client';
import type { MockedResponse } from '@apollo/client/testing';
import { act, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { BookEditFormFragment } from '~/component/book-edit-form';
import { makeFragmentData } from '~/gql';
import type {
  BookResolvePendingFixMutation,
  BookResolvePendingFixMutationVariables,
  LibraryEntriesQuery,
  LibraryEntriesQueryVariables,
  LibraryPendingFixesQuery,
  LibraryPendingFixesQueryVariables,
  UploadConfigQuery,
  ViewerBootstrapQuery,
} from '~/gql/graphql';
import {
  BookResolvePendingFixDocument,
  LibraryPendingFixesDocument,
  UploadConfigDocument,
} from '~/graphql/upload';
import { ViewerBootstrapDocument } from '~/graphql/viewer-bootstrap';
import { BookEditDocument } from '~/page/book-edit';
import { LibraryEntriesDocument } from '~/page/library';
import { useCurrentLibraryId } from '~/provider/library-target';
import { renderHookWithApollo } from '~/test-utils';

import { fixKey, fixKeyOf, useUploadQueueEngine } from './use-upload-queue';

const LIBRARY_ID = 'TGlicmFyeTox';
const BOOK_GID = 'Qm9vazox';
/** The id `BOOK_GID` rotates INTO after a successful `ACCEPT` — the server
 * re-imports the rewritten EPUB, mints a new content-hash book id, and
 * re-keys the `PendingFix` row (and therefore `PendingFix.id`) under it. See
 * `resolve-pending-fix.ts`'s `upsertPendingFix(owner, outcome.ok.id, …)` and
 * `resolve-pending-fix.test.ts`'s "the row lives under the new id". */
const ROTATED_BOOK_GID = 'Qm9vazoy';
// Matches `page/library/index.tsx`'s own `PAGE_SIZE` constant (20) and its
// `filter: undefined` when no filter is applied — the exact variables the
// live grid reads `Library.entries` with. (Named `use-library-entries.ts`
// here until the end-of-project sweep; Task 5 deleted that hook and moved
// the constant onto the page.)
const ENTRIES_VARS: LibraryEntriesQueryVariables = {
  libraryId: LIBRARY_ID,
  first: 20,
  filter: undefined,
};

// ── XHR mock ─────────────────────────────────────────────────────────────────
// Same stub `use-upload-transport.test.tsx` uses — this file drives the same
// XHR machinery through the merged engine instead of the transport hook alone.

let xhrInstances: XHRMock[];

class XHRMock {
  upload = { onprogress: null as ((e: ProgressEvent) => void) | null };
  onload: ((e: Event) => void) | null = null;
  onerror: (() => void) | null = null;
  status = 200;
  responseText = '{}';
  open = vi.fn();
  setRequestHeader = vi.fn();
  send = vi.fn();
  abort = vi.fn();
  constructor() {
    xhrInstances.push(this);
  }
}

const fileListOf = (...files: File[]): FileList => files as unknown as FileList;

// ── GraphQL mocks ────────────────────────────────────────────────────────────

const viewerBootstrapMock: MockedResponse<ViewerBootstrapQuery> = {
  request: { query: ViewerBootstrapDocument },
  result: {
    data: {
      __typename: 'Query',
      viewer: {
        __typename: 'Viewer',
        username: 'u',
        isAdmin: false,
        mustChangePassword: false,
        user: { __typename: 'User', id: 'VXNlcjox' },
        library: { __typename: 'Library', id: LIBRARY_ID },
      },
    },
  },
};

const configMock: MockedResponse<UploadConfigQuery> = {
  request: { query: UploadConfigDocument },
  result: {
    data: { __typename: 'Query', config: { __typename: 'Config', maxConcurrentUploads: 3 } },
  },
};

const metadataFixDto = (field: string, kind: string, from: string, to: string) => ({
  __typename: 'MetadataFix' as const,
  field,
  kind,
  from,
  to,
  reason: null,
  fromChips: null,
  toChips: null,
  changes: null,
});

const pendingFixRow = (bookGid: string, fixId = `FIX-${bookGid}`) => ({
  __typename: 'PendingFix' as const,
  id: fixId,
  fileName: 'dune.epub',
  fileSize: 1000,
  book: { __typename: 'Book' as const, id: bookGid, title: 'Dune', author: 'Frank Herbert' },
  state: {
    __typename: 'PendingFixState' as const,
    autoFixes: [],
    appliedFixes: [],
    proposals: [metadataFixDto('title', 'replace', 'Old', 'Dune')],
    undo: null,
  },
});

type PendingFixesMock = MockedResponse<LibraryPendingFixesQuery, LibraryPendingFixesQueryVariables>;

const pendingFixesMockFor = (bookGid: string, fixId?: string): PendingFixesMock => ({
  request: { query: LibraryPendingFixesDocument, variables: { libraryId: LIBRARY_ID } },
  result: {
    data: {
      __typename: 'Query',
      node: {
        __typename: 'Library',
        id: LIBRARY_ID,
        pendingFixes: [pendingFixRow(bookGid, fixId)],
      },
    },
  },
});

// Deliberately UNANNOTATED (unlike `entriesMock` below): `node`'s `Book`
// member is masked (its fields sit behind `BookRowFragment`'s
// `$fragmentRefs`, per `LibraryEntriesQuery`'s own generated type), so an
// explicit `LibraryEntryNode`-typed literal fails `tsc`'s excess-property
// check on `id`/`title`/etc. Assigning this UNTYPED, inferred object into
// `entriesMock`'s `node` field below sidesteps that check entirely — excess
// properties are only flagged on a literal checked directly against its
// target type, not on a pre-inferred variable reference. Same idiom
// `page/book/index.test.tsx`'s `standaloneRow` uses.
const seededBookNode = {
  __typename: 'Book' as const,
  id: 'SEEDED-BOOK',
  title: 'Seeded',
  author: 'Someone',
  seriesIndex: 0,
  hasCover: false,
  thumbnailUrl: '',
  progress: null,
};

const entriesMock: MockedResponse<LibraryEntriesQuery, LibraryEntriesQueryVariables> = {
  request: { query: LibraryEntriesDocument, variables: ENTRIES_VARS },
  result: {
    data: {
      __typename: 'Query',
      node: {
        __typename: 'Library',
        id: LIBRARY_ID,
        entries: {
          __typename: 'LibraryEntriesConnection',
          edges: [
            { __typename: 'LibraryEntriesConnectionEdge', cursor: 'c1', node: seededBookNode },
          ],
          pageInfo: { __typename: 'PageInfo', hasNextPage: false, endCursor: null },
        },
      },
    },
  },
};

const emptyPendingFixesMock: PendingFixesMock = {
  request: { query: LibraryPendingFixesDocument, variables: { libraryId: LIBRARY_ID } },
  result: {
    data: {
      __typename: 'Query',
      node: { __typename: 'Library', id: LIBRARY_ID, pendingFixes: [] },
    },
  },
};

type ResolveMock = MockedResponse<
  BookResolvePendingFixMutation,
  BookResolvePendingFixMutationVariables
>;

const resolveMock = (
  action: BookResolvePendingFixMutationVariables['action'],
  fixes: BookResolvePendingFixMutationVariables['fixes'] | undefined,
  afterRows: ReturnType<typeof pendingFixRow>[]
): ResolveMock => ({
  request: {
    query: BookResolvePendingFixDocument,
    variables: fixes === undefined ? { id: BOOK_GID, action } : { id: BOOK_GID, action, fixes },
  },
  result: {
    data: {
      __typename: 'Mutation',
      bookResolvePendingFix: {
        __typename: 'BookResolvePendingFixPayload',
        book: { __typename: 'Book', id: BOOK_GID, title: 'Dune', author: 'Frank Herbert' },
        library: { __typename: 'Library', id: LIBRARY_ID, pendingFixes: afterRows },
      },
    },
  },
});

/** The row the server really returns after an `ACCEPT`: re-keyed under the
 * ROTATED book id (so both `PendingFix.id` and `book.id` differ from the
 * pre-accept row), with the applied proposal moved into `appliedFixes` and an
 * `undo` armed. `resolveMock` above deliberately keeps its unrotated,
 * `afterRows: []` shape — several tests only care that an action resolves
 * `true` — so this counterfactual-free variant lives on its own. */
const rowAfterAccept = {
  ...pendingFixRow(ROTATED_BOOK_GID, `FIX-${ROTATED_BOOK_GID}`),
  state: {
    __typename: 'PendingFixState' as const,
    autoFixes: [],
    appliedFixes: [metadataFixDto('title', 'replace', 'Old', 'Dune')],
    proposals: [],
    undo: { __typename: 'UndoSnapshot' as const, kind: 'APPLY' as const },
  },
};

/** A REALISTIC bulk `ACCEPT`: the payload's `book.id` is the rotated id, and
 * `library.pendingFixes` carries the row re-keyed under it. */
const rotatingAcceptMock: ResolveMock = {
  request: {
    query: BookResolvePendingFixDocument,
    variables: { id: BOOK_GID, action: 'ACCEPT' },
  },
  result: {
    data: {
      __typename: 'Mutation',
      bookResolvePendingFix: {
        __typename: 'BookResolvePendingFixPayload',
        book: {
          __typename: 'Book',
          id: ROTATED_BOOK_GID,
          title: 'Dune',
          author: 'Frank Herbert',
        },
        library: { __typename: 'Library', id: LIBRARY_ID, pendingFixes: [rowAfterAccept] },
      },
    },
  },
};

/** The UNDO of an apply-snapshot rotates the id for the same reason an
 * ACCEPT does — it re-imports the reverted EPUB through `applyEpubChanges`. */
const rotatingUndoMock: ResolveMock = {
  request: {
    query: BookResolvePendingFixDocument,
    variables: { id: BOOK_GID, action: 'UNDO' },
  },
  result: {
    data: {
      __typename: 'Mutation',
      bookResolvePendingFix: {
        __typename: 'BookResolvePendingFixPayload',
        book: {
          __typename: 'Book',
          id: ROTATED_BOOK_GID,
          title: 'Dune',
          author: 'Frank Herbert',
        },
        library: { __typename: 'Library', id: LIBRARY_ID, pendingFixes: [] },
      },
    },
  },
};

/** A TYPED error member: no payload at all, so `update` has nothing to read
 * a `library` id off. It must no-op rather than throw. */
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

const acceptNetworkErrorMock: ResolveMock = {
  request: {
    query: BookResolvePendingFixDocument,
    variables: { id: BOOK_GID, action: 'ACCEPT' },
  },
  error: new Error('network down'),
};

/** An ADMIN viewer with no library target selected, so `useCurrentLibraryId`
 * resolves `undefined` and the pending-fix read must SKIP. */
const adminViewerBootstrapMock: MockedResponse<ViewerBootstrapQuery> = {
  request: { query: ViewerBootstrapDocument },
  result: {
    data: {
      __typename: 'Query',
      viewer: {
        __typename: 'Viewer',
        username: 'admin',
        isAdmin: true,
        mustChangePassword: false,
        user: null,
        library: null,
      },
    },
  },
};

/**
 * A `LibraryPendingFixes` mock that COUNTS every request MockLink routes to
 * it, through the VARIABLE MATCHER rather than a `result` function.
 *
 * The distinction is Ruling Q and it is load-bearing for the skip test below:
 * a `result`-as-function counter increments on DELIVERY, after MockLink's
 * delay, so an eager read can leak past a `waitFor` purely on timing. The
 * matcher runs SYNCHRONOUSLY inside `MockLink.request()`, before any timer
 * (`@apollo/client/testing/core/mocking/mockLink.js`, the
 * `typeof variables === 'function'` branch of its `mocks.findIndex`).
 *
 * **In Apollo Client v4 the matcher is `request.variables` given a FUNCTION**
 * — there is no top-level `variableMatcher` key. A `variableMatcher` property
 * is silently ignored: the mock then matches on `request.variables` being
 * absent, the callback never runs, and a counter hung off it stays at zero no
 * matter what fires. That is a FAIL-OPEN test, and it is how this helper was
 * first written here; it was caught by proving the counter could not reach a
 * non-zero value even when the read DID fire.
 *
 * The increment happens BEFORE the `return` on purpose: a read that fires
 * with the WRONG variables (e.g. `libraryId: ''`) must still be counted, or
 * the assertion would pass on a mismatch.
 */
const countingPendingFixesMock = (counter: { n: number }): PendingFixesMock => ({
  request: {
    query: LibraryPendingFixesDocument,
    variables: (variables) => {
      counter.n += 1;
      return variables.libraryId === LIBRARY_ID;
    },
  },
  maxUsageCount: Number.POSITIVE_INFINITY,
  result: {
    data: {
      __typename: 'Query',
      node: { __typename: 'Library', id: LIBRARY_ID, pendingFixes: [] },
    },
  },
});

/** `LibraryPendingFixes` returning an arbitrary row list — the multi-row form
 * `pendingFixesMockFor` (single row) does not cover. */
const pendingFixesMockRows = (rows: ReturnType<typeof pendingFixRow>[]): PendingFixesMock => ({
  request: { query: LibraryPendingFixesDocument, variables: { libraryId: LIBRARY_ID } },
  result: {
    data: {
      __typename: 'Query',
      node: { __typename: 'Library', id: LIBRARY_ID, pendingFixes: rows },
    },
  },
});

// ── Cache seeding ────────────────────────────────────────────────────────────

type TestClient = ReturnType<typeof renderHookWithApollo>['client'];

const seedLibraryEntries = (client: TestClient) =>
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
          edges: [
            { __typename: 'LibraryEntriesConnectionEdge', cursor: 'c1', node: seededBookNode },
          ],
          pageInfo: { __typename: 'PageInfo', hasNextPage: false, endCursor: null },
        },
      },
    },
  });

const readEntries = (client: TestClient) =>
  client.cache.readQuery({ query: LibraryEntriesDocument, variables: ENTRIES_VARS });

/** Seeds a pre-accept `Book:<id>` entity through the same document
 * `page/book-edit` reads, so the eviction assertions below prove something:
 * without a pre-existing entity `not.toContain` would pass whether or not the
 * engine's `update` ever ran. Seeding it through `Library.book(id:)` (rather
 * than, say, a grid edge or the pending-fix row's own `book`) also reproduces
 * the exact reason `cache.gc()` alone is NOT enough — that field keeps a
 * REFERENCE to the old entity alive, so the orphan is never collected and
 * must be evicted by id. Mirrors `component/book-edit-form/index.test.tsx`'s
 * `seedBook`. */
const seedBook = (client: TestClient, id: string) =>
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

// ── Harness ──────────────────────────────────────────────────────────────────

/** `renderHookWithApollo`'s own `mocks` parameter is generic over a SINGLE
 * `TData`, inferred from the array literal passed at each call site — every
 * test here mixes several differently-typed mocks (viewer bootstrap, pending
 * fixes, config, resolve) in one array, which a bare positional literal
 * can't satisfy (TS unifies to one arbitrary member and rejects the rest).
 * Routing through this explicitly `MockedResponse[]`-typed (the loose
 * default-generic form) wrapper sidesteps that inference, matching how
 * `renderWithApollo`'s own `{ mocks: MockedResponse[] }` option avoids it. */
function renderEngine(mocks: MockedResponse[]) {
  return renderHookWithApollo(() => useUploadQueueEngine(), mocks);
}

/** Drives a queued upload's XHR to completion, resolving with `bookGid` as
 * the response's `globalId` — the point where a live transport item and a
 * server pending-fix row for the same book can coexist. */
async function completeTheUploadWith(bookGid: string, xhrIndex = 0) {
  await waitFor(() => expect(xhrInstances[xhrIndex]?.open).toHaveBeenCalled());
  xhrInstances[xhrIndex]!.status = 200;
  xhrInstances[xhrIndex]!.responseText = JSON.stringify({
    results: [
      {
        filename: 'dune.epub',
        bookId: 'raw-content-hash-must-not-appear',
        globalId: bookGid,
        applied: [],
        proposals: [],
      },
    ],
  });
  await act(async () => {
    xhrInstances[xhrIndex]!.onload?.(new Event('load'));
    await Promise.resolve();
  });
}

beforeEach(() => {
  xhrInstances = [];
  vi.stubGlobal('XMLHttpRequest', XHRMock);
  vi.stubGlobal('fetch', vi.fn().mockResolvedValue({ ok: false, json: () => Promise.resolve({}) }));
});

afterEach(() => {
  vi.unstubAllGlobals();
});

// ── Tests ─────────────────────────────────────────────────────────────────────

describe('useUploadQueueEngine', () => {
  it('renders one row, not two, when a live upload and its server row describe the same book', async () => {
    const { result } = renderEngine([
      viewerBootstrapMock,
      pendingFixesMockFor(BOOK_GID),
      configMock,
    ]);

    // Let the seeded server row land first, matching a real mount.
    await waitFor(() => expect(result.current!.items).toHaveLength(1));

    act(() => {
      result.current!.addFiles(fileListOf(new File(['x'], 'dune.epub')));
    });
    await completeTheUploadWith(BOOK_GID);

    await waitFor(() => expect(result.current!.items).toHaveLength(1));
    expect(result.current!.items[0]!.bookGlobalId).toBe(BOOK_GID);
    expect(result.current!.items[0]!.proposals).toHaveLength(1); // from the server row
  });

  // REGRESSION (whole-step review C-1). `ACCEPT` re-imports the rewritten
  // EPUB, so the book id — and with it `PendingFix.id` — ROTATES. The live
  // transport item's `bookGlobalId` was written once, in `xhr.onload`, and
  // used to be frozen there: the merge join then matched nothing, the
  // re-keyed server row was emitted as a SECOND card for the same book, and
  // every action on the now-orphaned live card resolved `missing`.
  it('follows the book id when ACCEPT rotates it, keeping ONE card', async () => {
    const { result } = renderEngine([
      viewerBootstrapMock,
      pendingFixesMockFor(BOOK_GID),
      configMock,
      rotatingAcceptMock,
    ]);

    await waitFor(() => expect(result.current!.items).toHaveLength(1));

    act(() => {
      // A filename the SEEDED row can't have ('dune.epub') — so the
      // assertions below distinguish "the live item survived and was
      // remapped" from "the live item was orphaned and a seeded row took
      // its place".
      result.current!.addFiles(fileListOf(new File(['x'], 'live.epub')));
    });
    await completeTheUploadWith(BOOK_GID);
    await waitFor(() => expect(result.current!.items).toHaveLength(1));

    const itemId = result.current!.items[0]!.id;
    await act(async () => {
      await result.current!.applyAllProposals(itemId);
    });

    // Wait for the rotation to have landed ANYWHERE in the list (order-
    // independent: pre-fix it landed as an extra seeded row, post-fix it
    // lands on the live item) before asserting how many cards there are.
    await waitFor(() =>
      expect(result.current!.items.some((i) => i.bookGlobalId === ROTATED_BOOK_GID)).toBe(true)
    );
    expect(result.current!.items).toHaveLength(1);
    expect(result.current!.items[0]!.bookGlobalId).toBe(ROTATED_BOOK_GID);
    expect(result.current!.items[0]!.fileName).toBe('live.epub');
    expect(result.current!.items[0]!.appliedFixes).toHaveLength(1); // the re-keyed row joined
    expect(result.current!.items[0]!.undo).toEqual({ kind: 'apply' });
  });

  // Proves the `everSeen` guard in `mergeRow` is LOAD-BEARING, and pins down
  // what actually triggers it. During the accept above there is exactly one
  // render where the payload's re-keyed row list has landed but the remap
  // has not run yet: the live item still holds the PRE-accept id and matches
  // no row. Without the guard, that render falls back to the transport's
  // upload-time `proposals` — the very list the user just accepted — and
  // flashes them back onto the card. Captured across every render rather
  // than at a settled point, because the window is one render wide.
  it('never flashes the stale upload-time proposals back while an ACCEPT rotation lands', async () => {
    const seen: string[][] = [];
    const { result } = renderHookWithApollo(
      () => {
        const queue = useUploadQueueEngine();
        for (const item of queue.items) seen.push((item.proposals ?? []).map((p) => p.field));
        return queue;
      },
      [
        viewerBootstrapMock,
        pendingFixesMockFor(BOOK_GID),
        configMock,
        rotatingAcceptMock,
      ] as MockedResponse[]
    );

    await waitFor(() => expect(result.current!.items).toHaveLength(1));
    act(() => {
      result.current!.addFiles(fileListOf(new File(['x'], 'live.epub')));
    });

    // The upload's OWN response carries a proposal the SERVER row does not
    // ('publisher' vs the row's 'title'), so a fallback to the transport's
    // list is unmistakable in the capture below.
    await waitFor(() => expect(xhrInstances[0]?.open).toHaveBeenCalled());
    xhrInstances[0]!.status = 200;
    xhrInstances[0]!.responseText = JSON.stringify({
      results: [
        {
          filename: 'live.epub',
          globalId: BOOK_GID,
          applied: [],
          proposals: [{ field: 'publisher', kind: 'trim', from: ' P ', to: 'P', changes: {} }],
        },
      ],
    });
    await act(async () => {
      xhrInstances[0]!.onload?.(new Event('load'));
      await Promise.resolve();
    });
    await waitFor(() => expect(result.current!.items).toHaveLength(1));

    seen.length = 0; // only the accept's own renders matter
    const itemId = result.current!.items[0]!.id;
    await act(async () => {
      await result.current!.applyAllProposals(itemId);
    });
    await waitFor(() =>
      expect(result.current!.items.some((i) => i.bookGlobalId === ROTATED_BOOK_GID)).toBe(true)
    );

    expect(seen.flat()).not.toContain('publisher');
  });

  // DEFENSIVE / invariant test, not a regression test for observed server
  // behaviour: the real `bookResolvePendingFix` resolver always arms `undo`
  // on a successful ACCEPT/DISMISS, and `isLivePendingFix` keeps such a row
  // live in `Library.pendingFixes` for 7 days — so the server does NOT
  // actually return an empty `pendingFixes` list right after an ACCEPT the
  // way `resolveMock('ACCEPT', undefined, [])` below does. This mock is a
  // deliberately invariant-violating stand-in for the one path that
  // COULD, in theory, make a row vanish out from under a still-live
  // transport item (the 7-day TTL lapsing) — see `mergeRow`'s own doc
  // comment in `use-upload-queue.ts` for the full reachability analysis.
  // The assertion below is about what the CLIENT does if that ever
  // happens, not a claim that it happens today.
  it("defensively shows no proposals — not the upload response's stale ones — if a matched server row ever vanishes", async () => {
    // The upload's OWN response carries a DIFFERENT, non-empty proposal
    // (`author`) than the row's (`title`) — proving that IF the row vanishes
    // after "resolution" (per the mock above, not real server behaviour),
    // the merge shows nothing pending rather than falling back to this
    // stale upload-time list.
    const { result } = renderEngine([
      viewerBootstrapMock,
      pendingFixesMockFor(BOOK_GID),
      configMock,
      resolveMock('ACCEPT', undefined, []),
    ]);

    await waitFor(() => expect(result.current!.items).toHaveLength(1));

    act(() => {
      result.current!.addFiles(fileListOf(new File(['x'], 'dune.epub')));
    });
    await waitFor(() => expect(xhrInstances[0]?.open).toHaveBeenCalled());
    xhrInstances[0]!.status = 200;
    xhrInstances[0]!.responseText = JSON.stringify({
      results: [
        {
          filename: 'dune.epub',
          bookId: 'raw-content-hash-must-not-appear',
          globalId: BOOK_GID,
          applied: [],
          proposals: [{ field: 'author', kind: 'trim', from: ' F ', to: 'F', changes: {} }],
        },
      ],
    });
    await act(async () => {
      xhrInstances[0]!.onload?.(new Event('load'));
      await Promise.resolve();
    });

    await waitFor(() => expect(result.current!.items).toHaveLength(1));
    const itemId = result.current!.items[0]!.id;
    expect(result.current!.items[0]!.proposals?.[0]?.field).toBe('title'); // from the row, not the upload response

    await act(async () => {
      await result.current!.applyAllProposals(itemId);
    });

    await waitFor(() => expect(result.current!.items[0]!.proposals ?? []).toEqual([]));
  });

  it('keeps a server row that no live item matches', async () => {
    const { result } = renderEngine([
      viewerBootstrapMock,
      pendingFixesMockFor(BOOK_GID),
      configMock,
    ]);

    await waitFor(() => expect(result.current!.items).toHaveLength(1));
    expect(result.current!.items[0]!.status).toBe('done');
    expect(result.current!.items[0]!.bytesUploaded).toBe(result.current!.items[0]!.fileSize);
  });

  it('keeps a live item that has no server row (a clean upload with no fixes)', async () => {
    const { result } = renderEngine([viewerBootstrapMock, emptyPendingFixesMock, configMock]);

    await waitFor(() => expect(result.current!.items).toHaveLength(0));

    act(() => {
      result.current!.addFiles(fileListOf(new File(['x'], 'clean.epub')));
    });
    await completeTheUploadWith(BOOK_GID);

    await waitFor(() => expect(result.current!.items).toHaveLength(1));
    expect(result.current!.items[0]!.proposals ?? []).toEqual([]);
  });

  it('orders seeded rows before live rows, matching the old prepend order', async () => {
    const { result } = renderEngine([
      viewerBootstrapMock,
      pendingFixesMockFor('OTHER-BOOK'),
      configMock,
    ]);

    await waitFor(() => expect(result.current!.items).toHaveLength(1));

    act(() => {
      result.current!.addFiles(fileListOf(new File(['x'], 'new.epub')));
    });

    await waitFor(() => expect(result.current!.items).toHaveLength(2));
    // The reseeded server row (no live counterpart) comes first; the new
    // live upload comes after it.
    expect(result.current!.items[0]!.bookGlobalId).toBe('OTHER-BOOK');
    expect(result.current!.items[1]!.fileName).toBe('new.epub');
  });

  it("keys a seeded row on the server's PendingFix.id, not a synthetic stable id", async () => {
    const { result } = renderEngine([
      viewerBootstrapMock,
      pendingFixesMockFor(BOOK_GID, 'FIX-original'),
      configMock,
    ]);

    await waitFor(() => expect(result.current!.items).toHaveLength(1));
    expect(result.current!.items[0]!.id).toBe('FIX-original');
  });

  it('maps applyFix to acceptFixes with the fix triple, keyed on bookGlobalId', async () => {
    const { result } = renderEngine([
      viewerBootstrapMock,
      pendingFixesMockFor(BOOK_GID),
      configMock,
      resolveMock('ACCEPT', [{ field: 'title', kind: 'replace', from: 'Old' }], []),
    ]);

    await waitFor(() => expect(result.current!.items).toHaveLength(1));
    const itemId = result.current!.items[0]!.id;
    const fix = result.current!.items[0]!.proposals![0]!;

    await expect(result.current!.applyFix(itemId, fix)).resolves.toBe(true);
  });

  it('maps applyAllProposals to a fixes-less acceptFixes call', async () => {
    const { result } = renderEngine([
      viewerBootstrapMock,
      pendingFixesMockFor(BOOK_GID),
      configMock,
      resolveMock('ACCEPT', undefined, []),
    ]);

    await waitFor(() => expect(result.current!.items).toHaveLength(1));
    const itemId = result.current!.items[0]!.id;

    await expect(result.current!.applyAllProposals(itemId)).resolves.toBe(true);
  });

  it('dismissFix resolves (async) and maps to a keyed dismissFixes call', async () => {
    const { result } = renderEngine([
      viewerBootstrapMock,
      pendingFixesMockFor(BOOK_GID),
      configMock,
      resolveMock('DISMISS', [{ field: 'title', kind: 'replace', from: 'Old' }], []),
    ]);

    await waitFor(() => expect(result.current!.items).toHaveLength(1));
    const itemId = result.current!.items[0]!.id;
    const fix = result.current!.items[0]!.proposals![0]!;

    const outcome = result.current!.dismissFix(itemId, fix);
    expect(outcome).toBeInstanceOf(Promise);
    await expect(outcome).resolves.toBe(true);
  });

  it('dismissAllProposals resolves (async) and maps to a fixes-less dismissFixes call', async () => {
    const { result } = renderEngine([
      viewerBootstrapMock,
      pendingFixesMockFor(BOOK_GID),
      configMock,
      resolveMock('DISMISS', undefined, []),
    ]);

    await waitFor(() => expect(result.current!.items).toHaveLength(1));
    const itemId = result.current!.items[0]!.id;

    const outcome = result.current!.dismissAllProposals(itemId);
    expect(outcome).toBeInstanceOf(Promise);
    await expect(outcome).resolves.toBe(true);
  });

  it('maps undo to undoFixes keyed on bookGlobalId', async () => {
    const { result } = renderEngine([
      viewerBootstrapMock,
      pendingFixesMockFor(BOOK_GID),
      configMock,
      resolveMock('UNDO', undefined, []),
    ]);

    await waitFor(() => expect(result.current!.items).toHaveLength(1));
    const itemId = result.current!.items[0]!.id;

    await expect(result.current!.undo(itemId)).resolves.toBe(true);
  });

  it('dismissCompleted drops the live row and clears the server row when one exists', async () => {
    const { result } = renderEngine([
      viewerBootstrapMock,
      emptyPendingFixesMock,
      configMock,
      resolveMock('CLEAR', undefined, []),
    ]);

    await waitFor(() => expect(result.current!.items).toHaveLength(0));

    act(() => {
      result.current!.addFiles(fileListOf(new File(['x'], 'clean.epub')));
    });
    await completeTheUploadWith(BOOK_GID);
    await waitFor(() => expect(result.current!.items).toHaveLength(1));

    const itemId = result.current!.items[0]!.id;
    act(() => {
      result.current!.dismissCompleted(itemId);
    });

    await waitFor(() => expect(result.current!.items).toHaveLength(0));
  });

  it('invalidates the LibraryEntries connection after a completed upload, so the grid refetches', async () => {
    const { result, client } = renderEngine([
      viewerBootstrapMock,
      emptyPendingFixesMock,
      configMock,
      entriesMock,
    ]);

    await waitFor(() => expect(result.current!.items).toHaveLength(0));

    // Seed the connection, then prove it is really in the cache — otherwise
    // a broken assertion below could "pass" against a cache that was empty
    // all along.
    await client.query({ query: LibraryEntriesDocument, variables: ENTRIES_VARS });
    expect(
      client.cache.readQuery({ query: LibraryEntriesDocument, variables: ENTRIES_VARS })
    ).not.toBeNull();

    act(() => {
      result.current!.addFiles(fileListOf(new File(['x'], 'dune.epub')));
    });
    await completeTheUploadWith(BOOK_GID);

    await waitFor(() =>
      expect(
        client.cache.readQuery({ query: LibraryEntriesDocument, variables: ENTRIES_VARS })
      ).toBeNull()
    );
  });

  // ── The pending-fix READ, inlined here from the dissolved `usePendingFixes`
  //    (Task 9). Everything below used to live in `use-pending-fixes.test.tsx`
  //    or `use-fix-actions.test.tsx`.

  it('does NOT read the pending fixes while no library id is resolved', async () => {
    // An admin with no target selected must not fire a query with
    // `libraryId: ''`. Counted through the VARIABLE MATCHER — which in Apollo
    // Client v4 is `request.variables` given a FUNCTION, never a
    // `variableMatcher` key; see `countingPendingFixesMock`'s doc comment
    // above for what the wrong spelling silently does. The matcher runs
    // synchronously inside `MockLink.request()`, whereas a
    // `result`-as-function counter would only see DELIVERY, after MockLink's
    // delay, so an eager read could slip past the settle below on timing
    // alone.
    const counter = { n: 0 };
    // `useCurrentLibraryId` rides along in the probe purely to give this test
    // a REAL settle point. `items` is `[]` from the very first render, so
    // waiting on it would prove nothing about whether the bootstrap had
    // resolved yet; waiting on `loading === false` proves the admin's
    // "no target selected" answer has actually landed and the engine has had
    // its chance to fire.
    const { result } = renderHookWithApollo(
      () => ({ queue: useUploadQueueEngine(), target: useCurrentLibraryId() }),
      [adminViewerBootstrapMock, countingPendingFixesMock(counter), configMock] as MockedResponse[]
    );

    await waitFor(() => expect(result.current!.target.loading).toBe(false));
    expect(result.current!.target.libraryId).toBeUndefined();

    expect(counter.n).toBe(0);
    expect(result.current!.queue.items).toEqual([]);
  });

  it('re-reads the pending fixes after an upload completes, so a new row appears with no reload', async () => {
    // Two mocks for the same request: MockLink serves them in order, so the
    // SECOND is what the post-upload refetch receives.
    //
    // The FIRST returns a row for an unrelated book, and the wait below is on
    // that row landing. That is not decoration: `refetch()` on an
    // ObservableQuery whose FIRST fetch is still in flight joins that request
    // instead of issuing a new one, so a `waitFor(items).toHaveLength(0)`
    // settle — vacuously true from the first render — would let the upload
    // complete mid-flight and the refetch would never reach the link. This
    // test was written that way first and failed for exactly that reason.
    const { result } = renderEngine([
      viewerBootstrapMock,
      pendingFixesMockFor('OTHER-BOOK', 'FIX-OTHER'),
      configMock,
      pendingFixesMockRows([
        pendingFixRow('OTHER-BOOK', 'FIX-OTHER'),
        pendingFixRow(BOOK_GID, 'FIX-NEW'),
      ]),
    ]);

    await waitFor(() => expect(result.current!.items).toHaveLength(1));

    act(() => {
      result.current!.addFiles(fileListOf(new File(['x'], 'dune.epub')));
    });
    await completeTheUploadWith(BOOK_GID);

    // The live item joins the row the REFETCH brought back. Without the
    // refetch it would still carry the upload response's own (empty)
    // proposals, so this assertion is what the refetch buys.
    await waitFor(() => expect(result.current!.items).toHaveLength(2));
    await waitFor(() =>
      expect(
        result.current!.items.find((i) => i.bookGlobalId === BOOK_GID)!.proposals
      ).toHaveLength(1)
    );
    expect(result.current!.items.find((i) => i.bookGlobalId === BOOK_GID)!.fileName).toBe(
      'dune.epub'
    );
  });

  // ── The fix-action CACHE COHERENCE half, inlined here from the dissolved
  //    `useFixActions` (Task 9). ACCEPT/UNDO rewrite the EPUB and change the
  //    fields the grid sorts and filters on, so both move a book's position in
  //    `Library.entries` — a move the mutation payload cannot express.
  //    DISMISS/CLEAR prove the OTHER half: they touch only the pending-fix
  //    row, already reconciled by the payload's own `library { pendingFixes }`
  //    selection, so they must NOT evict anything.

  it('evicts the LibraryEntries connection on ACCEPT', async () => {
    const { result, client } = renderEngine([
      viewerBootstrapMock,
      pendingFixesMockFor(BOOK_GID),
      configMock,
      resolveMock('ACCEPT', undefined, []),
    ]);

    await waitFor(() => expect(result.current!.items).toHaveLength(1));
    act(() => seedLibraryEntries(client));
    expect(readEntries(client)).not.toBeNull();

    const itemId = result.current!.items[0]!.id;
    await act(async () => {
      await expect(result.current!.applyAllProposals(itemId)).resolves.toBe(true);
    });

    expect(readEntries(client)).toBeNull();
  });

  it('evicts the LibraryEntries connection on UNDO', async () => {
    const { result, client } = renderEngine([
      viewerBootstrapMock,
      pendingFixesMockFor(BOOK_GID),
      configMock,
      resolveMock('UNDO', undefined, []),
    ]);

    await waitFor(() => expect(result.current!.items).toHaveLength(1));
    act(() => seedLibraryEntries(client));
    expect(readEntries(client)).not.toBeNull();

    const itemId = result.current!.items[0]!.id;
    await act(async () => {
      await expect(result.current!.undo(itemId)).resolves.toBe(true);
    });

    expect(readEntries(client)).toBeNull();
  });

  it('leaves the LibraryEntries connection alone on DISMISS', async () => {
    const { result, client } = renderEngine([
      viewerBootstrapMock,
      pendingFixesMockFor(BOOK_GID),
      configMock,
      resolveMock('DISMISS', undefined, []),
    ]);

    await waitFor(() => expect(result.current!.items).toHaveLength(1));
    act(() => seedLibraryEntries(client));

    const itemId = result.current!.items[0]!.id;
    await act(async () => {
      await expect(result.current!.dismissAllProposals(itemId)).resolves.toBe(true);
    });

    expect(readEntries(client)).not.toBeNull();
  });

  it('leaves the LibraryEntries connection alone on CLEAR', async () => {
    // This test needs its OWN guard that the CLEAR actually reached the link,
    // and cannot borrow the `.resolves.toBe(true)` its four siblings use.
    // `dismissCompleted` is `transport.dropItem(itemId); if (gid) void
    // clearFixes(gid);` — it returns `void` and swallows the mutation, and the
    // only observable settle, `items` emptying, is satisfied by `dropItem`
    // ALONE. So if the CLEAR mock ever stopped matching, MockLink would reject
    // with "No more mocked responses", `run`'s `catch` would swallow it, and
    // this test would still go green while proving nothing whatsoever about
    // CLEAR's `update`. That is fail-open, and the count-first matcher below
    // is what closes it.
    //
    // Counted through the VARIABLE MATCHER — `request.variables` given a
    // FUNCTION, per `countingPendingFixesMock`'s doc comment above for why
    // that spelling and not a `variableMatcher` key. The increment happens
    // BEFORE the `return` so a CLEAR sent with the wrong variables still
    // counts as "the mutation was attempted but did not match".
    const clears = { matched: 0, attempted: 0 };
    const countingClearMock: ResolveMock = {
      request: {
        query: BookResolvePendingFixDocument,
        variables: (variables) => {
          clears.attempted += 1;
          const ok = variables.id === BOOK_GID && variables.action === 'CLEAR';
          if (ok) clears.matched += 1;
          return ok;
        },
      },
      result: {
        data: {
          __typename: 'Mutation',
          bookResolvePendingFix: {
            __typename: 'BookResolvePendingFixPayload',
            book: { __typename: 'Book', id: BOOK_GID, title: 'Dune', author: 'Frank Herbert' },
            library: { __typename: 'Library', id: LIBRARY_ID, pendingFixes: [] },
          },
        },
      },
    };

    const { result, client } = renderEngine([
      viewerBootstrapMock,
      pendingFixesMockFor(BOOK_GID),
      configMock,
      countingClearMock,
    ]);

    await waitFor(() => expect(result.current!.items).toHaveLength(1));
    act(() => seedLibraryEntries(client));

    const itemId = result.current!.items[0]!.id;
    await act(async () => {
      result.current!.dismissCompleted(itemId);
      await Promise.resolve();
    });
    // The CLEAR is fire-and-forget inside `dismissCompleted`; wait for the
    // row to actually go before asserting the connection survived it.
    await waitFor(() => expect(result.current!.items).toHaveLength(0));
    // …and wait for the mutation itself, which `items` emptying does NOT
    // imply. `update` runs when the response lands, so asserting the
    // connection before this point could pass on nothing having happened yet.
    await waitFor(() => expect(clears.matched).toBe(1));
    expect(clears.attempted).toBe(1);

    expect(readEntries(client)).not.toBeNull();
  });

  it('does not evict on a failed ACCEPT (typed error, no payload)', async () => {
    const { result, client } = renderEngine([
      viewerBootstrapMock,
      pendingFixesMockFor(BOOK_GID),
      configMock,
      acceptCollisionMock,
    ]);

    await waitFor(() => expect(result.current!.items).toHaveLength(1));
    act(() => seedLibraryEntries(client));

    const itemId = result.current!.items[0]!.id;
    await act(async () => {
      await expect(result.current!.applyAllProposals(itemId)).resolves.toBe(false);
    });

    expect(readEntries(client)).not.toBeNull();
  });

  it('reports a network failure as false', async () => {
    const { result } = renderEngine([
      viewerBootstrapMock,
      pendingFixesMockFor(BOOK_GID),
      configMock,
      acceptNetworkErrorMock,
    ]);

    await waitFor(() => expect(result.current!.items).toHaveLength(1));

    const itemId = result.current!.items[0]!.id;
    await act(async () => {
      await expect(result.current!.applyAllProposals(itemId)).resolves.toBe(false);
    });
  });

  // The book id ROTATES whenever the EPUB is rewritten. Normalization writes
  // the payload into a BRAND-NEW `Book:<newId>` entity and cannot know the old
  // one described the same book, so the pre-accept entity would otherwise
  // linger with stale metadata — and `cache.gc()` cannot collect it while a
  // `Library.book(id:)` field from a prior /book-edit visit still references
  // it, which is exactly what `seedBook` reproduces.
  it('evicts the old Book entity when ACCEPT rotates the id', async () => {
    const { result, client } = renderEngine([
      viewerBootstrapMock,
      pendingFixesMockFor(BOOK_GID),
      configMock,
      rotatingAcceptMock,
    ]);

    await waitFor(() => expect(result.current!.items).toHaveLength(1));
    act(() => seedBook(client, BOOK_GID));
    expect((client.cache.extract() as NormalizedCacheObject)[`Book:${BOOK_GID}`]).toBeDefined();

    const itemId = result.current!.items[0]!.id;
    await act(async () => {
      await expect(result.current!.applyAllProposals(itemId)).resolves.toBe(true);
    });

    expect(Object.keys(client.cache.extract() as NormalizedCacheObject)).not.toContain(
      `Book:${BOOK_GID}`
    );
  });

  it('evicts the old Book entity when UNDO rotates the id', async () => {
    const { result, client } = renderEngine([
      viewerBootstrapMock,
      pendingFixesMockFor(BOOK_GID),
      configMock,
      rotatingUndoMock,
    ]);

    await waitFor(() => expect(result.current!.items).toHaveLength(1));
    act(() => seedBook(client, BOOK_GID));
    expect((client.cache.extract() as NormalizedCacheObject)[`Book:${BOOK_GID}`]).toBeDefined();

    const itemId = result.current!.items[0]!.id;
    await act(async () => {
      await expect(result.current!.undo(itemId)).resolves.toBe(true);
    });

    expect(Object.keys(client.cache.extract() as NormalizedCacheObject)).not.toContain(
      `Book:${BOOK_GID}`
    );
  });

  // The other half of the branch: a no-op ACCEPT (nothing actionable) returns
  // the SAME book id, and the entity must survive — evicting it would throw
  // away metadata nothing has replaced.
  it('keeps the Book entity when ACCEPT does not rotate the id', async () => {
    const { result, client } = renderEngine([
      viewerBootstrapMock,
      pendingFixesMockFor(BOOK_GID),
      configMock,
      resolveMock('ACCEPT', undefined, []),
    ]);

    await waitFor(() => expect(result.current!.items).toHaveLength(1));
    act(() => seedBook(client, BOOK_GID));

    const itemId = result.current!.items[0]!.id;
    await act(async () => {
      await expect(result.current!.applyAllProposals(itemId)).resolves.toBe(true);
    });

    expect((client.cache.extract() as NormalizedCacheObject)[`Book:${BOOK_GID}`]).toBeDefined();
  });
});

describe('fixKey', () => {
  it('identifies a fix by field, kind, and from', () => {
    expect(
      fixKey({ field: 'authorSort', kind: 'author-sort-missing', from: '', to: 'X', changes: {} })
    ).toBe('authorSort:author-sort-missing:');
  });

  it('distinguishes two subject-split fixes by their compound', () => {
    const a = { field: 'subjects', kind: 'subjects-split', from: 'A & B', to: 'A, B', changes: {} };
    const b = { field: 'subjects', kind: 'subjects-split', from: 'C & D', to: 'C, D', changes: {} };
    expect(fixKey(a)).not.toBe(fixKey(b));
  });
});

describe('fixKeyOf', () => {
  it('extracts the field/kind/from triple the server mutation expects', () => {
    expect(
      fixKeyOf({ field: 'title', kind: 'replace', from: 'Old', to: 'New', changes: {} })
    ).toEqual({ field: 'title', kind: 'replace', from: 'Old' });
  });
});
