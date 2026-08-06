import { useCallback, use } from 'react';

import { useWithTargetUser } from '~/provider/library-target';

import { apiFetch } from '../../../lib/api-fetch';
import { Context } from '../context';
import type { Book } from '../type';

export type FetchBook = (bookId: string) => Promise<void>;

/**
 * Stores the fetched book under the id it was ASKED for (`bookId`), not
 * under the response body's own `book.id`. Those two now legitimately
 * differ: the legacy `/api/books/:id` route (task 13) accepts either a raw,
 * content-hash local id or a Relay global id, and always resolves to (and
 * responds with) the raw local id either way. `useBook`'s
 * `bookList[bookId]` lookup, and every sibling per-book map on this same
 * context (`loadingByBookId`/`errorByBookId`/`completeBookIds`), are all
 * keyed by that same requested `bookId` — keying this one entry by
 * `book.id` instead broke that agreement the moment a caller could pass a
 * global id (the grid's `BookRowFromEntry`, task 8): `bookList[bookId]`
 * then never resolved, so `useBook`'s own effect kept re-firing (its
 * `bookList[bookId] === undefined` guard never cleared) and the book page
 * never left its loading state. Every pre-existing caller passes a raw id
 * that already equals `book.id`, so this change is a no-op for them —
 * see `use-fetch-book.test.tsx`'s seen-to-fail for the case it actually
 * fixes.
 */
export const useFetchBook = (): FetchBook => {
  const { loadingByBookId, setBookList, setLoadingForBook, setErrorForBook, setBookComplete } =
    use(Context);
  const withTargetUser = useWithTargetUser();

  return useCallback(
    async (bookId: string) => {
      if (loadingByBookId[bookId]) return;

      setLoadingForBook(bookId, true);
      setErrorForBook(bookId, undefined);
      try {
        const response = await apiFetch(withTargetUser(`/api/books/${encodeURIComponent(bookId)}`));
        if (!response.ok) throw new Error('Book not found');
        const book = await (response.json() as Promise<Book>);
        setBookList((prev) => ({ ...prev, [bookId]: book }));
        setBookComplete(bookId);
      } catch (err) {
        setErrorForBook(bookId, err instanceof Error ? err.message : 'Unknown error');
      } finally {
        setLoadingForBook(bookId, false);
      }
    },
    [
      withTargetUser,
      loadingByBookId,
      setBookList,
      setLoadingForBook,
      setErrorForBook,
      setBookComplete,
    ]
  );
};
