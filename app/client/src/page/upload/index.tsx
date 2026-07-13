import { useCallback } from 'react';
import { Link } from 'react-router-dom';

import { Page, UploadItem, UploadZone } from '~/component';
import { LibrarySwitcher } from '~/component/library-switcher';
import type { PageActionItem } from '~/control';
import { useIsAdmin } from '~/provider/auth';
import { useScanLibrary, useUploadQueue } from '~/provider/book';
import { useLibraryTarget } from '~/provider/library-target';
import { useToast } from '~/provider/toast';
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

  const [scanLibrary, , scanning] = useScanLibrary();
  const showToast = useToast();

  const handleScan = useCallback(async () => {
    // The header action has no inline spinner (and on mobile it lives in the "⋯"
    // menu, which closes on tap), so announce the scan start explicitly.
    showToast('Scanning library…', 'info');
    const result = await scanLibrary();
    if (result === null) {
      showToast('Scan failed', 'error');
    } else {
      const changed = result.imported.length + result.removed.length;
      showToast(
        changed === 0
          ? 'Library already up to date'
          : `Scan complete: ${result.imported.length} imported, ${result.removed.length} removed`,
        'success'
      );
    }
  }, [scanLibrary, showToast]);

  const headerActions: PageActionItem[] = [
    {
      label: scanning ? 'Scanning…' : 'Library scan',
      onClick: () => void handleScan(),
      disabled: uploadsInProgress || scanning,
      primary: true,
      align: 'trailing',
    },
  ];

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
    <Page headerActions={headerActions}>
      <UploadZone addFiles={addFiles} />
      {items.length > 0 && (
        <div className={styles.queue}>
          {items.map((item) => (
            <UploadItem key={item.id} item={item} />
          ))}
        </div>
      )}
    </Page>
  );
};
