import cx from 'classnames';
import { Fragment } from 'react';

import { Button } from '~/control';
import { useMyProgressList } from '~/provider/library';

import { MyProgressRow } from '../my-progress-row';
import { useStyle } from './style';

/**
 * A CHILD of `Card`'s `isCollapsible`/`defaultCollapsed` pair
 * (`component/my-progress`), which does not render its children into the
 * tree at all while collapsed — so this component is only ever MOUNTED
 * while the card is expanded, and `skip: false` below is always correct at
 * this one call site. See `use-my-progress-list.ts`'s own doc comment for
 * the full mechanism.
 *
 * Renders rows fetch-free off `MyProgressList`'s connection: each
 * `MyProgressRow` unmasks its own `ProgressRowFragment` ref rather than
 * this component calling `useBook`/`useMyProgress` per row (the old REST
 * shape) or unmasking centrally in this `.map()` — see
 * `use-my-progress-list.ts`'s doc comment for why a shared unmask here
 * would collide with `react-hooks/rules-of-hooks`.
 */
export const MyProgressContent = () => {
  const styles = useStyle();

  const { rows, loading, error, hasNextPage, loadMore, loadingMore, libraryId } = useMyProgressList(
    {
      skip: false,
    }
  );

  if (loading) {
    return <div className={styles.message}>Loading...</div>;
  }
  // A first-page failure (no rows loaded yet) is the empty-error state. A
  // `fetchMore` failure with existing rows falls through to the list below,
  // which renders its own inline retry instead of replacing the rows.
  if (error && rows.length === 0) {
    return <div className={cx(styles.message, styles.error)}>Error loading progress</div>;
  }
  if (rows.length === 0) {
    return <div className={styles.message}>No progress synced</div>;
  }

  return (
    <Fragment>
      {rows.map((row) => (
        <MyProgressRow key={row.id} progress={row} libraryId={libraryId} />
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
