import cx from 'classnames';

import { formatTimestamp } from '~/utils';

import { BookLineageMergeRow, type BookLineageMergeRowProps } from '../book-lineage-merge-row';
import { useStyle } from './style';

export type BookLineageRowProps = {
  documentId: string;
  timestamp?: number;
  mergeRows: BookLineageMergeRowProps[];
  isCurrent?: boolean;
  isInitial?: boolean;
};

export const BookLineageRow = ({
  documentId,
  isCurrent = false,
  isInitial = false,
  timestamp,
  mergeRows,
}: BookLineageRowProps) => {
  const styles = useStyle();

  return (
    <li key={documentId} className={styles.entry}>
      <div className={styles.connector}>
        <div
          className={cx(styles.dot, {
            [styles.dotCurrent]: isCurrent,
          })}
        />
        {!isInitial && <div className={styles.line} />}
        {isInitial && mergeRows.length > 0 && (
          <div className={cx(styles.line, { [styles.isInitial]: isInitial })} />
        )}
      </div>
      <div
        className={cx(styles.entryContent, {
          [styles.isInitial]: isInitial,
        })}
      >
        <div className={styles.entryId}>{documentId}</div>
        <div className={styles.timestamp}>{formatTimestamp(timestamp).join(' · ')}</div>
        {mergeRows.map((row) => (
          <BookLineageMergeRow key={row.documentId} {...row} />
        ))}
      </div>
    </li>
  );
};
