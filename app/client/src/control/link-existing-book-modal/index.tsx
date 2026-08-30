import { useCallback, useEffect, useMemo, useState } from 'react';

import { LinkPickerBooksDocument } from '~/graphql/progress';
import { usePaginatedConnection } from '~/lib/use-paginated-connection';

import { Button } from '../button';
import { useModalDialog } from '../use-modal-dialog';
import { useStyle } from './style';

/**
 * Unchanged from `link-progress-modal`'s own `DEBOUNCE_MS` — see that
 * component's doc comment for why this codebase has exactly one other
 * inline debounce implementation and no shared helper.
 */
const DEBOUNCE_MS = 200;

type LinkExistingBookModalProps = {
  isOpen: boolean;
  /**
   * The Relay global id of the Library to pick a book FROM — the requesting
   * reader's own library (`BookRequestRow`'s `target.libraryId`), never
   * `useCurrentLibraryId()`'s admin switcher selection. Roots
   * `LinkPickerBooksDocument`'s `node(id: $libraryId)`, exactly as
   * `LinkProgressModal` does for a NAMED library.
   */
  libraryId: string;
  /** Fired the instant a book is clicked — there is no separate "select,
   * then confirm" step here (unlike `LinkProgressModal`): the caller
   * (`BookRequestRow`) owns what picking a book actually DOES
   * (`bookRequestFulfill`), so this modal's only job is reporting which book
   * was picked. */
  onPick: (bookGlobalId: string) => void;
  onClose: () => void;
};

/**
 * Picks a book out of a NAMED library — the admin's recovery path when
 * auto-fulfil fails, and the route for an admin who uploaded the book before
 * opening the request (`component/book-request-row`, Task 14).
 *
 * Modelled directly on `control/link-progress-modal`, which is the closest
 * existing precedent for "list a library's entries, rooted at a caller-given
 * `libraryId` rather than `useCurrentLibraryId()`, with a debounced
 * server-side search". The one structural difference: that modal selects a
 * book into local state and waits for a separate "Link" confirm click,
 * because it also owns the `bookLinkDocument` mutation (and the cache evicts
 * that come with it) directly. This modal owns no mutation — `onPick` fires
 * immediately on click, and the CALLER decides what a pick means (here,
 * `bookRequestFulfill`) and closes this modal once it is done. Reusing
 * `LinkPickerBooksDocument` rather than declaring a near-duplicate query
 * keeps this task's only two cost-budget moves the ones the brief calls out
 * (`UserRequestListDocument`'s `library { id }`, and the new
 * `BookRequestDeclineDocument`) — a third, near-identical query would have
 * been a needless third move.
 */
export function LinkExistingBookModal({
  isOpen,
  libraryId,
  onPick,
  onClose,
}: LinkExistingBookModalProps) {
  const styles = useStyle();

  const [filter, setFilter] = useState('');
  const [debouncedFilter, setDebouncedFilter] = useState('');

  useEffect(() => {
    const timer = setTimeout(() => setDebouncedFilter(filter.trim()), DEBOUNCE_MS);
    return () => clearTimeout(timer);
  }, [filter]);

  const { edges, loading, loadingMore, error, hasNextPage, loadMore } = usePaginatedConnection({
    document: LinkPickerBooksDocument,
    variables: { libraryId, query: debouncedFilter || undefined },
    skip: !isOpen,
    select: (data) => (data?.node?.__typename === 'Library' ? data.node.entries : undefined),
    resetKey: `${libraryId}:${debouncedFilter}`,
    loadMoreErrorMessage: 'Failed to load more books',
  });

  // `Library.entries` returns the `LibraryEntry` union (`Book | Series`) —
  // discarded here for the same reason `LinkProgressModal` discards it: no
  // `entryType` filter exists that keeps only standalone books without also
  // hiding every series-grouped one (see `LinkPickerBooksDocument`'s own doc
  // comment).
  const books = useMemo(
    () =>
      edges
        .map((edge) => edge.node)
        .filter(
          (node): node is Extract<typeof node, { __typename: 'Book' }> => node.__typename === 'Book'
        ),
    [edges]
  );

  const handleCancel = useCallback(() => onClose(), [onClose]);
  // Escape dismisses the modal the same way Cancel does.
  const modalRef = useModalDialog(isOpen, handleCancel);

  const handleClickBackground = useCallback(
    (e: React.MouseEvent<HTMLDialogElement>) => {
      e.stopPropagation();
      handleCancel();
    },
    [handleCancel]
  );

  const handleClickDialog = useCallback((e: React.MouseEvent<HTMLDivElement>) => {
    e.stopPropagation();
  }, []);

  return (
    <dialog ref={modalRef} className={styles.root} onClick={handleClickBackground}>
      <div className={styles.dialog} onClick={handleClickDialog}>
        <div className={styles.header}>Link Existing Book</div>
        <div className={styles.body}>
          <input
            className={styles.searchInput}
            type="text"
            placeholder="Filter by title or author…"
            value={filter}
            onChange={(e) => setFilter(e.target.value)}
            autoFocus
          />
          <ul className={styles.bookList}>
            {loading ? (
              <li className={styles.emptyMessage}>Loading books…</li>
            ) : error !== undefined && books.length === 0 ? (
              <li className={styles.emptyMessage}>{error || 'Failed to load books.'}</li>
            ) : books.length === 0 ? (
              <li className={styles.emptyMessage}>No books match.</li>
            ) : (
              books.map((book) => (
                <li key={book.id} className={styles.bookItem}>
                  <button
                    type="button"
                    className={styles.bookItemButton}
                    onClick={() => onPick(book.id)}
                  >
                    <div className={styles.bookTitle}>{book.title}</div>
                    {book.author && <div className={styles.bookAuthor}>{book.author}</div>}
                  </button>
                </li>
              ))
            )}
          </ul>
          {hasNextPage && (
            <Button type="link" onClick={loadMore} loading={loadingMore}>
              Load more
            </Button>
          )}
          {error !== undefined && books.length > 0 && <div className={styles.error}>{error}</div>}
        </div>
        <div className={styles.footer}>
          <Button type="text" onClick={handleCancel} radius="modal">
            Cancel
          </Button>
        </div>
      </div>
    </dialog>
  );
}
