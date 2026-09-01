import type { MockedResponse } from '@apollo/client/testing';
import { act, screen, waitFor } from '@testing-library/react';
import type { ReactElement } from 'react';
import { useEffect } from 'react';
import { Route, Routes, useOutletContext } from 'react-router';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { UserRowFragment } from '~/component/user-row';
import { makeFragmentData } from '~/gql';
import type { UserListQuery } from '~/gql/graphql';
import { UserListDocument } from '~/graphql/user';
import { renderWithApollo } from '~/test-utils';

import { AddPage, type AddOutletContext } from './index';

// ── auth / library-target mocks ─────────────────────────────────────────────
//
// Same shape as `page/library/index.test.tsx`'s own mocks: `AddPage` and the
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
}));

const DEFAULT_LIBRARY_ID = 'TGliOmJvYg==';

function makeUser(overrides: { id?: string; username?: string; libraryId?: string } = {}) {
  return {
    __typename: 'User' as const,
    ...makeFragmentData(
      {
        __typename: 'User' as const,
        id: overrides.id ?? 'u1',
        username: overrides.username ?? 'alice',
        progressCount: 0,
        pendingBookRequestCount: 0,
      },
      UserRowFragment
    ),
    library: { __typename: 'Library' as const, id: overrides.libraryId ?? DEFAULT_LIBRARY_ID },
  };
}

// `maxUsageCount: 2` — `AddPage`'s own admin-gate read of `UserListDocument`
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

function renderAddPage({
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
      <Route element={<AddPage />}>
        <Route index element={<div data-testid="add-outlet-child" />} />
      </Route>
    </Routes>,
    { mocks: mocks ?? (isAdmin ? [userListMock(users)] : []) }
  );
}

function renderAddPageWithChild(
  renderChild: (context: AddOutletContext) => ReactElement,
  { isAdmin = false, targetLibraryId }: { isAdmin?: boolean; targetLibraryId?: string } = {}
) {
  isAdminValue = isAdmin;
  targetLibraryIdValue = targetLibraryId;

  function ChildRoute() {
    const context = useOutletContext<AddOutletContext>();
    return renderChild(context);
  }

  return renderWithApollo(
    <Routes>
      <Route element={<AddPage />}>
        <Route index element={<ChildRoute />} />
      </Route>
    </Routes>,
    { mocks: isAdmin ? [userListMock([makeUser({ libraryId: targetLibraryId })])] : [] }
  );
}

describe('AddPage layout', () => {
  it('shows the library switcher and no toggle for an admin with no library selected', async () => {
    renderAddPage({ isAdmin: true, targetLibraryId: undefined });
    expect(await screen.findByText(/select a library/i)).toBeInTheDocument();
    // `AddToggle` (Task 3) does not exist yet — nothing renders a radiogroup.
    expect(screen.queryByRole('radiogroup')).not.toBeInTheDocument();
  });

  it('tells an admin to register a user when there are none', async () => {
    renderAddPage({ isAdmin: true, targetLibraryId: undefined, users: [] });
    // "No users registered" appears twice once the query settles: once as the
    // empty-state title, and once as the (now-disabled) switcher's own
    // placeholder — both are real, expected renderings of the same state, so
    // this asserts on the count rather than picking one via `getByText`.
    await waitFor(() => {
      expect(screen.getAllByText(/no users registered/i).length).toBe(2);
    });
  });

  it('renders the switcher and the child view once a library is selected', async () => {
    renderAddPage({ isAdmin: true, targetLibraryId: DEFAULT_LIBRARY_ID });
    // `LibrarySwitcher`'s real `Select` trigger has no ARIA `combobox` role
    // (see `control/select/index.tsx`) — its trigger is a `role="button"`
    // element whose accessible name is the selected option's label.
    expect(await screen.findByRole('button', { name: 'alice' })).toBeInTheDocument();
    expect(screen.getByTestId('add-outlet-child')).toBeInTheDocument();
  });

  it('renders no switcher for a reader, and goes straight to the child view', () => {
    renderAddPage({ isAdmin: false });
    expect(screen.queryByRole('button', { name: /select library/i })).not.toBeInTheDocument();
    expect(screen.getByTestId('add-outlet-child')).toBeInTheDocument();
  });

  it('renders header actions a child publishes through the outlet context', async () => {
    renderAddPageWithChild(({ setHeaderActions }) => {
      useEffect(() => {
        setHeaderActions([{ label: 'Do a thing', onClick: () => {} }]);
        return () => setHeaderActions(undefined);
      }, [setHeaderActions]);
      return <div />;
    });
    // `/actions/i` alone matches BOTH the desktop trigger ("Actions",
    // `actionsLabel` from `AddPage`) and the mobile trigger's static "More
    // actions" `aria-label` (`control/page-actions-bar`) — anchor to the
    // exact desktop label so this pins the layout's own `actionsLabel="Actions"`
    // prop, not just "some actions trigger exists".
    expect(await screen.findByRole('button', { name: /^actions$/i })).toBeInTheDocument();
  });
});

// ── The `UserListDocument` admin gate ────────────────────────────────────────
//
// Moved from `page/upload/index.test.tsx` (pre-Task-2): the admin gate itself
// — `skip: !isAdmin` on `AddPage`'s own read — moved out of the Upload view
// verbatim, so this coverage belongs with the layout now, not with
// `AddUploadView` (`page/add/upload.test.tsx`), which no longer touches
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
// The admin case's count is 1, not 2, even though BOTH `AddPage`'s own gate
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

describe('AddPage — UserList admin gate', () => {
  beforeEach(() => {
    userListRequests.count = 0;
  });

  it('does not issue the UserList query for a non-admin viewer', async () => {
    // The mock IS queued — `MockLink.getMockedResponses()` keys by query, so
    // with an empty `mocks` array the matcher would never be consulted and
    // the counter would read 0 even for a query that DID fire (a fail-open
    // test).
    renderAddPage({ isAdmin: false, mocks: [countingUserListMock()] });

    await act(async () => {
      await Promise.resolve();
    });

    expect(userListRequests.count).toBe(0);
  });

  // The other side of the same gate, so the counter above is known to be
  // wired to a query that CAN fire.
  it('issues the UserList query once for an admin viewer', async () => {
    renderAddPage({ isAdmin: true, targetLibraryId: undefined, mocks: [countingUserListMock()] });

    await waitFor(() => expect(userListRequests.count).toBe(1));
  });
});
