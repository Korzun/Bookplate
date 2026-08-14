import { BookLineageRow, type BookLineageRowProps } from '~/component/book-lineage-row';
import { useFragment, type FragmentType } from '~/gql';
import type { LineageEntryFragmentFragment } from '~/gql/graphql';
import { LineageEntryFragment } from '~/graphql/book';

import { Button } from '../button';
import { useModalDialog } from '../use-modal-dialog';
import { useStyle } from './style';

type Props = {
  isOpen: boolean;
  bookId: string;
  bookTitle: string;
  addedAt?: number;
  lineage: FragmentType<typeof LineageEntryFragment>[];
  onClose: () => void;
};

const toMillis = (isoTimestamp: string): number => new Date(isoTimestamp).getTime();

/**
 * The current row's document id. Derived from the newest entry's `newId`
 * when `entries` is non-empty — `entries[0]` is the newest (the server
 * orders lineage `timestamp DESC`, mirrored by `Book.lineage`'s resolver,
 * `app/server/graphql/schema/book/model.ts:270-277`, calling the SAME
 * `getBookLineage` store method REST used), and per that store method
 * (`book-store.ts:530-553`) every entry's `newId` chains to the book's own
 * live id — `entries[0].newId` in particular equals it exactly, matching
 * this component's job of showing the book's OWN raw content hash for the
 * top row.
 *
 * When `entries` is EMPTY, there is no raw hash anywhere in this GraphQL
 * response to derive one from — `Book` deliberately exposes none itself
 * (see `LineageEntryFragment`'s doc comment on "the client never holds a raw
 * book id"; `oldId`/`newId` are the one sanctioned exception, and only via
 * lineage entries). REST's `getBookLineage` (`book-store.ts:552`, `return {
 * currentId: id, entries }`) always echoed back the exact `id` it was
 * called with as `currentId` regardless of whether `entries` was empty —
 * the same `bookId` this component receives as a prop. Falling back to
 * `bookId` here reproduces REST's rendered string byte-for-byte, AS LONG AS
 * `bookId` is still a raw hash — true today (`page/book` still sources it
 * from the REST `useBook` hook, not yet `useBookDetail`; see task 10's
 * report for the caveat once that changes).
 */
const currentDocumentId = (entries: LineageEntryFragmentFragment[], bookId: string): string =>
  entries.length > 0 ? entries[0].newId : bookId;

function buildLineageRows(
  entries: LineageEntryFragmentFragment[],
  bookId: string,
  bookTitle: string,
  addedAt: number | undefined
): BookLineageRowProps[] {
  const { editEntries, mergeEntries } = entries.reduce(
    (acc, entry, index) => {
      if (entry.type === 'EDIT') {
        acc.editEntries.push({ entry, originalIndex: index });
      } else if (entry.type === 'MERGE') {
        acc.mergeEntries.push({ entry, originalIndex: index });
      }
      return acc;
    },
    {
      editEntries: [] as Array<{ entry: LineageEntryFragmentFragment; originalIndex: number }>,
      mergeEntries: [] as Array<{ entry: LineageEntryFragmentFragment; originalIndex: number }>,
    }
  );

  const timestampFor = (originalIndex: number): number | undefined => {
    const next = entries[originalIndex + 1];
    return next ? toMillis(next.timestamp) : addedAt;
  };

  const rows: BookLineageRowProps[] = [
    {
      documentId: currentDocumentId(entries, bookId),
      timestamp: entries.length > 0 ? toMillis(entries[0].timestamp) : addedAt,
      mergeRows: [],
    },
    ...editEntries.map(({ entry, originalIndex }) => ({
      documentId: entry.oldId,
      timestamp: timestampFor(originalIndex),
      mergeRows: [],
    })),
  ];

  mergeEntries.forEach(({ entry, originalIndex }) => {
    const parentIndex = rows.findIndex((row) => row.documentId === entry.newId);
    if (parentIndex === -1) return;
    rows[parentIndex].mergeRows.push({
      bookId,
      bookTitle,
      documentId: entry.oldId,
      timestamp: timestampFor(originalIndex),
    });
  });

  return rows;
}

/**
 * No longer fetches — `lineage`, `bookId`, `bookTitle`, and `addedAt` all
 * arrive as props (`page/book` has all four). `lineage` stays MASKED at the
 * type level until `useFragment` unmasks it here, this component's own
 * single, unconditional call — the same convention `useBookDetail`'s doc
 * comment on `lineage` describes for its future callers.
 *
 * No loading/error states either: those belonged to the REST-era fetch this
 * component no longer performs. A caller not yet on a live GraphQL read
 * (`page/book`, until task 11) simply passes `lineage={[]}`.
 */
export const BookLineageModal = ({
  isOpen,
  bookId,
  bookTitle,
  addedAt,
  lineage,
  onClose,
}: Props) => {
  const styles = useStyle();
  const entries = useFragment(LineageEntryFragment, lineage);
  const modalRef = useModalDialog(isOpen, onClose);

  const handleClickBackground = (e: React.MouseEvent<HTMLDialogElement>) => {
    e.stopPropagation();
    onClose();
  };
  const handleClickDialog = (e: React.MouseEvent<HTMLDivElement>) => {
    e.stopPropagation();
  };

  const lineageRowList = buildLineageRows(entries, bookId, bookTitle, addedAt);
  const body = (
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
