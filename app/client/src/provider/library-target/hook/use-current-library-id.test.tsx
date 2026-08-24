import type { MockedResponse } from '@apollo/client/testing';
import { waitFor } from '@testing-library/react';
import { afterEach, describe, expect, it } from 'vitest';

import { LibraryTargetResolveDocument } from '~/graphql/library';
import { ViewerBootstrapDocument } from '~/graphql/viewer-bootstrap';
import { renderWithApollo } from '~/test-utils';

import { LibraryTargetProvider } from '../provider';
import { useCurrentLibraryId } from './use-current-library-id';

const STORAGE_KEY = 'library-target-id';

const viewerMock = (
  library: { __typename: 'Library'; id: string } | null,
  isAdmin: boolean
): MockedResponse => ({
  request: { query: ViewerBootstrapDocument },
  result: {
    data: {
      __typename: 'Query' as const,
      viewer: {
        __typename: 'Viewer' as const,
        username: isAdmin ? 'admin' : 'alice',
        isAdmin,
        mustChangePassword: false,
        user: isAdmin ? null : { __typename: 'User' as const, id: 'USER-1' },
        library,
      },
    },
  },
});

/**
 * `LibraryTargetResolveDocument`'s own response: `node` resolved to a real
 * `Library` (kept), `null` (never existed / deleted), or a DIFFERENT type
 * (a stale/garbage id that happens to decode to some other node) — both of
 * the latter two must clear the stored target.
 */
const nodeMock = (
  libraryId: string,
  node: { __typename: string; id: string } | null
): MockedResponse => ({
  request: { query: LibraryTargetResolveDocument, variables: { libraryId } },
  result: { data: { __typename: 'Query' as const, node } },
});

/**
 * Renders the hook inside renderWithApollo's provider stack, wrapped in a
 * REAL `LibraryTargetProvider` — `useCurrentLibraryId` now reads
 * `useLibraryTarget()`, which is backed by `localStorage`, so a bare Apollo
 * mock is no longer enough to exercise it.
 */
const renderCurrentLibraryId = (mocks: MockedResponse[]) => {
  const result: { current?: ReturnType<typeof useCurrentLibraryId> } = {};
  const Probe = () => {
    result.current = useCurrentLibraryId();
    return null;
  };
  renderWithApollo(
    <LibraryTargetProvider>
      <Probe />
    </LibraryTargetProvider>,
    { mocks }
  );
  return result;
};

describe('useCurrentLibraryId', () => {
  afterEach(() => {
    localStorage.clear();
  });

  it('returns the self library id for a regular user', async () => {
    const result = renderCurrentLibraryId([
      viewerMock({ __typename: 'Library', id: 'LIB-SELF' }, false),
    ]);

    await waitFor(() => expect(result.current?.loading).toBe(false));
    expect(result.current?.libraryId).toBe('LIB-SELF');
  });

  it('returns the stored selection for an admin', async () => {
    localStorage.setItem(STORAGE_KEY, 'LIB-TARGET');

    const result = renderCurrentLibraryId([
      viewerMock(null, true),
      nodeMock('LIB-TARGET', { __typename: 'Library', id: 'LIB-TARGET' }),
    ]);

    await waitFor(() => expect(result.current?.loading).toBe(false));
    expect(result.current?.libraryId).toBe('LIB-TARGET');
    // The self-heal below must NOT have fired for a target that DOES
    // resolve to a Library.
    await waitFor(() => expect(localStorage.getItem(STORAGE_KEY)).toBe('LIB-TARGET'));
  });

  it('returns viewer.library.id for a non-admin, ignoring any stored selection', async () => {
    // A non-admin has no legitimate way to populate this key, but nothing
    // stops them from writing to their own localStorage — the hook must not
    // let that read another library.
    localStorage.setItem(STORAGE_KEY, 'LIB-OTHER');

    const result = renderCurrentLibraryId([
      viewerMock({ __typename: 'Library', id: 'LIB-SELF' }, false),
    ]);

    await waitFor(() => expect(result.current?.loading).toBe(false));
    expect(result.current?.libraryId).toBe('LIB-SELF');
  });

  it('returns undefined for an admin with no selection', async () => {
    const result = renderCurrentLibraryId([viewerMock(null, true)]);

    await waitFor(() => expect(result.current?.loading).toBe(false));
    expect(result.current?.libraryId).toBeUndefined();
  });

  it('reports loading until the bootstrap query resolves', () => {
    const result = renderCurrentLibraryId([
      viewerMock({ __typename: 'Library', id: 'LIB-SELF' }, false),
    ]);

    expect(result.current?.loading).toBe(true);
    expect(result.current?.libraryId).toBeUndefined();
  });

  // ── Re-homed self-heal (Task 11) ────────────────────────────────────────
  // `useFetchBookList` cleared a stale `targetLibraryId` on a 404 and on an
  // unresolvable admin username; an earlier task removed its last live
  // caller. The switcher's own effect (`component/library-switcher`) covers
  // "target missing from the user list" — this covers the other case,
  // "target does not resolve to a library at all", firing wherever the
  // library is read rather than only from an action-triggered fetch.

  it("clears an admin's target when the library id no longer resolves", async () => {
    localStorage.setItem(STORAGE_KEY, 'lib-ghost');

    renderCurrentLibraryId([viewerMock(null, true), nodeMock('lib-ghost', null)]);

    await waitFor(() => expect(localStorage.getItem(STORAGE_KEY)).toBeNull());
  });

  it("clears an admin's target when the id resolves to a non-Library node", async () => {
    localStorage.setItem(STORAGE_KEY, 'lib-ghost');

    renderCurrentLibraryId([
      viewerMock(null, true),
      nodeMock('lib-ghost', { __typename: 'Book', id: 'lib-ghost' }),
    ]);

    await waitFor(() => expect(localStorage.getItem(STORAGE_KEY)).toBeNull());
  });

  it("does NOT clear a non-admin's stored target", async () => {
    // A non-admin never reads the stored target at all (`useCurrentLibraryId`
    // always answers with `viewer.library.id` for a non-admin); clearing it
    // would be a side effect on state this hook deliberately ignores. No
    // `LibraryTargetResolveDocument` mock is provided at all — if the hook
    // fired that query anyway for a non-admin, MockLink would throw "No more
    // mocked responses" and fail this test loudly rather than pass vacuously.
    localStorage.setItem(STORAGE_KEY, 'lib-ghost');

    const result = renderCurrentLibraryId([
      viewerMock({ __typename: 'Library', id: 'LIB-SELF' }, false),
    ]);

    await waitFor(() => expect(result.current?.loading).toBe(false));
    expect(localStorage.getItem(STORAGE_KEY)).toBe('lib-ghost');
  });

  it('does NOT clear while the resolving query is still loading', async () => {
    // Clearing on a not-yet-loaded read would wipe a VALID selection on
    // every mount — the failure mode is silent, so this guard needs its own
    // test. A delayed mock keeps `loading` true for the duration of this
    // assertion.
    localStorage.setItem(STORAGE_KEY, 'lib-alice');

    renderCurrentLibraryId([
      viewerMock(null, true),
      { ...nodeMock('lib-alice', { __typename: 'Library', id: 'lib-alice' }), delay: 1000 },
    ]);

    await Promise.resolve();
    expect(localStorage.getItem(STORAGE_KEY)).toBe('lib-alice');
  });
});
