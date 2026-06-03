import cx from 'classnames';

import { useBookLineage } from '~/provider/book/hook/use-book-lineage';

import { Card } from '../card';

import { useStyle } from './style';

type Props = { bookId: string; addedAt?: number };

function formatTimestamp(ms: number): string {
  const d = new Date(ms);
  return `${d.toLocaleDateString(undefined, { year: 'numeric', month: 'short', day: 'numeric' })} · ${d.toLocaleTimeString(undefined, { hour: '2-digit', minute: '2-digit' })}`;
}

export const BookLineageCard = ({ bookId, addedAt }: Props) => {
  const styles = useStyle();
  const [lineage, loading, error] = useBookLineage(bookId);

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

  // Build display rows: current ID first, then old IDs newest-first.
  // Each row's timestamp = "when this ID first became the current book ID":
  //   current  → entries[0].timestamp  (last rename), or addedAt if no history
  //   entries[i].oldId → entries[i+1].timestamp (the rename that created it), or addedAt
  type Row = { id: string; timestamp: number | undefined; isCurrent: boolean; isInitial: boolean };
  const { entries } = lineage;

  const rows: Row[] = [
    {
      id: lineage.currentId,
      timestamp: entries.length > 0 ? entries[0].timestamp : addedAt,
      isCurrent: true,
      isInitial: false,
    },
    ...entries.map((entry, i) => ({
      id: entry.oldId,
      timestamp: entries[i + 1]?.timestamp ?? addedAt,
      isCurrent: false,
      isInitial: i === entries.length - 1,
    })),
  ];

  return (
    <Card title="ID Lineage">
      <ul className={styles.list}>
        {rows.map((row, i) => (
          <li key={row.id} className={styles.entry}>
            <div className={styles.connector}>
              <div
                className={cx(styles.dot, {
                  [styles.dotCurrent]: row.isCurrent,
                  [styles.dotInitial]: row.isInitial,
                })}
              />
              {i < rows.length - 1 && <div className={styles.line} />}
            </div>
            <div className={styles.entryContent}>
              <div className={styles.entryId}>
                {row.id}
                {row.isCurrent && (
                  <span className={cx(styles.badge, styles.badgeCurrent)}>current</span>
                )}
                {row.isInitial && (
                  <span className={cx(styles.badge, styles.badgeInitial)}>initial</span>
                )}
              </div>
              {row.timestamp !== undefined && (
                <div className={styles.timestamp}>{formatTimestamp(row.timestamp)}</div>
              )}
            </div>
          </li>
        ))}
      </ul>
    </Card>
  );
};
