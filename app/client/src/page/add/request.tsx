import { BookRequestsContent } from '~/component/book-requests-content';
import { useIsAdmin } from '~/provider/auth';

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
 */
export const AddRequestView = () => {
  const [isAdmin] = useIsAdmin();
  if (isAdmin) return null; // the admin branch lands in the next task
  return (
    <div data-testid="add-request-view">
      <BookRequestsContent skip={false} />
    </div>
  );
};
