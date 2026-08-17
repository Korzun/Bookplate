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

/**
 * The resolved id shape every caller of `patchBookMetadata` gets back.
 * `id` is the RAW content hash — unchanged behavior, every existing caller
 * (`use-upload-queue.ts`, twice) already depends on this being raw, since
 * they thread it into more REST calls (`/lineage`, re-keying the upload
 * queue's own `bookId`) that only ever accept raw ids.
 *
 * `globalId` (2026-08-13 final review, C-2 — human ruling, Option 1): editing
 * metadata changes the book's content hash, so `id` here is a NEW id the
 * client had no global counterpart for — `page/book` (GraphQL) needs one to
 * navigate back. The server computes it with the same `encodeGlobalID`
 * formula `book/mutation/delete.ts`'s `deletedId` already uses
 * (`routes/ui.ts`'s `bookGlobalId` helper).
 */
export type PatchBookMetadataResult = { id: string; globalId: string };

export type UsePatchBookMetadata = [
  (bookId: string, patch: BookMetadataPatch) => Promise<PatchBookMetadataResult | undefined>,
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
    async (
      bookId: string,
      patch: BookMetadataPatch
    ): Promise<PatchBookMetadataResult | undefined> => {
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
        const updatedBook = await (response.json() as Promise<Book & { globalId: string }>);
        // Delete every `bookList` entry describing the PRE-edit book
        // (`.id === bookId`), not just `next[bookId]` itself — same fix as
        // `use-regen-chapters.ts` (see that file's doc comment for the full
        // mechanism). `useFetchBook` keys entries by the id they were
        // REQUESTED under, not the book's own raw id, so a book reached via
        // a Relay global id (the grid) can be cached under a key that isn't
        // `bookId` here.
        //
        // This match ONLY works when `bookId` is the raw id — `.id` fields
        // on stored books are always raw, so a `bookId` that were itself a
        // global id would match zero entries here, silently skipping the
        // sweep entirely rather than just missing an alias. Final-branch-
        // review I-3: an earlier version of this comment asserted "`bookId`
        // is always the resolved raw id" as an already-true fact, but
        // `page/book-edit` was at the time calling `patchBookMetadata(id)`
        // with the RAW URL PARAM, not `useBook`'s resolved `original.id` —
        // the two differ for a book reached via a global-id URL, which no
        // in-app link produces today but a future grid→edit link would.
        // `page/book-edit` now passes `original.id` (its own fix, same
        // review), which is what makes the claim actually true.
        // `next[bookId]` alone leaves that alias holding the pre-edit book
        // forever: `completeBookIds` still marks it complete, so `useBook`
        // never refetches it, and browsing back to the book via its
        // original (global-id) URL silently shows stale, pre-edit data with
        // no loading state or error.
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
        return { id: updatedBook.id, globalId: updatedBook.globalId };
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
