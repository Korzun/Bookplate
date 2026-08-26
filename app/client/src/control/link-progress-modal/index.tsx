import cx from 'classnames';
import { useCallback, useEffect, useMemo, useState } from 'react';

import { LinkPickerBooksDocument } from '~/graphql/progress';
import { usePaginatedConnection } from '~/lib/use-paginated-connection';
import { useLinkProgress } from '~/provider/library';

import { Button } from '../button';
import { useModalDialog } from '../use-modal-dialog';
import { useStyle } from './style';

type LinkProgressModalProps = {
  isOpen: boolean;
  /** The orphan row's raw document hash — what `bookLinkDocument` takes. */
  documentId: string;
  /**
   * The Relay global id of the Library to pick a book FROM — the viewer's
   * own library (`MyProgressRow`) or the target user's (`UserProgressRow`).
   * Roots `LinkPickerBooksDocument`'s `node(id: $libraryId)`.
   */
  libraryId: string;
  /**
   * The orphan row's `Progress.id` — the caller already has it (this modal
   * is only ever opened from a component rendering that exact row). Passed
   * straight through as `useLinkProgress`'s second `link` argument, which
   * uses it to evict the stale orphan entity from the cache on success.
   */
  progressId: string;
  onClose: () => void;
};

/**
 * Unchanged from `use-search-suggestions.ts`'s own `DEBOUNCE_MS` — the one
 * other place in this codebase that turns typed input into a server-side
 * filtered query. No shared debounce helper exists in this codebase (only
 * that one prior inline `setTimeout` implementation), so this mirrors that
 * shape directly rather than introducing a new abstraction for a second use.
 */
const DEBOUNCE_MS = 200;

/**
 * Replaces the REST version's `useUserBookList` (fetch-the-whole-library,
 * filter client-side as you type) with `LinkPickerBooksDocument`, filtered
 * SERVER-SIDE via `LibraryFilter.query` — the same mechanism the library
 * grid's search uses (`useLibraryEntries`). That is a real interaction
 * change (a round trip per query instead of an instant local filter), so
 * the typed input is debounced (`DEBOUNCE_MS`) before it becomes a query
 * variable — mirroring `useSearchSuggestions`'s identical shape: `filter`
 * is the raw input, `debouncedFilter` only ever advances from inside the
 * `setTimeout` callback, and clearing/replacing the pending timer on every
 * keystroke is what makes a fast typist collapse into one request instead
 * of one per character.
 *
 * `Library.entries` returns the `LibraryEntry` union (`Book | Series`) —
 * `LinkPickerBooksDocument`'s own doc comment explains why `entryType` is
 * NOT set (no `BOOK` value on `LibraryEntryType`, and `STANDALONE` would
 * silently hide every series-grouped book). This component narrows on
 * `__typename === 'Book'` after the fetch, discarding any `Series` entries
 * the union-typed connection returns.
 *
 * **Load more**: offered, matching every other paginated list in this app
 * (`MyProgressContent`, `UserRowContent`, the library grid). The document
 * fetches `first: 100` per page — since a `Series`-heavy library can dilute
 * a page with entries this component discards, AND the initial (unfiltered)
 * fetch can legitimately exceed 100 books, omitting a way to reach further
 * pages would silently hide real books from the picker. `hasNextPage`/
 * `fetchMore` are cheap to wire (the document already carries `pageInfo`/
 * `cursor` for exactly this) and keep this modal consistent with the rest
 * of the app's list affordances rather than a special case.
 *
 * `useLinkProgress(selectedBookId ?? '', libraryId)`'s `link(documentId,
 * progressId)` both selects the target book (this modal's job) and evicts
 * the stale orphan `Progress` entity plus the owning `Library.progress`
 * connection field from the cache on success (that hook's own job — see
 * `use-progress-mutations.ts`'s doc comment, I-3) — without `libraryId`, the
 * hook has no `Library` to invalidate, and the just-linked row would vanish
 * from the list instead of reappearing attached to its book; without
 * `progressId`, the link succeeds server-side but the stale orphan entity
 * lingers.
 *
 * Fetching is `usePaginatedConnection` (`~/lib/use-paginated-connection`),
 * the same helper `useLibraryEntries`/`useMyProgressList`/`useUserProgressList`
 * are built on — this modal was the fourth hand-rolled copy of that exact
 * state machine, now the fourth call site instead. `resetKey` is
 * `${libraryId}:${debouncedFilter}` — this list's own identity, the same
 * shape as `useLibraryEntries`'s `${libraryId}:${JSON.stringify(filter)}`
 * (see that hook's doc comment): a change to either clears a stale
 * `loadMore` error rather than letting it linger over an unrelated list.
 * `error`/`books.length` follow the same split every other list in this app
 * does: a first-page failure replaces the list with an error row (`books`
 * empty), a `loadMore` failure keeps the rows and surfaces the error below
 * instead (`books` non-empty) — `page/library`'s own JSX follows the
 * identical pattern.
 */
export function LinkProgressModal({
  isOpen,
  documentId,
  libraryId,
  progressId,
  onClose,
}: LinkProgressModalProps) {
  const styles = useStyle();

  const [filter, setFilter] = useState('');
  const [debouncedFilter, setDebouncedFilter] = useState('');
  const [selectedBookId, setSelectedBookId] = useState<string | null>(null);

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

  const books = useMemo(
    () =>
      edges
        .map((edge) => edge.node)
        .filter(
          (node): node is Extract<typeof node, { __typename: 'Book' }> => node.__typename === 'Book'
        ),
    [edges]
  );

  const { link, linking, error: linkError } = useLinkProgress(selectedBookId ?? '', libraryId);

  const handleConfirm = useCallback(async () => {
    if (!selectedBookId) return;
    const ok = await link(documentId, progressId);
    if (ok) onClose();
  }, [selectedBookId, link, documentId, progressId, onClose]);

  const handleCancel = useCallback(() => onClose(), [onClose]);
  // Escape dismisses the modal the same way the Cancel button does.
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
        <div className={styles.header}>Link Progress</div>
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
            ) : error && books.length === 0 ? (
              <li className={styles.emptyMessage}>{error}</li>
            ) : books.length === 0 ? (
              <li className={styles.emptyMessage}>No books match.</li>
            ) : (
              books.map((book) => (
                <li
                  key={book.id}
                  className={cx(styles.bookItem, {
                    [styles.bookItemSelected]: book.id === selectedBookId,
                  })}
                >
                  <button
                    type="button"
                    className={styles.bookItemButton}
                    onClick={() => setSelectedBookId(book.id)}
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
          {error && books.length > 0 && <div className={styles.error}>{error}</div>}
          {linkError && <div className={styles.error}>{linkError}</div>}
        </div>
        <div className={styles.footer}>
          <Button type="text" onClick={handleCancel} radius="modal">
            Cancel
          </Button>
          <Button
            type="primary"
            disabled={!selectedBookId || !books.some((b) => b.id === selectedBookId) || linking}
            loading={linking}
            onClick={() => void handleConfirm()}
            radius="modal"
          >
            Link
          </Button>
        </div>
      </div>
    </dialog>
  );
}
