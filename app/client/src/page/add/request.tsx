import { BookRequestsContent } from '~/component/book-requests-content';
import { UserRequestList } from '~/component/user-request-list';
import { useIsAdmin } from '~/provider/auth';
import { useWithTargetUser } from '~/provider/library-target';

/**
 * The Request view. Branches on `isAdmin`, and each branch mounts a component
 * that already exists — this route is a new home for them, not new UI.
 *
 * `skip={false}`: `BookRequestsContent` keeps `skip` as a required prop for the
 * reason its own doc comment gives (its tests gate the query directly rather
 * than depending on a parent's mount timing). The lazy-mount gate that the
 * deleted `/user` card provided is now the toggle itself — this view is not
 * mounted at all until the reader switches to it.
 *
 * The `data-testid="add-request-view"` wrapper exists for the toggle's own
 * navigation test (`page/add/index.test.tsx`): it needs a mount marker that
 * does not depend on `BookRequestsContent`'s query settling.
 *
 * The admin branch mounts `UserRequestList` scoped to whichever library the
 * (persistent, page-level) switcher currently targets — `useWithTargetUser`
 * resolves the switcher's Library global id to the matching User global id
 * `UserRequestList` needs, off the same `UserListDocument` row it already
 * matches to resolve `username` (see that hook's own doc comment). No wrapper
 * `data-testid` here: `UserRequestList` renders its own rows/empty state,
 * which is marker enough once mounted.
 */
export const AddRequestView = () => {
  const [isAdmin] = useIsAdmin();
  const withTargetUser = useWithTargetUser();

  if (!isAdmin) {
    return (
      <div data-testid="add-request-view">
        <BookRequestsContent skip={false} />
      </div>
    );
  }

  // `AddPage`'s admin gate means an admin only reaches this view with a
  // library selected, so `userId` is resolved in practice. The guard below is
  // for the frame between a switcher change and the user list resolving.
  const userId = withTargetUser.userId;
  if (userId === undefined) return null;

  return <UserRequestList userId={userId} skip={false} />;
};
