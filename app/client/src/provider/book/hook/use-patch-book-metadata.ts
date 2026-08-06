import { useCallback, use, useMemo, useState } from 'react';

import { useWithTargetUser } from '~/provider/library-target';

import { apiFetch } from '../../../lib/api-fetch';
import { Context as ProgressContext } from '../../progress/context';
import { Context } from '../context';
import { Book } from '../type';

export type BookMetadataPatch = Partial<{
  author: string;
  cover: File;
  description: string;
  titleSort: string;
  authorSort: string;
  publishDate: string;
  identifiers: { scheme: string; value: string }[];
  publisher: string;
  series: string;
  seriesIndex: number;
  subjects: string[];
  title: string;
}>;

export type UsePatchBookMetadata = [
  (bookId: string, patch: BookMetadataPatch) => Promise<string | undefined>,
  boolean,
  boolean,
  string | undefined,
];
export const usePatchBookMetadata = (): UsePatchBookMetadata => {
  const { setBookList, setBookListFetched, setBookListItems } = use(Context);
  const { renameProgressKey } = use(ProgressContext);
  const withTargetUser = useWithTargetUser();
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState(false);
  const [errorMessage, setErrorMessage] = useState<string | undefined>();

  const patchBookMetadata = useCallback(
    async (bookId: string, patch: BookMetadataPatch): Promise<string | undefined> => {
      // Prevent multiple parallel requests
      if (loading) {
        return;
      }

      setLoading(true);
      setError(false);
      setErrorMessage(undefined);

      try {
        const fd = new FormData();
        const { cover, identifiers, subjects, seriesIndex, ...scalars } = patch;
        for (const [key, value] of Object.entries(scalars)) {
          if (value !== undefined) fd.append(key, value as string);
        }
        if (seriesIndex !== undefined) fd.append('seriesIndex', String(seriesIndex));
        if (subjects !== undefined) fd.append('subjects', JSON.stringify(subjects));
        if (identifiers !== undefined) fd.append('identifiers', JSON.stringify(identifiers));
        if (cover !== undefined) fd.append('cover', cover);

        const response = await apiFetch(
          withTargetUser(`/api/books/${encodeURIComponent(bookId)}/metadata`),
          {
            method: 'PATCH',
            body: fd,
          }
        );
        if (!response.ok) {
          const body = (await response.json().catch(() => ({}))) as { error?: string };
          throw new Error(body.error ?? 'Save failed');
        }
        const updatedBook = await (response.json() as Promise<Book>);
        // Delete every `bookList` entry describing the PRE-edit book
        // (`.id === bookId`), not just `next[bookId]` itself — same fix as
        // `use-regen-chapters.ts` (see that file's doc comment for the full
        // mechanism). `useFetchBook` keys entries by the id they were
        // REQUESTED under, not the book's own raw id, so a book reached via
        // a Relay global id (the grid) can be cached under a key that isn't
        // `bookId` here (`bookId` is always the resolved raw id —
        // `page/book-edit` calls `patchBookMetadata(id)` with the id its own
        // `useBook` already resolved). `next[bookId]` alone leaves that
        // alias holding the pre-edit book forever: `completeBookIds` still
        // marks it complete, so `useBook` never refetches it, and browsing
        // back to the book via its original (global-id) URL silently shows
        // stale, pre-edit data with no loading state or error.
        setBookList((prev) => {
          const next = { ...prev };
          for (const key of Object.keys(next)) {
            if (next[key]?.id === bookId) delete next[key];
          }
          next[updatedBook.id] = updatedBook;
          return next;
        });
        if (updatedBook.id !== bookId) renameProgressKey(bookId, updatedBook.id);
        setBookListFetched(false);
        setBookListItems(() => []);
        return updatedBook.id;
      } catch (err) {
        setError(true);
        if (err instanceof Error) {
          setErrorMessage(err.message);
        }
      } finally {
        setLoading(false);
      }
    },
    [withTargetUser, loading, setBookList, setBookListFetched, setBookListItems, renameProgressKey]
  );

  return useMemo(
    () => [patchBookMetadata, loading, error, errorMessage],
    [patchBookMetadata, loading, error, errorMessage]
  );
};
