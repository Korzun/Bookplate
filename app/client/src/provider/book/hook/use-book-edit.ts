import { useQuery } from '@apollo/client/react';
import { useMemo } from 'react';

import { BookEditDocument } from '~/graphql/book-edit';
import { useCurrentLibraryId } from '~/provider/library-target';

/**
 * `BookEdit`'s `book` shape, as read off the generated query. Every field is
 * a plain sibling selection (no fragments), so it stays fully typed here —
 * see `graphql/book-edit.ts`'s doc comment for why this document is
 * SEPARATE from `BookDetailDocument` rather than an extension of it.
 */
export type BookEditBook = {
  id: string;
  documentId: string;
  title: string;
  titleSort: string;
  author: string;
  authorSort: string;
  description: string;
  publisher: string;
  publishDate: string;
  seriesIndex: number;
  subjects: string[];
  series: { id: string; name: string } | null;
  identifiers: { scheme: string; value: string }[];
  validation: { id: string; valid: boolean } | null;
};

export type UseBookEdit = {
  book: BookEditBook | undefined;
  loading: boolean;
  /** Apollo's `error?.message` — see this file's doc comment for what it covers. */
  error: string | undefined;
};

/**
 * The book-edit form's read: `node(id: $libraryId) { ... on Library {
 * book(id:) } }` — the same root `useBookDetail` uses, for the same reason
 * (`node(id:)` is the only single root that serves both a non-admin's own
 * library and an admin's selected one; see `useCurrentLibraryId`'s doc
 * comment).
 *
 * This is a NEW, differently-named hook, not a reshape of `useBook` (the
 * REST hook) — `useBook` has later-migration-step consumers still on REST,
 * so it stays untouched here, mirroring `useBookDetail`'s own note.
 *
 * Skips the query outright when `libraryId` is `undefined`, exactly as
 * `useBookDetail` does. `loading` folds in `useCurrentLibraryId`'s own
 * bootstrap round trip for the same cold-load reason: a skipped `useQuery`
 * reports `loading: false` on its own, which would flash a false "book not
 * found" for the whole `ViewerBootstrap` window without this fold-in.
 *
 * **A book id the library does not have** resolves `book` to `null` — the
 * server's own "not found" answer, not a failure. That surfaces here as
 * `book: undefined` with `error: undefined`, deliberately indistinguishable
 * from "haven't loaded yet" at the type level; a consumer tells the two
 * apart via `loading`, the same way `useBookDetail` does.
 *
 * **Error-surfacing policy** (same decision `useBookDetail` made, followed
 * here rather than re-litigated): `error` is Apollo's own `error?.message`,
 * nothing more.
 */
export const useBookEdit = (bookId: string): UseBookEdit => {
  const { libraryId, loading: libraryIdLoading } = useCurrentLibraryId();
  const { data, loading, error } = useQuery(BookEditDocument, {
    variables: { libraryId: libraryId ?? '', bookId },
    skip: libraryId === undefined,
  });

  const node = data?.node;
  const book = node?.__typename === 'Library' ? (node.book ?? undefined) : undefined;

  return useMemo(
    () => ({ book, loading: loading || libraryIdLoading, error: error?.message }),
    [book, loading, libraryIdLoading, error]
  );
};
