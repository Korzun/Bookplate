import { BookLineageRow, type BookLineageRowProps } from '~/component/book-lineage-row';
import {
  useBookLineage,
  type BookLineage,
  type LineageEntry,
} from '~/provider/book/hook/use-book-lineage';

import { Button } from '../button';
import { useModalDialog } from '../use-modal-dialog';
import { useStyle } from './style';

type Props = {
  isOpen: boolean;
  bookId: string;
  addedAt?: number;
  onClose: () => void;
};

function buildLineageRows(
  lineage: BookLineage,
  bookId: string,
  addedAt: number | undefined,
  refetch: () => void
): BookLineageRowProps[] {
  const { editEntries, mergeEntries } = lineage.entries.reduce(
    (entries, entry, index) => {
      if (entry.type === 'edit') {
        entries.editEntries.push({ entry, originalIndex: index });
      } else if (entry.type === 'merge') {
        entries.mergeEntries.push({ entry, originalIndex: index });
      }
      return entries;
    },
    {
      editEntries: [] as Array<{ entry: LineageEntry; originalIndex: number }>,
      mergeEntries: [] as Array<{ entry: LineageEntry; originalIndex: number }>,
    }
  );

  const rows: BookLineageRowProps[] = [
    {
      documentId: lineage.currentId,
      timestamp: lineage.entries.length > 0 ? lineage.entries[0].timestamp : addedAt,
      mergeRows: [],
    },
    ...editEntries.map(({ entry, originalIndex }) => ({
      documentId: entry.oldId,
      timestamp: lineage.entries[originalIndex + 1]?.timestamp ?? addedAt,
      mergeRows: [],
    })),
  ];

  mergeEntries.forEach(({ entry, originalIndex }) => {
    const parentIndex = rows.findIndex((row) => row.documentId === entry.newId);
    if (parentIndex === -1) return;
    rows[parentIndex].mergeRows.push({
      bookId,
      documentId: entry.oldId,
      timestamp: lineage.entries[originalIndex + 1]?.timestamp ?? addedAt,
      onSuccess: refetch,
    });
  });

  return rows;
}

export const BookLineageModal = ({ isOpen, bookId, addedAt, onClose }: Props) => {
  const styles = useStyle();
  const [lineage, loading, error, refetch] = useBookLineage(bookId);
  const modalRef = useModalDialog(isOpen, onClose);

  const handleClickBackground = (e: React.MouseEvent<HTMLDialogElement>) => {
    e.stopPropagation();
    onClose();
  };
  const handleClickDialog = (e: React.MouseEvent<HTMLDivElement>) => {
    e.stopPropagation();
  };

  let body: React.ReactNode;
  if (loading) {
    body = <p className={styles.loading}>Loading…</p>;
  } else if (error) {
    body = <p className={styles.error}>Failed to load lineage.</p>;
  } else {
    const lineageRowList = buildLineageRows(lineage, bookId, addedAt, refetch);
    body = (
      <ul className={styles.list}>
        {lineageRowList.map((lineageRow, index) => (
          <BookLineageRow
            key={lineageRow.documentId}
            isCurrent={index === 0}
            isInitial={index === lineageRowList.length - 1}
            {...lineageRow}
          />
        ))}
      </ul>
    );
  }

  return (
    <dialog ref={modalRef} className={styles.root} onClick={handleClickBackground}>
      <div className={styles.dialog} onClick={handleClickDialog}>
        <div className={styles.header}>Book lineage</div>
        <p className={styles.intro}>
          Editing or re-importing a book changes its ID. Lineage maps former IDs to this book so
          synced reading progress isn&rsquo;t lost.
        </p>
        <div className={styles.body}>{body}</div>
        <div className={styles.footer}>
          <Button type="primary" onClick={onClose} radius="modal">
            Close
          </Button>
        </div>
      </div>
    </dialog>
  );
};
