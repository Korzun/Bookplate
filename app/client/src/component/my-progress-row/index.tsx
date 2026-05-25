import { useBook } from '~/provider/book';
import { useMyProgress } from '~/provider/progress';
import { relativeTime } from '~/utils';

import { ProgressIndicator } from '../progress-indicator';

import { useStyle } from './style';

interface MyProgressRowProps {
  bookId: string;
}

export const MyProgressRow = ({ bookId }: MyProgressRowProps) => {
  const styles = useStyle();

  const [book] = useBook(bookId);
  const [progress, progressLoading, progressError] = useMyProgress(bookId);

  if (progressLoading) {
    return <div className={styles.loading}>Loading…</div>;
  }
  if (progressError) {
    return <div className={styles.error}>Error loading progress</div>;
  }
  if (progress === undefined) {
    return null;
  }

  const bookTitle = book?.title ?? progress.document;

  const metadataList: string[] = [];
  if (progress.device) metadataList.push(progress.device);
  if (progress.timestamp != null) metadataList.push(relativeTime(progress.timestamp));

  return (
    <div className={styles.root}>
      <div className={styles.progress}>
        <ProgressIndicator value={progress.percentage} size={14} />
      </div>
      <div className={styles.book}>{bookTitle}</div>
      <div className={styles.metadata}>{metadataList.join(' · ')}</div>
    </div>
  );
};
