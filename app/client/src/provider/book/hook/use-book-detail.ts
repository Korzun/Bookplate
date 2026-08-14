import { useQuery } from '@apollo/client/react';
import { useMemo } from 'react';

import type { FragmentType } from '~/gql';
import { BookDetailDocument, LineageEntryFragment } from '~/graphql/book';
import { useCurrentLibraryId } from '~/provider/library-target';

/**
 * `BookDetail`'s `book` shape, as read off the generated query — `series`,
 * `progress`, and `validation { id valid }` are plain sibling selections
 * (not through a fragment), so they stay fully typed here. `lineage` DOES
 * come through `LineageEntryFragment` and stays MASKED — see this hook's
 * own doc comment below for why it is handed back as-is rather than
 * unmasked centrally.
 */
export type BookDetail = {
  id: string;
  title: string;
  author: string;
  description: string;
  publisher: string;
  publishDate: string;
  addedAt: string;
  mtime: string;
  size: number;
  pageCount: number;
  chapterCount: number;
  chapterNames: string[] | null;
  chapterSpineMap: number[];
  subjects: string[];
  seriesIndex: number;
  hasCover: boolean;
  coverUrl: string;
  deviceEditionCount: number;
  series: { id: string; name: string } | null;
  progress: { id: string; percentage: number; currentChapter: number | null } | null;
  /**
   * Verified against the resolver (`app/server/graphql/schema/book/
   * model.ts`'s `validation: t.relation('validation', { nullable: true })`)
   * and confirmed by `book-not-validated-error/model.ts`'s own doc comment:
   * a book that has never been validated has NO `Validation` row at all —
   * rows are written only by an actual validate action
   * (`ValidationStore.saveValidation`, called from the upload/revalidate/
   * apply-edit flows), never as a side effect of adding/importing a book.
   * So `validation` resolves `null` here, never a row with `valid: false`,
   * for "never validated" — matching REST's tri-state `valid?: boolean |
   * null`, where `undefined` (never validated) and `false` (failed) were
   * already distinct. `editingBlocked` (Task 9) can therefore keep the REST
   * mapping verbatim: `validation?.valid !== true` blocks editing in both
   * the "never validated" and "failed" cases, exactly as `book.valid !==
   * true` did.
   */
  validation: { id: string; valid: boolean } | null;
  lineage: FragmentType<typeof LineageEntryFragment>[];
  pendingFix: { id: string } | null;
};

export type UseBookDetail = {
  book: BookDetail | undefined;
  loading: boolean;
  /** Apollo's `error?.message` — see this file's doc comment for what it covers. */
  error: string | undefined;
  /**
   * Forwarded straight from `useQuery`. Not decoration: a later task uses
   * this to bridge a REST progress write back onto this GraphQL read (the
   * progress mutation hasn't migrated yet, so the page needs a way to
   * re-pull `book.progress` after that REST call succeeds).
   */
  refetch: () => void;
};

/**
 * The book-detail page's read: `node(id: $libraryId) { ... on Library {
 * book(id:) } }` — rooted the same way `useSeriesDetail` roots
 * `seriesByName` and `useLibraryEntries` roots `entries`, for the same
 * reason (`node(id:)` is the only single root that serves both a
 * non-admin's own library and an admin's selected one; see
 * `useCurrentLibraryId`'s doc comment).
 *
 * This is a NEW, differently-named hook, not a reshape of `useBook` (the
 * REST hook). `useBook` has four non-test consumers; three of them
 * (`page/book-edit`, `my-progress-row`, `user-progress-row`) belong to
 * later migration steps, so `useBook` is preserved untouched here — folding
 * this hook's shape into it would drag those three later screens into this
 * one before they're ready to move.
 *
 * Skips the query outright when `libraryId` is `undefined`, exactly as
 * `useSeriesDetail`/`useLibraryEntries` do. `loading` folds in
 * `useCurrentLibraryId`'s own bootstrap round trip for the same cold-load
 * reason documented on those hooks: a skipped `useQuery` reports `loading:
 * false` on its own, which would flash a false "book not found" for the
 * whole `ViewerBootstrap` window without this fold-in.
 *
 * **A book id the library does not have** resolves `book` to `null` — the
 * server's own "not found" answer, not a failure. That surfaces here as
 * `book: undefined` with `error: undefined`, deliberately indistinguishable
 * from "haven't loaded yet" at the type level; a consumer tells the two
 * apart via `loading`, the same way `useSeriesDetail` does.
 *
 * **Error-surfacing policy** (same decision `useSeriesDetail`/
 * `useLibraryEntries` made, followed here rather than re-litigated): `error`
 * is Apollo's own `error?.message`, nothing more.
 *
 * **`validation` is intentionally NOT the full payload.** This document
 * selects only `validation { id valid }` — see `graphql/book.ts`'s doc
 * comment on `BookDetailDocument` for the 2026-08-13 human ruling that split
 * the expensive part (`threshold`/`validatedAt`/`counts`/`messages`) into
 * `BookValidationDocument`, fired lazily by `useBookValidation` (this
 * directory's sibling hook) only when the validation modal opens. The two
 * fields kept here are load-bearing on their own: `editingBlocked` gates the
 * "Edit metadata" action on `validation?.valid !== true`, evaluated on page
 * LOAD, so it cannot wait for the lazy query.
 *
 * **`lineage` stays MASKED.** It carries a `FragmentType` ref for
 * `LineageEntryFragment`, not the unwrapped `oldId`/`newId`/`timestamp`/
 * `type` fields. This hook returns it AS IS, the same reason
 * `useSeriesDetail` hands back masked `books` refs: the lineage list is a
 * shared array a modal component unmasks with its own single, unconditional
 * `useFragment` call, rather than this hook calling `useFragment` in a loop
 * over a shared array — exactly what `react-hooks/rules-of-hooks` forbids.
 */
export const useBookDetail = (bookId: string): UseBookDetail => {
  const { libraryId, loading: libraryIdLoading } = useCurrentLibraryId();
  const { data, loading, error, refetch } = useQuery(BookDetailDocument, {
    variables: { libraryId: libraryId ?? '', bookId },
    skip: libraryId === undefined,
  });

  const node = data?.node;
  const book = node?.__typename === 'Library' ? (node.book ?? undefined) : undefined;

  return useMemo(
    () => ({
      book,
      loading: loading || libraryIdLoading,
      error: error?.message,
      refetch: () => void refetch(),
    }),
    [book, loading, libraryIdLoading, error, refetch]
  );
};
