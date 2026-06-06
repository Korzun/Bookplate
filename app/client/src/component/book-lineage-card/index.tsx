import { useBookLineage } from '~/provider/book/hook/use-book-lineage';

import { BookLineageRow, type BookLineageRowProps } from '../book-lineage-row';
import { Card } from '../card';

import { useStyle } from './style';

type Props = { bookId: string; addedAt?: number };

export const BookLineageCard = ({ bookId, addedAt }: Props) => {
  const styles = useStyle();
  const [lineage, loading, error, refetch] = useBookLineage(bookId);

  if (loading) {
    return (
      <Card title="ID Lineage">
        <p className={styles.loading}>Loading…</p>
      </Card>
    );
  }

  if (error) {
    return (
      <Card title="ID Lineage">
        <p className={styles.error}>Failed to load lineage.</p>
      </Card>
    );
  }

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
      editEntries: [] as Array<{ entry: (typeof lineage.entries)[0]; originalIndex: number }>,
      mergeEntries: [] as Array<{ entry: (typeof lineage.entries)[0]; originalIndex: number }>,
    }
  );

  const lineageRowList: BookLineageRowProps[] = [
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
    const parentIndex = lineageRowList.findIndex((row) => row.documentId === entry.newId);
    if (parentIndex === -1) return;
    lineageRowList[parentIndex].mergeRows.push({
      bookId: bookId,
      documentId: entry.oldId,
      timestamp: lineage.entries[originalIndex + 1]?.timestamp ?? addedAt,
      onSuccess: refetch,
    });
  });

  return (
    <Card title="ID Lineage">
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
    </Card>
  );
};
