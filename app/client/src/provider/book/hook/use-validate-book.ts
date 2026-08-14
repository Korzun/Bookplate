import { useMutation } from '@apollo/client/react';
import { useCallback, useMemo, useState } from 'react';

import type { FragmentType } from '~/gql';
import type { BookValidateMutation } from '~/gql/graphql';
import { BookValidateDocument, ValidationFragment } from '~/graphql/book';
import { unwrapResult } from '~/provider/apollo';

// `unwrapResult`'s `TPayload` sits in a position TypeScript cannot infer from
// the call, so it is named explicitly here, extracted from the generated
// union rather than hand-duplicated.
type BookValidatePayload = Extract<
  NonNullable<BookValidateMutation['bookValidate']>,
  { __typename: 'BookValidatePayload' }
>;

export type ValidateBook = (
  id: string
) => Promise<FragmentType<typeof ValidationFragment> | undefined>;
export type UseValidateBook = [ValidateBook, boolean];

/**
 * RESHAPED, the one exception to "preserve the tuple" among this task's four
 * hooks (spec §4 / task-9 brief step 5). The REST version resolved a
 * `ValidationReport` — plain, unmasked fields. The GraphQL payload's
 * `validation` is a MASKED `FragmentType<typeof ValidationFragment>` ref;
 * returning it typed as `ValidationReport` would be a type lie (masking is
 * compile-time only here — the runtime object genuinely has those fields —
 * but the TYPE must not claim a shape the caller hasn't unmasked). Task 11
 * unmasks it for the modal.
 *
 * No hand-written `update` function. `bookValidate`'s payload selects
 * `validation { ...ValidationFragment }` as a TOP-LEVEL payload field, not
 * nested under `book` — it normalizes purely on `Validation`'s own cache key
 * (default `id` keying, no custom `typePolicy`). What makes that land on the
 * SAME entity `BookDetailDocument`/`BookValidationDocument` already read is
 * `Validation.id` being byte-identical to the owning Book's global id
 * server-side (`encodeGlobalID('Book', [userId, bookId])` — see
 * `graphql/book.ts`'s doc comment on `BookValidationDocument`): every query
 * that reads `Book.validation` for THIS book resolves to the exact same
 * `Validation:<id>` cache entity, so writing fresh fields onto it here is
 * immediately visible through `Book.validation` everywhere else, with zero
 * hand-written cache code. Asserted directly in this hook's own test
 * ("writes the fresh validation onto the book via normalization"), per
 * Global Constraints' instruction to prove normalization rather than merely
 * assert it in a comment.
 */
export const useValidateBook = (): UseValidateBook => {
  const [runValidate] = useMutation(BookValidateDocument);
  const [loading, setLoading] = useState(false);

  const validateBook = useCallback(
    async (id: string) => {
      if (loading) return undefined;

      try {
        setLoading(true);
        const { data } = await runValidate({ variables: { id } });
        const result = unwrapResult<BookValidatePayload>(data?.bookValidate, 'BookValidatePayload');
        if (result.status !== 'ok') return undefined;
        return result.payload.validation;
      } catch {
        return undefined;
      } finally {
        setLoading(false);
      }
    },
    [runValidate, loading]
  );

  return useMemo<UseValidateBook>(() => [validateBook, loading], [validateBook, loading]);
};
