import { useCallback, useContext, useMemo, useState } from 'react';

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
  const { setBookList, setBookListFetched, setBookListItems, setNextCursor } = useContext(Context);
  const { renameProgressKey } = useContext(ProgressContext);
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
        setBookList((prev) => {
          const next = { ...prev, [updatedBook.id]: updatedBook };
          if (updatedBook.id !== bookId) delete next[bookId];
          return next;
        });
        if (updatedBook.id !== bookId) renameProgressKey(bookId, updatedBook.id);
        setBookListFetched(false);
        setBookListItems(() => []);
        setNextCursor(null);
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
    [
      withTargetUser,
      loading,
      setBookList,
      setBookListFetched,
      setBookListItems,
      setNextCursor,
      renameProgressKey,
    ]
  );

  return useMemo(
    () => [patchBookMetadata, loading, error, errorMessage],
    [patchBookMetadata, loading, error, errorMessage]
  );
};
