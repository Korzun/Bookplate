import { BookLineageRow, type BookLineageRowProps } from '~/component/book-lineage-row';
import { useFragment, type FragmentType } from '~/gql';
import type { LineageEntryFragmentFragment } from '~/gql/graphql';
import { LineageEntryFragment } from '~/graphql/book';

import { Button } from '../button';
import { useModalDialog } from '../use-modal-dialog';
import { useStyle } from './style';

type Props = {
  isOpen: boolean;
  /**
   * Relay GLOBAL id. Forwarded, unchanged, into every merge row's
   * `UnlinkBookLineageButton`, which passes it as `bookUnlinkDocument`'s `id`
   * input — the SDL declares `id: t.globalID({ required: true, for:
   * bookType })`, decoded server-side via `parseCompoundId`. A RAW content
   * hash here fails to decode; NEVER pass `documentId` (below) to this prop.
   */
  bookId: string;
  /**
   * RAW content hash — the CURRENT row's display id, used only as the
   * fallback when `lineage` is empty (no entry to derive a "current" id
   * from). Rendered as visible text next to the other raw hashes in this
   * list; never passed to any mutation. This is Task 10b's `Book.documentId`
   * at every real call site.
   *
   * Split from `bookId` (2026-08-13 review finding): before `page/book`
   * (task 11) populated real `lineage`, this modal's only caller passed the
   * same raw hash for BOTH purposes, which happened to work only because the
   * mutation path was unreachable with an always-empty list. Once lineage is
   * real, the two needs diverge — this prop exists so passing the GLOBAL id
   * to `bookId` can never silently end up rendered here instead.
   */
  documentId: string;
  bookTitle: string;
  addedAt?: number;
  lineage: FragmentType<typeof LineageEntryFragment>[];
  /**
   * Set when the LAZY `BookLineageDocument` read failed (`page/book`
   * forwards `useQuery`'s own `error?.message`). Load-bearing, not
   * decoration: with `lineage` defaulting to `[]` on failure, this modal
   * would otherwise render its EMPTY-LINEAGE presentation — a single
   * current row and nothing else — which asserts the positive fact "this
   * book has no edit history" when the truth is "we could not find out".
   * Empty is a meaningful answer here, so the failure must look different
   * from it. The string itself is not rendered (the copy below is fixed,
   * matching `page/book`'s own "Failed to load book."); its PRESENCE is
   * what switches the body.
   */
  error?: string;
  onClose: () => void;
};

const toMillis = (isoTimestamp: string): number => new Date(isoTimestamp).getTime();

/**
 * The current row's document id. Derived from the newest entry's `newId`
 * when `entries` is non-empty — `entries[0]` is the newest (the server
 * orders lineage `timestamp DESC`, mirrored by `Book.lineage`'s resolver,
 * `app/server/graphql/schema/book/model.ts:270-277`, calling the SAME
 * `getBookLineage` store method REST used), and per that store method
 * (`book-store.ts:530-559`) every entry's `newId` chains to the book's own
 * live id — `entries[0].newId` in particular equals it exactly, matching
 * this component's job of showing the book's OWN raw content hash for the
 * top row.
 *
 * When `entries` is EMPTY, there is no raw hash anywhere in this GraphQL
 * response to derive one from — `Book` deliberately exposes none itself
 * (see `LineageEntryFragment`'s doc comment on "the client never holds a raw
 * book id"; `oldId`/`newId` are the one sanctioned exception, and only via
 * lineage entries). REST's `getBookLineage` (`book-store.ts:558`, `return {
 * currentId: id, entries }`) always echoed back the exact `id` it was
 * called with as `currentId` regardless of whether `entries` was empty. The
 * `documentId` prop — a RAW content hash, never the GLOBAL `bookId` — is
 * what reproduces that rendered string byte-for-byte here.
 */
const currentDocumentId = (entries: LineageEntryFragmentFragment[], documentId: string): string =>
  entries.length > 0 ? entries[0].newId : documentId;

function buildLineageRows(
  entries: LineageEntryFragmentFragment[],
  bookId: string,
  documentId: string,
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
      documentId: currentDocumentId(entries, documentId),
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
 * No longer fetches — `lineage`, `bookId`, `documentId`, `bookTitle`, and
 * `addedAt` all arrive as props (`page/book`, task 11, has all five).
 * `lineage` stays MASKED at the type level until `useFragment` unmasks it
 * here, this component's own single, unconditional call — the same
 * convention `page/book/query.ts`'s doc comment on `lineage` describes for
 * its callers (that reasoning lived on the deleted `useBookDetail` hook
 * until Task 8).
 *
 * No loading state: that belonged to the REST-era fetch this component no
 * longer performs. It DOES take an `error` prop, though — see that prop's
 * own doc comment. The lazy split (2026-08-26) moved `lineage` onto its own
 * document, which turned a failed read from a visibly failed PAGE load into
 * a silently plausible empty list; this prop is what keeps the two
 * distinguishable.
 */
export const BookLineageModal = ({
  isOpen,
  bookId,
  documentId,
  bookTitle,
  addedAt,
  lineage,
  error,
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

  const lineageRowList = buildLineageRows(entries, bookId, documentId, bookTitle, addedAt);
  // Checked BEFORE the list, never OR-ed into it — see the `error` prop's
  // own doc comment: an empty list and a failed read are different answers,
  // and rendering the empty presentation for a failure states a fact that
  // may be false.
  const body =
    error !== undefined ? (
      <p className={styles.error}>
        Couldn&rsquo;t load this book&rsquo;s lineage. This is not the same as having none &mdash;
        close and reopen to try again.
      </p>
    ) : (
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
