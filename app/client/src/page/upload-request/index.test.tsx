import type { MockedResponse } from '@apollo/client/testing';
import { act, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import type { ReactElement } from 'react';
import { useEffect } from 'react';
import { Link, Route, Routes, useOutletContext } from 'react-router';
import { beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';

import { UserRowFragment } from '~/component/user-row';
import { makeFragmentData } from '~/gql';
import type { UserListQuery } from '~/gql/graphql';
import { UserListDocument } from '~/graphql/user';
import { UploadProvider } from '~/provider/upload';
import { path } from '~/router';
import { renderWithApollo } from '~/test-utils';

import { RequestView } from '../request';
import { UploadView } from '../upload';
import { UploadRequestLayout, type UploadRequestOutletContext } from './index';

// ── auth / library-target mocks ─────────────────────────────────────────────
//
// Same shape as `page/library/index.test.tsx`'s own mocks: `UploadRequestLayout` and the
// REAL `LibrarySwitcher` it renders both read `useIsAdmin`/`useLibraryTarget`,
// so mocking the two provider modules drives both consistently without a
// `LibraryTargetProvider` (which is backed by `localStorage`, not test props).

let isAdminValue = false;
let targetLibraryIdValue: string | undefined = undefined;

vi.mock('~/provider/auth', () => ({
  useIsAdmin: () => [isAdminValue],
}));

vi.mock('~/provider/library-target', () => ({
  useLibraryTarget: () => [targetLibraryIdValue, vi.fn()],
  // `useCurrentLibraryId`/`useWithTargetUser` are only reached by
  // `renderUploadRequestLayoutAt`'s tests below, which mount the REAL `UploadView` —
  // its upload queue engine calls both (never `useLibraryTarget` directly,
  // see `useCurrentLibraryId`'s own doc comment). `libraryId: undefined` is a
  // safe stub: the pending-fixes query it gates is `skip`ped outright when
  // `libraryId` is `undefined`. `useWithTargetUser`'s stub mirrors its real
  // no-op behaviour for a non-admin (every test here uses `isAdmin: false`).
  useCurrentLibraryId: () => ({ libraryId: targetLibraryIdValue, loading: false }),
  useWithTargetUser: () =>
    Object.assign((url: string) => url, { ready: true, username: undefined }),
}));

// The Request view mounts `BookRequestsContent`, which renders its "Clear
// resolved" `ConfirmModal` unconditionally — `<dialog>`-backed
// (`control/use-modal-dialog`), and jsdom has no real implementation. Same
// stub `component/book-requests-content`'s own suite installs.
beforeAll(() => {
  HTMLDialogElement.prototype.showModal = vi.fn(function (this: HTMLDialogElement) {
    this.setAttribute('open', '');
  });
  HTMLDialogElement.prototype.close = vi.fn(function (this: HTMLDialogElement) {
    this.removeAttribute('open');
  });
});

const DEFAULT_LIBRARY_ID = 'TGliOmJvYg==';

function makeUser(overrides: { id?: string; username?: string; libraryId?: string } = {}) {
  return {
    __typename: 'User' as const,
    ...makeFragmentData(
      {
        __typename: 'User' as const,
        id: overrides.id ?? 'u1',
        username: overrides.username ?? 'alice',
        pendingBookRequestCount: 0,
        email: null,
        emailVerifiedAt: null,
      },
      UserRowFragment
    ),
    library: { __typename: 'Library' as const, id: overrides.libraryId ?? DEFAULT_LIBRARY_ID },
  };
}

// `maxUsageCount: 2` — `UploadRequestLayout`'s own admin-gate read of `UserListDocument`
// AND `LibrarySwitcher`'s own (separate) read both fire on every admin
// render; a default `maxUsageCount` of 1 would leave the second consumer
// with no matching mock (a `console.warn`, per `test-utils.tsx`'s standing
// note on `MockLink`, not a thrown error — but the switcher would then hang
// in its own permanent "loading" state).
function userListMock(users: ReturnType<typeof makeUser>[] = []): MockedResponse<UserListQuery> {
  return {
    request: { query: UserListDocument },
    maxUsageCount: 2,
    result: {
      data: { __typename: 'Query', viewer: { __typename: 'Viewer', users } },
    },
  };
}

function renderUploadRequestLayout({
  isAdmin = false,
  targetLibraryId,
  users = [makeUser({ libraryId: targetLibraryId })],
  mocks,
}: {
  isAdmin?: boolean;
  targetLibraryId?: string;
  users?: ReturnType<typeof makeUser>[];
  /** Overrides the default `userListMock(users)` — used by the request-counting
   *  admin-gate tests below, which need their own counting mock instead. */
  mocks?: MockedResponse[];
} = {}) {
  isAdminValue = isAdmin;
  targetLibraryIdValue = targetLibraryId;
  return renderWithApollo(
    <Routes>
      <Route element={<UploadRequestLayout />}>
        <Route index element={<div data-testid="add-outlet-child" />} />
      </Route>
    </Routes>,
    { mocks: mocks ?? (isAdmin ? [userListMock(users)] : []) }
  );
}

function renderUploadRequestLayoutWithChild(
  renderChild: (context: UploadRequestOutletContext) => ReactElement,
  { isAdmin = false, targetLibraryId }: { isAdmin?: boolean; targetLibraryId?: string } = {}
) {
  isAdminValue = isAdmin;
  targetLibraryIdValue = targetLibraryId;

  function ChildRoute() {
    const context = useOutletContext<UploadRequestOutletContext>();
    return renderChild(context);
  }

  return renderWithApollo(
    <Routes>
      <Route element={<UploadRequestLayout />}>
        <Route index element={<ChildRoute />} />
      </Route>
    </Routes>,
    { mocks: isAdmin ? [userListMock([makeUser({ libraryId: targetLibraryId })])] : [] }
  );
}

/**
 * Mounts the REAL `UploadRequestLayout` + `UploadView`/`RequestView` route tree at
 * a given pathname, mirroring `router/component.tsx`: one PATHLESS layout with
 * two absolute-path children, which is what lets `/add` and `/request` be
 * siblings while still sharing the gate, the `<Page>` shell and the
 * header-actions channel.
 *
 * Wrapped in `UploadProvider` because the real `UploadView` (unlike the
 * `add-outlet-child` stand-in the other tests here use) depends on it.
 *
 * The bare `<Link>` is the only way left to cross between the two views from
 * inside a test: they used to share a segmented toggle, and that control is
 * gone now that each is its own nav destination. It stands in for the nav tab
 * a real reader would click — `component/nav` owns and tests the real one.
 */
function renderUploadRequestLayoutAt(
  initialPath: string,
  { isAdmin = false }: { isAdmin?: boolean } = {}
) {
  isAdminValue = isAdmin;
  targetLibraryIdValue = undefined;
  const rendered = renderWithApollo(
    <UploadProvider>
      <Link to={path.request()}>go to request</Link>
      <Routes>
        <Route element={<UploadRequestLayout />}>
          <Route path={path.upload()} element={<UploadView />} />
          <Route path={path.request()} element={<RequestView />} />
        </Route>
      </Routes>
    </UploadProvider>,
    { initialEntries: [initialPath] }
  );
  return { ...rendered, user: userEvent.setup() };
}

describe('UploadRequestLayout layout', () => {
  it('gates an admin with no library selected, rendering no view at all', async () => {
    renderUploadRequestLayout({ isAdmin: true, targetLibraryId: undefined });
    expect(await screen.findByText(/select a library/i)).toBeInTheDocument();
    // The early return replaces the `<Outlet />` entirely, so neither view
    // mounts. This used to assert "no toggle" via its `radiogroup` role; that
    // control is gone, and the outlet child is what the gate actually
    // withholds.
    expect(screen.queryByTestId('add-outlet-child')).not.toBeInTheDocument();
  });

  it('tells an admin to register a user when there are none', async () => {
    renderUploadRequestLayout({ isAdmin: true, targetLibraryId: undefined, users: [] });
    // Exactly ONCE, as the empty-state title. It used to appear twice, the
    // second being the disabled switcher's own placeholder — the switcher is
    // global now (`router/nav-layout`) and no longer rendered by this page, so
    // a second occurrence here would mean it had crept back in.
    await waitFor(() => {
      expect(screen.getAllByText(/no users registered/i).length).toBe(1);
    });
  });

  it('renders the child view once a library is selected, and owns no switcher', async () => {
    renderUploadRequestLayout({ isAdmin: true, targetLibraryId: DEFAULT_LIBRARY_ID });

    expect(await screen.findByTestId('add-outlet-child')).toBeInTheDocument();
    // The picker is global chrome now, rendered once by `router/nav-layout`
    // above the nav. This page must not render a second one. `LibrarySwitcher`'s
    // `Select` trigger is a `role="button"` whose accessible name is the
    // selected option's label (see `control/select/index.tsx`), so the selected
    // user's name appearing as a button here would mean a duplicate picker.
    expect(screen.queryByRole('button', { name: 'alice' })).not.toBeInTheDocument();
  });

  it('renders no switcher for a reader, and goes straight to the child view', () => {
    renderUploadRequestLayout({ isAdmin: false });
    // Anchoring to the placeholder text alone (`/select library/i`) would
    // still pass if the switcher rendered WITH a selection — its trigger's
    // accessible name is the selected option's label then, not the
    // placeholder. `LibrarySwitcher` returns `null` outright for a reader
    // (`AdminLibrarySwitcher` never even mounts), and its `Select` trigger is
    // the only `role="button"` element `UploadRequestLayout`'s own chrome ever renders
    // here (`AddToggle` is `role="radiogroup"`/`"radio"`, and no header
    // actions are published yet) — so asserting zero buttons catches a
    // switcher rendered in ANY state, not just the unselected one.
    expect(screen.queryAllByRole('button')).toHaveLength(0);
    expect(screen.getByTestId('add-outlet-child')).toBeInTheDocument();
  });

  /**
   * Which view mounts is now decided by the ROUTE alone — `/add` and
   * `/request` are siblings under one pathless layout, where they used to be
   * a parent route and a child selected by an in-page toggle.
   */
  it('mounts the Upload view on /add', async () => {
    renderUploadRequestLayoutAt('/upload', { isAdmin: false });
    expect(await screen.findByRole('button', { name: /^actions$/i })).toBeInTheDocument();
    expect(screen.queryByTestId('add-request-view')).not.toBeInTheDocument();
  });

  it('mounts the Request view on /request', async () => {
    renderUploadRequestLayoutAt('/request', { isAdmin: false });
    expect(await screen.findByTestId('add-request-view')).toBeInTheDocument();
  });

  // The layout itself renders no control of its own any more: the segmented
  // toggle that used to ride in its header moved up to the nav, where Upload
  // and Request are separate destinations.
  it('renders no segmented control of its own', async () => {
    renderUploadRequestLayoutAt('/upload', { isAdmin: false });
    await screen.findByRole('button', { name: /^actions$/i });
    expect(screen.queryByRole('radiogroup')).not.toBeInTheDocument();
  });

  // Pins `UploadRequestOutletContext`'s doc comment ("Children MUST clear on unmount")
  // from the OTHER direction: `page/upload/index.tsx`'s
  // `useEffect(() => { setHeaderActions(headerActions); return () =>
  // setHeaderActions(undefined); }, ...)` cleanup is what this test catches
  // if deleted. `UploadView` always publishes 3 actions (`buildUploadActions`
  // returns them unconditionally, disabled or not — see `page/upload/actions.ts`),
  // so its "Actions" trigger appears as soon as it mounts; without the
  // unmount cleanup, switching to Request would leave `UploadRequestLayout`'s
  // `headerActions` state stale and the (now-irrelevant) Upload trigger stuck
  // on screen.
  it("clears the Upload view's header actions when navigating to Request", async () => {
    const { user } = renderUploadRequestLayoutAt('/upload', { isAdmin: false });
    expect(await screen.findByRole('button', { name: /^actions$/i })).toBeInTheDocument();

    await user.click(screen.getByRole('link', { name: 'go to request' }));
    await screen.findByTestId('add-request-view');

    // The TRIGGER survives the switch — both views publish actions — so the
    // leak this guards against is not "a trigger that should have gone" but
    // "Upload's items still in the menu". Opening it is the only way to tell
    // the two apart.
    //
    // Still worth testing after the route split: `/add` and `/request` share
    // one layout, so crossing between them does NOT remount it, and a child
    // that failed to clear on unmount would still strand its actions there.
    await user.click(screen.getByRole('button', { name: /^actions$/i }));
    expect(await screen.findByRole('menuitem', { name: 'Clear resolved' })).toBeInTheDocument();
    for (const stale of ['Clear finished', 'Accept all', 'Reject all']) {
      expect(screen.queryByRole('menuitem', { name: stale })).not.toBeInTheDocument();
    }
  });

  it('renders header actions a child publishes through the outlet context', async () => {
    renderUploadRequestLayoutWithChild(({ setHeaderActions }) => {
      useEffect(() => {
        setHeaderActions([{ label: 'Do a thing', onClick: () => {} }]);
        return () => setHeaderActions(undefined);
      }, [setHeaderActions]);
      return <div />;
    });
    // `/actions/i` alone matches BOTH the desktop trigger ("Actions",
    // `actionsLabel` from `UploadRequestLayout`) and the mobile trigger's static "More
    // actions" `aria-label` (`control/page-actions-bar`) — anchor to the
    // exact desktop label so this pins the layout's own `actionsLabel="Actions"`
    // prop, not just "some actions trigger exists".
    expect(await screen.findByRole('button', { name: /^actions$/i })).toBeInTheDocument();
  });
});

// ── The `UserListDocument` admin gate ────────────────────────────────────────
//
// Moved from `page/upload/index.test.tsx` (pre-Task-2): the admin gate itself
// — `skip: !isAdmin` on `UploadRequestLayout`'s own read — moved out of the Upload view
// verbatim, so this coverage belongs with the layout now, not with
// `UploadView` (`page/upload/index.test.tsx`), which no longer touches
// `UserListDocument` at all.
//
// The gate is pinned by a REQUEST COUNTER rather than by rendered output —
// see `test-utils.tsx`'s standing note on `MockLink` for why ("no mock
// queued" does not fail a synchronous assertion the way it looks like it
// should). `request.variables` as a FUNCTION is MockLink's variable-matcher
// form: it runs synchronously inside `MockLink.request()`, in the same tick
// the operation is issued, so the count is already correct before the first
// `await` below.
//
// The admin case's count is 1, not 2, even though BOTH `UploadRequestLayout`'s own gate
// read and the real `LibrarySwitcher`'s own read fire on the same render:
// `UserListDocument` takes no variables, and Apollo's default
// `queryDeduplication` collapses two concurrently in-flight requests for the
// exact same document+variables into a single request against the link —
// measured directly (this count would be 2 without that dedup) rather than
// assumed.
const userListRequests = { count: 0 };

const countingUserListMock = (): MockedResponse<UserListQuery> => ({
  request: {
    query: UserListDocument,
    variables: function userListVariables() {
      userListRequests.count += 1;
      return true;
    },
  },
  maxUsageCount: Infinity,
  result: {
    data: { __typename: 'Query', viewer: { __typename: 'Viewer', users: [] } },
  },
});

describe('UploadRequestLayout — UserList admin gate', () => {
  beforeEach(() => {
    userListRequests.count = 0;
  });

  it('does not issue the UserList query for a non-admin viewer', async () => {
    // The mock IS queued — `MockLink.getMockedResponses()` keys by query, so
    // with an empty `mocks` array the matcher would never be consulted and
    // the counter would read 0 even for a query that DID fire (a fail-open
    // test).
    renderUploadRequestLayout({ isAdmin: false, mocks: [countingUserListMock()] });

    await act(async () => {
      await Promise.resolve();
    });

    expect(userListRequests.count).toBe(0);
  });

  // The other side of the same gate, so the counter above is known to be
  // wired to a query that CAN fire.
  it('issues the UserList query once for an admin viewer', async () => {
    renderUploadRequestLayout({
      isAdmin: true,
      targetLibraryId: undefined,
      mocks: [countingUserListMock()],
    });

    await waitFor(() => expect(userListRequests.count).toBe(1));
  });
});
