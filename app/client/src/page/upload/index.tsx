import { Link } from 'react-router-dom';

import { LibraryScan, Page, UploadItem, UploadZone } from '~/component';
import { LibrarySwitcher } from '~/component/library-switcher';
import { useIsAdmin } from '~/provider/auth';
import { useUploadQueue } from '~/provider/book';
import { useLibraryTarget } from '~/provider/library-target';
import { useUserList } from '~/provider/user';
import { path } from '~/router';

import { useStyle } from './style';

export const UploadPage = () => {
  const styles = useStyle();

  const [isAdmin] = useIsAdmin();
  const [targetUsername] = useLibraryTarget();
  const [userList, userListLoading] = useUserList();

  const { items, addFiles } = useUploadQueue();
  const uploadsInProgress = items.some((i) => i.status === 'queued' || i.status === 'uploading');

  if (isAdmin && !targetUsername) {
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
    <Page>
      <UploadZone addFiles={addFiles} />
      {items.length > 0 && (
        <div className={styles.queue}>
          {items.map((item) => (
            <UploadItem key={item.id} item={item} />
          ))}
        </div>
      )}
      <div className={styles.scanRow}>
        <div className={styles.spacer} />
        <LibraryScan disabled={uploadsInProgress} />
      </div>
    </Page>
  );
};
