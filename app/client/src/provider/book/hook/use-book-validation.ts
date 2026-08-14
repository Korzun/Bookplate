import { useLazyQuery } from '@apollo/client/react';
import { useMemo } from 'react';

import type { FragmentType } from '~/gql';
import { BookValidationDocument, ValidationFragment } from '~/graphql/book';
import { useCurrentLibraryId } from '~/provider/library-target';

export type UseBookValidation = {
  validation: FragmentType<typeof ValidationFragment> | undefined;
  loading: boolean;
  /** Apollo's `error?.message` — same policy `useBookDetail` follows. */
  error: string | undefined;
  /** Fires `BookValidationDocument`. A no-op call site (e.g. before the
   * library id resolves) is the caller's problem, not this hook's — see
   * the doc comment below for why that is an acceptable gap. */
  load: () => void;
};

/**
 * The lazy half of the 2026-08-13 validation split (see `graphql/book.ts`'s
 * doc comment on `BookDetailDocument`/`BookValidationDocument`): the
 * validation modal's payload — `threshold`, `validatedAt`, `counts`,
 * `messages` — is expensive enough on its own that folding it into
 * `BookDetail` pushed that document's breadth from 49% to 69% of the
 * query-cost budget, one point under the 70% gate. `useBookDetail` already
 * carries the cheap `validation { id valid }` needed for `editingBlocked`
 * at page load; this hook exists ONLY to fetch the rest, and only when the
 * validation modal actually opens.
 *
 * `useLazyQuery`, not `useQuery`: unlike every other read hook in this
 * migration, this one must issue NO operation on mount — that is the whole
 * point of the split, and the reason this hook has its own test proving it
 * (`use-book-validation.test.tsx`). `load()` is the only way to fire it,
 * wired to the modal's open handler in Task 11.
 *
 * `validation` stays MASKED (a `FragmentType` ref for `ValidationFragment`),
 * the same stance `useBookDetail` takes on `lineage` and `useSeriesDetail`
 * takes on `books`: the modal unmasks it itself with one unconditional
 * `useFragment` call, rather than this hook calling `useFragment` from a
 * shared, non-component context.
 *
 * `Validation.id` is byte-identical to the owning Book's global id
 * (`graphql/book.ts`'s doc comment spells out why), so this document's
 * result normalizes onto the SAME `Book` cache entity `useBookDetail`
 * already populated — the eager `{ id valid }` and this lazy payload merge
 * onto one object rather than compete, and a later `bookValidate` mutation
 * response will land here for free too.
 *
 * `libraryId` is read the same way `useBookDetail` reads it, but this hook
 * does NOT skip/gate on it being resolved — `load()` is only ever wired to
 * a user action (opening the modal) that cannot happen before the page
 * carrying `useBookDetail` has already rendered a book, by which point
 * `libraryId` is guaranteed resolved. A `''` fallback exists only to keep
 * the query's variables well-typed before `load()` is ever called.
 *
 * `load()` passes `variables` explicitly on every call, rather than relying
 * on the hook-level `variables` given to `useLazyQuery` above — this is NOT
 * redundant. Apollo's own `useLazyQuery` execute function resets to EMPTY
 * variables when called with no arguments (see its source: "If `variables`
 * is not given, reset back to empty variables"); the hook-level `variables`
 * option only sets the query's INITIAL default, read the first time
 * `execute()` runs with none supplied by the caller. Omitting them here
 * would have sent `BookValidation` with `{}` instead of the real
 * `{ libraryId, bookId }`, and every mocked/real request would fail to
 * match.
 */
export const useBookValidation = (bookId: string): UseBookValidation => {
  const { libraryId } = useCurrentLibraryId();
  const [execute, { data, loading, error }] = useLazyQuery(BookValidationDocument);

  const node = data?.node;
  const validation =
    node?.__typename === 'Library' ? (node.book?.validation ?? undefined) : undefined;

  return useMemo(
    () => ({
      validation,
      loading,
      error: error?.message,
      load: () => void execute({ variables: { libraryId: libraryId ?? '', bookId } }),
    }),
    [validation, loading, error, execute, libraryId, bookId]
  );
};
