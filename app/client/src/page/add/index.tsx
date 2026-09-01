import { useQuery } from '@apollo/client/react';
import { useMemo, useState } from 'react';
import { Link, Outlet } from 'react-router';

import { Page } from '~/component';
import { LibrarySwitcher } from '~/component/library-switcher';
import { type PageActionItem } from '~/control';
import { UserListDocument } from '~/graphql/user';
import { useIsAdmin } from '~/provider/auth';
import { useLibraryTarget } from '~/provider/library-target';
import { path } from '~/router';

import { useStyle } from './style';

export type AddOutletContext = {
  /** Set by a child view to publish its page header actions; pass `undefined`
   *  to clear. Children MUST clear on unmount. */
  setHeaderActions: (actions: PageActionItem[] | undefined) => void;
};

/**
 * The `/add` layout: everything the Upload and Request views share.
 *
 * `<Page>` lives HERE rather than in each view because the shared chrome has to
 * render inside `<main>` — `page/library` puts `<LibrarySwitcher />` as the
 * first child of `<Page>` for the same reason, and chrome outside `<main>`
 * would fall outside the page's layout container. A layout route renders above
 * its `<Outlet />`, so `<Page>` comes up with the chrome.
 *
 * The consequence is `headerActions`: they are the Upload view's, and they now
 * travel upward through `AddOutletContext`. A view publishes on mount and
 * CLEARS ON UNMOUNT, which is what keeps one view's actions off the other —
 * switching views unmounts the child, so no route-change reset is needed here.
 *
 * The admin gate wraps BOTH views: with no library selected there is nothing to
 * toggle between, so neither the toggle nor the `<Outlet />` renders.
 *
 * The switcher is PERSISTENT, unlike `page/upload` before this change, where it
 * appeared only in the unselected state. The admin Request view is driven
 * entirely by the switcher, so changing library without leaving the page is a
 * requirement, not a convenience.
 */
export const AddPage = () => {
  const styles = useStyle();
  const [isAdmin] = useIsAdmin();
  const [targetLibraryId] = useLibraryTarget();
  // `UserListDocument` is imported from `~/graphql/user` (a leaf module —
  // this document has readers across multiple routes/providers, see its own
  // doc comment) — this only needs the count (for the "No users registered"
  // empty state), not any per-user field, so no fragment unmask is needed here.
  const { data: userListData, loading: userListLoading } = useQuery(UserListDocument, {
    skip: !isAdmin,
  });
  const userList = userListData?.viewer.users ?? [];

  const [headerActions, setHeaderActions] = useState<PageActionItem[] | undefined>(undefined);
  const context: AddOutletContext = useMemo(() => ({ setHeaderActions }), []);

  if (isAdmin && !targetLibraryId) {
    const noUsers = !userListLoading && userList.length === 0;
    return (
      <Page>
        <LibrarySwitcher />
        <div className={styles.emptyState}>
          {noUsers ? (
            <>
              <div className={styles.emptyStateTitle}>No users registered</div>
              <div className={styles.emptyStateSubtitle}>
                Go to the{' '}
                <Link className={styles.link} to={path.userList()}>
                  Users
                </Link>{' '}
                page to register the first user
              </div>
            </>
          ) : (
            <>
              <div className={styles.emptyStateTitle}>Select a library</div>
              <div className={styles.emptyStateSubtitle}>Choose a user above to upload books</div>
            </>
          )}
        </div>
      </Page>
    );
  }

  return (
    <Page headerActions={headerActions} actionsLabel="Actions">
      <LibrarySwitcher />
      <Outlet context={context} />
    </Page>
  );
};
