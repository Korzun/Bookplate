import cx from 'classnames';
import { Fragment } from 'react';

import { Button } from '~/control';
import { useUserProgressList } from '~/provider/library';

import { UserProgressRow } from '../user-progress-row';
import { useStyle } from './style';

interface UserRowContentProps {
  /** The target user's Relay global id — from `UserRow`'s own `userId` prop. */
  userId: string;
  username: string;
}

/**
 * A CHILD of `Card`'s `isCollapsible`/`defaultCollapsed` pair
 * (`component/user-row`), which does not render its children into the tree
 * at all while collapsed — so this component is only ever MOUNTED while the
 * card is expanded, and `skip: false` below is always correct at this one
 * call site. Mirrors `MyProgressContent` (`component/my-progress-content`)
 * closely — see that component's own doc comment for the full mechanism —
 * rooted at `useUserProgressList(userId, ...)` instead of the viewer's own
 * `useMyProgressList`.
 *
 * Renders rows fetch-free off `UserProgressList`'s connection: each
 * `UserProgressRow` unmasks its own `ProgressRowFragment` ref rather than
 * this component calling `useBook`/`useUserProgress` per row (the old REST
 * shape) or unmasking centrally in this `.map()`.
 */
export const UserRowContent = ({ userId, username }: UserRowContentProps) => {
  const styles = useStyle();

  const { rows, loading, error, hasNextPage, loadMore, loadingMore, libraryId } =
    useUserProgressList(userId, {
      skip: false,
    });

  if (loading) {
    return <div className={styles.message}>Loading...</div>;
  }
  // A first-page failure (no rows loaded yet) is the empty-error state. A
  // `fetchMore` failure with existing rows falls through to the list below,
  // which renders its own inline retry instead of replacing the rows.
  if (error && rows.length === 0) {
    return <div className={cx(styles.message, styles.error)}>Error loading user progress</div>;
  }
  if (rows.length === 0) {
    return <div className={styles.message}>No progress synced</div>;
  }

  return (
    <Fragment>
      {rows.map((row) => (
        <UserProgressRow key={row.id} progress={row} username={username} libraryId={libraryId} />
      ))}
      {hasNextPage && (
        <Button type="link" onClick={loadMore} loading={loadingMore}>
          Load more
        </Button>
      )}
      {error && rows.length > 0 && (
        <div className={cx(styles.message, styles.error)}>
          Failed to load more progress
          <Button type="link" onClick={loadMore}>
            Retry
          </Button>
        </div>
      )}
    </Fragment>
  );
};
