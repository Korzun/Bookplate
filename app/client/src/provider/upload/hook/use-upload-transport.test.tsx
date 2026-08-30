import type { MockedResponse } from '@apollo/client/testing';
import { act, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { UserRowFragment } from '~/component/user-row';
import { makeFragmentData } from '~/gql';
import type { UploadConfigQuery, UserListQuery } from '~/gql/graphql';
import { UploadConfigDocument } from '~/graphql/upload';
import { UserListDocument } from '~/graphql/user';
import {
  LibraryTargetProvider,
  useLibraryTarget,
  useWithTargetUser,
} from '~/provider/library-target';
import { renderHookWithApollo, renderWithApollo } from '~/test-utils';

import { useUploadTransport } from './use-upload-transport';

// ── XHR mock ─────────────────────────────────────────────────────────────────
// Reused from ../../book/hook/use-upload-queue.test.tsx — that file is the
// existing coverage for exactly this machinery, and this stub already models
// `upload.onprogress`, `onload`, `onerror`, and `status`.

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

function makeFileList(...names: string[]): FileList {
  const files = names.map((name) => new File(['x'.repeat(1000)], name));
  return files as unknown as FileList;
}

const configMock = (maxConcurrentUploads: number): MockedResponse<UploadConfigQuery> => ({
  request: { query: UploadConfigDocument },
  result: {
    data: {
      __typename: 'Query',
      config: { __typename: 'Config', maxConcurrentUploads },
    },
  },
});

const configErrorMock: MockedResponse<UploadConfigQuery> = {
  request: { query: UploadConfigDocument },
  error: new Error('network error'),
};

/** Renders the hook and waits for `UploadConfigDocument` to actually land in
 * the cache before returning — MockLink resolves after a realistic 20-50ms
 * delay, so calling `addFiles` before this settles would race the default
 * fallback of 3 against the mocked cap. */
async function renderTransport(onUploaded: () => void = () => {}, cap = 2) {
  const rendered = renderHookWithApollo(() => useUploadTransport(onUploaded), [configMock(cap)]);
  await waitFor(() => {
    expect(rendered.client.cache.readQuery({ query: UploadConfigDocument })).not.toBeNull();
  });
  return rendered;
}

// ── Admin switcher harness (Task 10) ────────────────────────────────────────
// `useUploadTransport`'s fallback path reads `useWithTargetUser`, which
// resolves the admin's LIBRARY SWITCHER selection (`useLibraryTarget`, backed
// by a real `LibraryTargetProvider`) against `UserListDocument` — the same
// machinery `provider/library-target/hook/use-with-target-user.test.tsx`
// already mocks for this exact hook (its `user`/`userListMock` shape is
// mirrored here, not reinvented). `renderTransport` above can't reach any of
// this: it renders as a non-admin with no `LibraryTargetProvider` in the
// tree, so the switcher is permanently unresolved. This is the smallest
// extension needed — an admin-flavoured render plus a live switcher setter —
// to express the four target-capture cases below.

const targetUser = (username: string, libraryId: string) => ({
  __typename: 'User' as const,
  ...makeFragmentData(
    {
      __typename: 'User' as const,
      id: username,
      username,
      progressCount: 0,
      pendingBookRequestCount: 0,
    },
    UserRowFragment
  ),
  library: { __typename: 'Library' as const, id: libraryId },
});

const userListMock: MockedResponse<UserListQuery> = {
  request: { query: UserListDocument },
  maxUsageCount: Infinity,
  result: {
    data: {
      __typename: 'Query',
      viewer: {
        __typename: 'Viewer',
        users: [
          targetUser('alice', 'LIB-ALICE'),
          targetUser('bob', 'LIB-BOB'),
          targetUser('carol', 'LIB-CAROL'),
        ],
      },
    },
  },
};

const LIBRARY_OF: Record<string, string> = {
  alice: 'LIB-ALICE',
  bob: 'LIB-BOB',
  carol: 'LIB-CAROL',
};

/**
 * Renders `useUploadTransport` as an admin inside a real
 * `LibraryTargetProvider` + `UserListDocument` mock, and hands back a
 * `setTargetUsername` that drives the switcher LIVE — the same
 * `useLibraryTarget` setter `component/library-switcher` calls, not a mock of
 * `useWithTargetUser` itself. Waits for both the upload-config query and
 * `useWithTargetUser`'s own `.ready` before returning, so a test's first
 * `setTargetUsername` call lands on a settled hook rather than racing
 * `UserListDocument`'s realistic MockLink delay.
 */
async function renderTransportAsAdmin(
  onUploaded: (libraryId: string | undefined) => void = () => {},
  cap = 2
) {
  const result: { current?: ReturnType<typeof useUploadTransport> } = {};
  const targetSetterRef: { current?: (id: string | undefined) => void } = {};
  const readyRef: { current: boolean } = { current: false };

  function Probe() {
    result.current = useUploadTransport(onUploaded);
    const [, setTargetLibraryId] = useLibraryTarget();
    targetSetterRef.current = setTargetLibraryId;
    readyRef.current = useWithTargetUser().ready;
    return null;
  }

  const rendered = renderWithApollo(
    <LibraryTargetProvider>
      <Probe />
    </LibraryTargetProvider>,
    { mocks: [configMock(cap), userListMock], user: { username: 'admin', isAdmin: true } }
  );

  await waitFor(() => {
    expect(rendered.client.cache.readQuery({ query: UploadConfigDocument })).not.toBeNull();
    expect(readyRef.current).toBe(true);
  });

  const setTargetUsername = (username: string | undefined) => {
    targetSetterRef.current!(username ? LIBRARY_OF[username] : undefined);
  };

  return { result, setTargetUsername, ...rendered };
}

beforeEach(() => {
  xhrInstances = [];
  vi.stubGlobal('XMLHttpRequest', XHRMock);
  // ensureFreshToken() falls back to a real fetch('/api/auth/refresh') when no
  // token is stored; stub it out so tests never hit the network, and so a
  // stray call to the old '/api/config' REST endpoint is observable.
  vi.stubGlobal(
    'fetch',
    vi.fn().mockResolvedValue({
      ok: false,
      json: () => Promise.resolve({}),
    })
  );
});

afterEach(() => {
  vi.unstubAllGlobals();
});

// ── Tests ─────────────────────────────────────────────────────────────────────

describe('useUploadTransport', () => {
  it('reads the concurrency cap from GraphQL, not GET /api/config', async () => {
    await renderTransport();

    // The old implementation fetched /api/config on mount. Nothing may.
    const configCalls = vi
      .mocked(fetch)
      .mock.calls.filter(([url]) => String(url).includes('/api/config'));
    expect(configCalls).toEqual([]);
  });

  it('starts at most maxConcurrentUploads XHRs at once', async () => {
    const { result } = await renderTransport(() => {}, 2);

    act(() => {
      result.current!.addFiles(makeFileList('a.epub', 'b.epub', 'c.epub', 'd.epub', 'e.epub'));
    });

    // Five queued, cap of 2: exactly two requests may be in flight. Asserting
    // exactly 2 (not merely "at most 3") proves the cap came from GraphQL, not
    // the hard-coded default of 3 — a test that allowed 3 would pass against
    // the fallback and prove nothing.
    expect(xhrInstances).toHaveLength(2);
    expect(result.current!.items.filter((i) => i.status === 'uploading')).toHaveLength(2);
    expect(result.current!.items.filter((i) => i.status === 'queued')).toHaveLength(3);
  });

  it('defaults to a cap of 3 while the config query is still loading', async () => {
    const { result } = renderHookWithApollo(() => useUploadTransport(() => {}), [configMock(2)]);

    // Deliberately NOT awaiting config resolution — addFiles runs while the
    // query is still in flight (MockLink resolves after a real ~20-50ms delay).
    act(() => {
      result.current!.addFiles(makeFileList('a.epub', 'b.epub', 'c.epub', 'd.epub'));
    });

    expect(xhrInstances).toHaveLength(3);
    expect(result.current!.items.filter((i) => i.status === 'uploading')).toHaveLength(3);
  });

  it('defaults to a cap of 3 when the config query errors', async () => {
    const { result } = renderHookWithApollo(() => useUploadTransport(() => {}), [configErrorMock]);

    // No cache signal to wait on for an errored query; wait past MockLink's
    // realistic delay window (max 50ms) so the error has definitely settled.
    await act(async () => {
      await new Promise((resolve) => setTimeout(resolve, 100));
    });

    act(() => {
      result.current!.addFiles(makeFileList('a.epub', 'b.epub', 'c.epub', 'd.epub'));
    });

    expect(xhrInstances).toHaveLength(3);
  });

  // Ported from main's `0c4130be` ("don't let a bad /api/config response freeze
  // the upload queue"), which landed on the REST engine this transport
  // replaced. The 401-body half of that fix is moot here — `maxConcurrentUploads`
  // is a non-null `Int!`, so a bad response surfaces as a GraphQL error and
  // `data` stays undefined rather than yielding a poisoned number (covered by
  // the "defaults to a cap of 3 when the config query errors" test above).
  // What survives the architecture change is the FLOOR: any limit below one
  // strands every item at 'queued' for the session, because `slots` computes
  // <= 0 and the effect's bail-out returns before starting anything.
  it.each([
    ['a zero limit', 0],
    ['a negative limit', -1],
  ])('still starts uploads when the server reports %s', async (_label, cap) => {
    const { result } = await renderTransport(() => {}, cap);

    act(() => result.current!.addFiles(makeFileList('a.epub')));

    await waitFor(() => expect(result.current!.items[0]!.status).toBe('uploading'));
    expect(xhrInstances).toHaveLength(1);
  });

  // The other half of main's fix, and the half that is fully
  // architecture-independent. `ensureFreshToken()` runs OUTSIDE the XHR, so if
  // it throws, neither `onload` nor `onerror` can fire for a request that was
  // never sent: the item hangs at 'uploading' and its slot stays held in
  // `startedRef` forever, permanently shrinking the queue until nothing starts.
  it('releases the concurrency slot when the pre-send token refresh throws', async () => {
    // `ensureFreshToken` -> `refreshAccessToken` -> `withRefreshLock`, which has
    // only a `finally`, no catch — so a rejecting lock is what actually
    // propagates out. A rejected `fetch` does NOT: `performRefresh` catches it
    // internally and returns false. Same trigger main's own test used.
    vi.stubGlobal('navigator', {
      ...navigator,
      locks: { request: () => Promise.reject(new Error('lock unavailable')) },
    });

    const { result } = await renderTransport();

    act(() => result.current!.addFiles(makeFileList('a.epub', 'b.epub', 'c.epub')));

    // The failed item must land in `error`, not hang at `uploading`...
    await waitFor(() => expect(result.current!.items[0]!.status).toBe('error'));
    // ...and its slot must come back: with a cap of 2, a third XHR can only be
    // constructed if the first genuinely released. A held slot caps this at 2.
    await waitFor(() => expect(xhrInstances.length).toBeGreaterThan(2));
  });

  it('addFiles appends items with queued status', async () => {
    const { result } = await renderTransport();

    act(() => {
      result.current!.addFiles(makeFileList('a.epub', 'b.epub'));
    });

    expect(result.current!.items).toHaveLength(2);
    expect(result.current!.items[0].fileName).toBe('a.epub');
    expect(result.current!.items[0].status).toBe('uploading');
    expect(result.current!.items[1].fileName).toBe('b.epub');
  });

  it('updates bytesUploaded on progress events', async () => {
    const { result } = await renderTransport();

    act(() => {
      result.current!.addFiles(makeFileList('a.epub'));
    });

    act(() => {
      xhrInstances[0].upload.onprogress?.({
        loaded: 500,
        total: 1000,
        lengthComputable: true,
      } as ProgressEvent);
    });

    expect(result.current!.items[0].bytesUploaded).toBe(500);
  });

  it('transitions to done, threads globalId into bookGlobalId, drops bookId, and calls onUploaded', async () => {
    const onUploaded = vi.fn();
    const { result } = await renderTransport(onUploaded);

    act(() => {
      result.current!.addFiles(makeFileList('a.epub'));
    });

    // `xhr.open` fires asynchronously, after `ensureFreshToken()` resolves —
    // wait for it rather than assuming a fixed number of microtask ticks.
    // Also confirms `useWithTargetUser` is still wired into the multipart POST.
    await waitFor(() => {
      expect(xhrInstances[0].open).toHaveBeenCalledWith('POST', '/api/books/upload');
    });

    xhrInstances[0].status = 200;
    xhrInstances[0].responseText = JSON.stringify({
      results: [
        {
          filename: 'a.epub',
          bookId: 'raw-content-hash-must-not-appear',
          globalId: 'GLOBAL-1',
          applied: [],
          proposals: [],
        },
      ],
    });
    await act(async () => {
      xhrInstances[0].onload?.(new Event('load'));
      await Promise.resolve();
    });

    expect(result.current!.items[0].status).toBe('done');
    expect(result.current!.items[0].bookGlobalId).toBe('GLOBAL-1');
    expect(result.current!.items[0]).not.toHaveProperty('bookId');
    expect(onUploaded).toHaveBeenCalledTimes(1);
  });

  it('transitions to error with message and validation on non-200 response', async () => {
    const validation = {
      counts: { FATAL: 1, ERROR: 1, WARNING: 2, INFO: 0, USAGE: 0 },
      messages: [{ id: 'PKG-003', severity: 'FATAL', message: 'unreadable' }],
      threshold: 'ERROR',
    };
    const { result } = await renderTransport();

    act(() => {
      result.current!.addFiles(makeFileList('bad.epub'));
    });

    xhrInstances[0].status = 400;
    xhrInstances[0].responseText = JSON.stringify({ error: 'Invalid EPUB', validation });
    act(() => {
      xhrInstances[0].onload?.(new Event('load'));
    });

    expect(result.current!.items[0].status).toBe('error');
    expect(result.current!.items[0].errorMessage).toBe('Invalid EPUB');
    expect(result.current!.items[0].validation).toEqual(validation);
  });

  it('transitions to error without a message on an XHR network error', async () => {
    const { result } = await renderTransport();

    act(() => {
      result.current!.addFiles(makeFileList('a.epub'));
    });

    act(() => {
      xhrInstances[0].onerror?.();
    });

    expect(result.current!.items[0].status).toBe('error');
    expect(result.current!.items[0].errorMessage).toBeUndefined();
  });

  it('starts the next queued item when a slot frees up', async () => {
    const { result } = await renderTransport(() => {}, 2);

    act(() => {
      result.current!.addFiles(makeFileList('a.epub', 'b.epub', 'c.epub'));
    });

    expect(xhrInstances).toHaveLength(2);

    xhrInstances[0].status = 200;
    await act(async () => {
      xhrInstances[0].onload?.(new Event('load'));
      await Promise.resolve();
    });

    expect(xhrInstances).toHaveLength(3);
    expect(result.current!.items[0].status).toBe('done');
    expect(result.current!.items[2].status).toBe('uploading');
  });

  it('remapBookGlobalId retargets only the items holding the old id', async () => {
    const { result } = await renderTransport();

    act(() => {
      result.current!.addFiles(makeFileList('a.epub', 'b.epub'));
    });
    await waitFor(() => expect(xhrInstances[1]?.open).toHaveBeenCalled());

    const finish = async (index: number, globalId: string) => {
      xhrInstances[index].status = 200;
      xhrInstances[index].responseText = JSON.stringify({
        results: [{ filename: 'x.epub', globalId }],
      });
      await act(async () => {
        xhrInstances[index].onload?.(new Event('load'));
        await Promise.resolve();
      });
    };
    await finish(0, 'OLD');
    await finish(1, 'OTHER');

    act(() => {
      result.current!.remapBookGlobalId('OLD', 'NEW');
    });

    expect(result.current!.items[0].bookGlobalId).toBe('NEW');
    expect(result.current!.items[1].bookGlobalId).toBe('OTHER'); // untouched
    // Progress/status survive the retarget — the remap rewrites one field.
    expect(result.current!.items[0].status).toBe('done');
  });

  it('dropItem removes only the targeted row', async () => {
    const { result } = await renderTransport();

    act(() => {
      result.current!.addFiles(makeFileList('a.epub', 'b.epub'));
    });

    const idToKeep = result.current!.items[1].id;
    const idToDrop = result.current!.items[0].id;

    act(() => {
      result.current!.dropItem(idToDrop);
    });

    expect(result.current!.items).toHaveLength(1);
    expect(result.current!.items[0].id).toBe(idToKeep);
  });

  it('does not abort in-flight XHRs when dropped — matches the old queue leaving uploads alone on unmount', async () => {
    const { result } = await renderTransport();

    act(() => {
      result.current!.addFiles(makeFileList('a.epub'));
    });

    const id = result.current!.items[0].id;
    act(() => {
      result.current!.dropItem(id);
    });

    expect(xhrInstances[0].abort).not.toHaveBeenCalled();
  });
});

// Task 10: the transport used to read the admin's global switcher selection
// at SEND time, not add time — so an admin who queued files for one reader
// and then switched libraries had the still-queued items upload into the
// new target. `addFiles`'s `target` option (captured onto the item) fixes
// that; these four cases pin the fix, the pre-existing fallback, and the
// regression it closes.
describe('useUploadTransport — per-item target (Task 10)', () => {
  it('uploads to the target captured at add time, not the current switcher selection', async () => {
    const { result, setTargetUsername } = await renderTransportAsAdmin();

    // The switcher points at alice when the files are added.
    act(() => setTargetUsername('alice'));
    act(() => {
      result.current!.addFiles(makeFileList('a.epub'), {
        target: { libraryId: 'lib-bob', username: 'bob' },
      });
    });
    // The admin switches to a third library while the item is still queued.
    act(() => setTargetUsername('carol'));

    await waitFor(() => expect(xhrInstances[0]?.open).toHaveBeenCalled());
    expect(xhrInstances[0].open).toHaveBeenCalledWith('POST', '/api/books/upload?user=bob');
  });

  it('falls back to the current switcher selection when no target is given', async () => {
    const { result, setTargetUsername } = await renderTransportAsAdmin();

    act(() => setTargetUsername('alice'));
    act(() => {
      result.current!.addFiles(makeFileList('a.epub'));
    });

    await waitFor(() => expect(xhrInstances[0]?.open).toHaveBeenCalled());
    expect(xhrInstances[0].open).toHaveBeenCalledWith('POST', '/api/books/upload?user=alice');
  });

  it('regression: a switcher change mid-queue does not retarget a queued item', async () => {
    const { result, setTargetUsername } = await renderTransportAsAdmin();

    act(() => setTargetUsername('alice'));
    act(() => {
      result.current!.addFiles(makeFileList('a.epub'), {
        target: { libraryId: 'lib-alice', username: 'alice' },
      });
    });
    act(() => setTargetUsername('bob'));

    await waitFor(() => expect(xhrInstances[0]?.open).toHaveBeenCalled());
    expect(xhrInstances[0].open).toHaveBeenCalledWith('POST', '/api/books/upload?user=alice');
  });

  it('reports the item own library id when the upload completes', async () => {
    const onUploaded = vi.fn();
    const { result } = await renderTransportAsAdmin(onUploaded);

    act(() => {
      result.current!.addFiles(makeFileList('a.epub'), {
        target: { libraryId: 'lib-bob', username: 'bob' },
      });
    });

    await waitFor(() => expect(xhrInstances[0]?.open).toHaveBeenCalled());
    xhrInstances[0].status = 200;
    xhrInstances[0].responseText = JSON.stringify({
      results: [{ filename: 'a.epub', globalId: 'GLOBAL-1' }],
    });
    await act(async () => {
      xhrInstances[0].onload?.(new Event('load'));
      await Promise.resolve();
    });

    expect(onUploaded).toHaveBeenCalledWith('lib-bob');
  });
});
