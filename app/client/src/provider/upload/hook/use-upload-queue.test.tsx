import type { MockedResponse } from '@apollo/client/testing';
import { act, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import type {
  BookResolvePendingFixMutation,
  BookResolvePendingFixMutationVariables,
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
import { renderHookWithApollo } from '~/test-utils';

import { fixKey, fixKeyOf, useUploadQueueEngine } from './use-upload-queue';

const LIBRARY_ID = 'TGlicmFyeTox';
const BOOK_GID = 'Qm9vazox';

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

  it("shows no proposals (not the upload response's stale ones) once the server row for a resolved book disappears", async () => {
    // The upload's OWN response carries a DIFFERENT, non-empty proposal
    // (`author`) than the row's (`title`) — proving, once the row disappears
    // after a full resolution, the merge shows nothing pending rather than
    // falling back to this stale upload-time list.
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
