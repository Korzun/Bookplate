import { useCallback, use, useMemo, useState } from 'react';

import { useWithTargetUser } from '~/provider/library-target';

import { apiFetch } from '../../../lib/api-fetch';
import { Context } from '../context';
import { BookList, DisplayUnit } from '../type';

/**
 * Deletes every `bookList` entry describing this book (`.id === rawId`), not
 * just `prev[rawId]` itself — same alias sweep as
 * `use-regen-chapters.ts`/`use-patch-book-metadata.ts` (see either's doc
 * comment for the full mechanism). `useFetchBook` keys entries by the id
 * they were REQUESTED under, not the book's own raw id, so a book reached
 * via a Relay global id (the grid, `/book/<globalId>`) and also via its raw
 * id (the search dropdown, `/book/<rawId>`) can sit under TWO keys at once.
 * Deleting only the key the caller happened to pass left the other alias's
 * `bookList` entry — and its `completeBookIds` membership — untouched
 * forever: `useBook`'s effect only refetches when `bookList[bookId] ===
 * undefined`, so the alias kept rendering the deleted book in full detail
 * until a hard reload.
 */
const removeBookByAlias = (rawId: string, prev: BookList): BookList => {
  const next = { ...prev };
  for (const key of Object.keys(next)) {
    if (next[key]?.id === rawId) delete next[key];
  }
  return next;
};

const isStandalone = (item: DisplayUnit, bookId: string) =>
  item.type === 'standalone' && item.bookId === bookId;

const isSeries = (item: DisplayUnit, seriesName: string) =>
  item.type === 'series' && item.seriesName === seriesName;

export type UseDeleteBook = [(id: string) => Promise<void>, boolean, boolean, string | undefined];
export const useDeleteBook = (): UseDeleteBook => {
  const { bookList, bookListItems, setBookList, setBookListItems, clearCompleteBookIds } =
    use(Context);
  const withTargetUser = useWithTargetUser();
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState(false);
  const [errorMessage, setErrorMessage] = useState<string | undefined>();

  const deleteBook = useCallback(
    async (id: string) => {
      // Prevent multiple parallel requests
      if (loading) {
        return;
      }

      const book = bookList[id];
      if (book === undefined) {
        setError(true);
        setErrorMessage('Failed to delete book');
        return;
      }

      // The book's list item disappears too when it is a standalone entry, or the
      // last remaining book of its series (the server deletes the emptied series).
      const isLastInSeries =
        book.series.length > 0 &&
        !Object.values(bookList).some(
          (other) => other.id !== book.id && other.series === book.series
        );
      const isRemovedItem = (item: DisplayUnit) =>
        isStandalone(item, id) || (isLastInSeries && isSeries(item, book.series));

      const itemIndex = bookListItems.findIndex(isRemovedItem);
      const removedItem = itemIndex === -1 ? undefined : bookListItems[itemIndex];

      setBookList((prev) => removeBookByAlias(book.id, prev));
      if (removedItem) {
        setBookListItems((prev) => prev.filter((item) => !isRemovedItem(item)));
      }

      try {
        setLoading(true);
        setError(false);
        setErrorMessage(undefined);
        const res = await apiFetch(withTargetUser(`/api/books/${encodeURIComponent(id)}`), {
          method: 'DELETE',
        });
        if (res.status !== 204) throw new Error('Failed to delete book');
      } catch (err) {
        setError(true);
        // Restores under the key `id` — the key the optimistic removal was
        // requested against — not `book.id`. Before this fix those two
        // could differ (a global-id request whose resolved book's own `.id`
        // is the raw id): restoring under `book.id` left the `id` key
        // permanently deleted even though the DELETE failed, while writing
        // a possibly-new `book.id` entry that hadn't been touched — a
        // silent duplicate once `use-book-list.ts`'s `Object.values(bookList)`
        // fans it back out.
        setBookList((prev) => ({ ...prev, [id]: book }));
        if (removedItem) {
          setBookListItems((prev) => {
            if (prev.some(isRemovedItem)) return prev;
            const restored = [...prev];
            restored.splice(itemIndex, 0, removedItem);
            return restored;
          });
        }
        clearCompleteBookIds();
        if (err instanceof Error) setErrorMessage(err.message);
      } finally {
        setLoading(false);
      }
    },
    [
      withTargetUser,
      bookList,
      bookListItems,
      clearCompleteBookIds,
      loading,
      setBookList,
      setBookListItems,
    ]
  );

  return useMemo(
    () => [deleteBook, loading, error, errorMessage],
    [deleteBook, loading, error, errorMessage]
  );
};
