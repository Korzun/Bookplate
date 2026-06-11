import { LibraryScan, Page, UploadItem, UploadZone } from '~/component';
import { useIsAdmin } from '~/provider/auth';
import { useUploadQueue } from '~/provider/book';
import { useLibraryTarget } from '~/provider/library-target';

import { useStyle } from './style';

export const UploadPage = () => {
  const styles = useStyle();

  const [isAdmin] = useIsAdmin();
  const [targetUsername] = useLibraryTarget();

  const { items, addFiles } = useUploadQueue();
  const uploadsInProgress = items.some((i) => i.status === 'queued' || i.status === 'uploading');

  if (isAdmin && !targetUsername) {
    return (
      <Page>
        <div className={styles.emptyState}>
          <div className={styles.emptyStateTitle}>Select a library</div>
          <div className={styles.emptyStateSubtitle}>
            Choose a user from the library selector in the header to upload books
          </div>
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
