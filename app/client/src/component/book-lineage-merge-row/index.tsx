import { UnlinkBookLineageButton } from '~/control';
import { formatTimestamp } from '~/utils';

import { useStyle } from './style';

export type BookLineageMergeRowProps = {
  bookId: string;
  documentId: string;
  timestamp?: number;
  onSuccess?: () => void;
};

export const BookLineageMergeRow = ({
  bookId,
  documentId,
  timestamp,
  onSuccess,
}: BookLineageMergeRowProps) => {
  const styles = useStyle();

  return (
    <li key={documentId} className={styles.entry}>
      <div className={styles.connector}>
        <div className={styles.dot} />
        <div className={styles.line} />
      </div>
      <div className={styles.entryContent}>
        <div className={styles.entryId}>
          {documentId}{' '}
          <span className={styles.button}>
            <UnlinkBookLineageButton
              buttonType="link"
              documentId={documentId}
              bookId={bookId}
              onSuccess={onSuccess}
            />
          </span>
        </div>
        <div className={styles.timestamp}>{formatTimestamp(timestamp).join(' · ')}</div>
      </div>
    </li>
  );
};
