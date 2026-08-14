import { UnlinkBookLineageButton } from '~/control/unlink-book-lineage-button';
import { formatTimestamp } from '~/utils';

import { useStyle } from './style';

export type BookLineageMergeRowProps = {
  bookId: string;
  bookTitle: string;
  documentId: string;
  timestamp?: number;
};

/**
 * `bookTitle` is forwarded straight through to `UnlinkBookLineageButton` —
 * this row has no other use for it. Added alongside task 10's move of that
 * button off `useBook` onto a plain prop; `BookLineageModal` (the only
 * caller) already has the title from its own `bookTitle` prop.
 *
 * No `onSuccess` prop (unlike the REST-era version): `bookUnlinkDocument`'s
 * payload re-selects the full `lineage` list, so Apollo's own normalization
 * is what removes this row on the next read of a LIVE `Book.lineage` query —
 * there is nothing left for a success callback to trigger (see
 * `graphql/book.ts`'s `BookUnlinkDocumentDocument` doc comment).
 */
export const BookLineageMergeRow = ({
  bookId,
  bookTitle,
  documentId,
  timestamp,
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
              bookTitle={bookTitle}
            />
          </span>
        </div>
        <div className={styles.timestamp}>{formatTimestamp(timestamp).join(' · ')}</div>
      </div>
    </li>
  );
};
