import { useMutation } from '@apollo/client/react';
import cx from 'classnames';
import { useCallback, useEffect, useMemo, useState } from 'react';

import type { BookLinkDocumentMutation } from '~/gql/graphql';
import { BookLinkDocumentDocument, LinkPickerBooksDocument } from '~/graphql/progress';
import { usePaginatedConnection } from '~/lib/use-paginated-connection';
import { unwrapResult } from '~/provider/apollo';

import { Button } from '../button';
import { useModalDialog } from '../use-modal-dialog';
import { useStyle } from './style';

// `unwrapResult`'s `TPayload` sits in a position TypeScript cannot infer
// from the call, so it is named explicitly here, extracted from the
// generated union rather than hand-duplicated.
type BookLinkDocumentPayload = Extract<
  NonNullable<BookLinkDocumentMutation['bookLinkDocument']>,
  { __typename: 'BookLinkDocumentPayload' }
>;

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
   * is only ever opened from a component rendering that exact row). Used to
   * evict the stale orphan entity from the cache on success (`handleConfirm`
   * below).
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
 * `handleConfirm`'s `bookLinkDocument` call (below) both selects the target
 * book (this modal's job) and evicts the stale orphan `Progress` entity
 * plus the owning `Library.progress` connection field from the cache on
 * success — without `libraryId`, there is no `Library` to invalidate, and
 * the just-linked row would vanish from the list instead of reappearing
 * attached to its book; without `progressId`, the link succeeds
 * server-side but the stale orphan entity lingers. `useMutation` is called
 * directly here (Task 4) rather than through a shared hook: this modal is
 * `bookLinkDocument`'s only caller, and is itself rendered exclusively from
 * `MyProgressRow`/`UserProgressRow` — mirroring `DeviceRow`'s/`UserRow`'s
 * "this row is its only caller" inline `useMutation` shape.
 *
 * The REST predecessor (`provider/progress/hook/use-link-progress.ts`) took
 * a `bookId` (raw) plus a `username`, scoped the URL for an admin caller,
 * and — on success — re-keyed the orphan progress entry it held locally so
 * the row stayed visible under the book's id instead of vanishing from the
 * cached list (`mergeLinkedProgress`). None of that carries over as-is:
 *
 *   - The URL-scoping-by-username split is gone: `bookLinkDocument` takes
 *     the `Book` GLOBAL id alone (the selected book's own `id`) and
 *     authorises the DECODED owner it carries server-side
 *     (`graphql/schema/book/mutation/link-document.ts`), the same
 *     admin-capable-via-id-not-via-query-param shape every other book
 *     mutation in this migration already uses. There is no separate "admin
 *     scope" argument to thread through any more.
 *
 *   - `book { id lineage { oldId newId type } }` re-selects the FULL
 *     lineage list, so Apollo's own normalization overwrites the array on
 *     the existing `Book:<id>` entity — no hand-written `update` needed
 *     (`graphql/progress.ts`'s own doc comment already calls this out;
 *     this file's own "normalizes the returned book.lineage onto the Book
 *     entity without a hand-written update" test asserts it directly
 *     against the cache, per this migration's rule that a
 *     normalization-suffices claim must be pinned by a cache assertion,
 *     not just left as an absence of code).
 *
 *   - The re-keyed ORPHAN PROGRESS ENTRY's replacement was originally a
 *     single-entity `cache.evict` alone (`cache.evict({ id: cache.identify({
 *     __typename: 'Progress', id: progressId }) })` + `cache.gc()`),
 *     mirroring `useDeleteProgress`'s (`lib/use-progress-mutations`) evict-the-entity
 *     -and-let-the-connection-self-heal shape. **That undersold what the
 *     server actually did** (I-3, final whole-branch review): `Progress.id`
 *     is derived from the compound key `[userId, document]`
 *     (`progress/mutation/delete.ts`'s `decodeProgressId`), and
 *     `linkDocument`'s own transaction (`book-store.ts`) DELETES the orphan
 *     row and CREATES a new one keyed to `document: bookId` — so the linked
 *     row gets a NEW global id the client never learns
 *     (`BookLinkDocumentPayload` carries only `book`). Evicting only the
 *     old, now-nonexistent entity left the connection with one fewer edge
 *     and nothing to replace it: the row the user just linked disappeared
 *     from the list instead of re-appearing attached to its book, until an
 *     unrelated full reload happened to refetch it.
 *
 *     The fix ADDS a FIELD-level evict alongside the existing entity-level
 *     one — the same TWO-evictions shape `page/book`'s delete already uses for
 *     the identical reason (`use-delete-book.ts`'s doc comment, points 1
 *     and 2: evict the now-gone entity itself, AND evict the owning
 *     connection field when the entity's removal has a side effect the
 *     connection can't self-heal from). The entity evict here still
 *     matters on its own — it drops the stale `Progress:<progressId>`
 *     (`book: null`) immediately, in case anything besides
 *     `Library.progress` ever holds a direct reference to it. The field
 *     evict is the actual I-3 fix: `libraryId` (this modal's own prop)
 *     invalidates `Library.progress` wholesale, forcing the next read to
 *     miss the cache and refetch. `Library.progress` carries no `keyArgs`
 *     (`cacheConfig`, `graphql/progress.ts`'s own doc comments), so this
 *     one evict invalidates BOTH `MyProgressListDocument`
 *     (`component/my-progress-content`) and `UserProgressListDocument`'s
 *     (`component/user-row-content`) cached page for that library — the
 *     refetch it forces is what brings the row back correctly attached to
 *     its book, under its real (new) id, instead of leaving a hole where
 *     the evicted entity's edge used to be.
 *
 *     **Invariant this relies on, not itself enforced here**: `handleConfirm`
 *     must only ever fire for a `progressId` whose `book` is `null` — i.e. a
 *     genuine orphan, not one some `Book.progress` field already points at.
 *     Today that's guaranteed by two CALLERS, not this component:
 *     `MyProgressRow`/`UserProgressRow` render the "Link" affordance only
 *     when `row.book === null`, and by construction such a row is never the
 *     target of a `Book.progress` reference. If that ever stopped being
 *     true, this would leave a stale `Book.progress` reference to the
 *     just-evicted entity dangling — there is no equivalent of
 *     `useDeleteProgress`'s scan-and-null-Book step here, because none has
 *     ever been needed under the invariant above.
 *
 *   **Seen-to-fail**: deleting the `fieldName: 'progress'` `cache.evict`
 *   call below (leaving only the entity-level evict) leaves "re-fetches
 *   Library.progress after a link so the row reappears attached to its
 *   book" failing — the connection's cached page survives with one fewer
 *   edge and no network refetch is ever triggered, so the just-linked row
 *   never comes back. Restored.
 *
 * Fetching is `usePaginatedConnection` (`~/lib/use-paginated-connection`),
 * the same helper `useLibraryEntries`/`MyProgressContent`/`UserRowContent`
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

  const [runLink] = useMutation(BookLinkDocumentDocument);
  const [linking, setLinking] = useState(false);
  const [linkError, setLinkError] = useState<string | undefined>();

  // Re-entrancy guard, matching the deleted `useLinkProgress`'s own: a
  // second confirm click while the first mutation is still in flight is a
  // no-op rather than a second request.
  const handleConfirm = useCallback(async () => {
    if (!selectedBookId || linking) return;

    setLinking(true);
    setLinkError(undefined);

    try {
      const { data } = await runLink({
        variables: { id: selectedBookId, documentId },
        update: (cache, { data: mutationData }) => {
          const result = unwrapResult<BookLinkDocumentPayload>(
            mutationData?.bookLinkDocument,
            'BookLinkDocumentPayload'
          );
          if (result.status !== 'ok') return;

          cache.evict({
            id: cache.identify({ __typename: 'Progress', id: progressId }),
          });
          cache.evict({
            id: cache.identify({ __typename: 'Library', id: libraryId }),
            fieldName: 'progress',
          });
          cache.gc();
        },
      });

      const result = unwrapResult<BookLinkDocumentPayload>(
        data?.bookLinkDocument,
        'BookLinkDocumentPayload'
      );
      if (result.status === 'missing') {
        setLinkError('Failed to link progress');
        return;
      }
      if (result.status === 'error') {
        setLinkError(result.message);
        return;
      }

      onClose();
    } catch (err) {
      setLinkError(err instanceof Error ? err.message : 'Failed to link progress');
    } finally {
      setLinking(false);
    }
  }, [selectedBookId, linking, runLink, documentId, progressId, libraryId, onClose]);

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
            ) : error !== undefined && books.length === 0 ? (
              <li className={styles.emptyMessage}>{error || 'Failed to load books.'}</li>
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
          {error !== undefined && books.length > 0 && <div className={styles.error}>{error}</div>}
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
