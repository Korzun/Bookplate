import { LibraryScan, Page, UploadItem, UploadZone } from '~/component';
import { useUploadQueue } from '~/provider/book';

import { useStyle } from './style';

export const UploadPage = () => {
  const styles = useStyle();

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
      <div className={styles.scanRow}>
        <div className={styles.spacer} />
        <LibraryScan disabled={uploadsInProgress} />
      </div>
    </Page>
  );
};
