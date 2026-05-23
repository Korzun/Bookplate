import { LibraryScan, Page, UploadItem, UploadZone } from '~/component';
import { useIsAdmin } from '~/provider/auth';
import { useUploadQueue } from '~/provider/book';

import { useStyle } from './style';

export const UploadPage = () => {
  const styles = useStyle();
  const [isAdmin] = useIsAdmin();

  const { items, addFiles } = useUploadQueue();
  const uploadsInProgress = items.some((i) => i.status === 'queued' || i.status === 'uploading');

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
      {isAdmin && (
        <div className={styles.scanRow}>
          <div className={styles.spacer} />
          <LibraryScan disabled={uploadsInProgress} />
        </div>
      )}
    </Page>
  );
};
