import { useMutation } from '@apollo/client/react';
import { useCallback, useMemo, useState } from 'react';

import type { BookClearEditionsMutation } from '~/gql/graphql';
import { BookClearEditionsDocument } from '~/graphql/book';
import { unwrapResult } from '~/provider/apollo';

// `unwrapResult`'s `TPayload` sits in a position TypeScript cannot infer from
// the call, so it is named explicitly here, extracted from the generated
// union rather than hand-duplicated.
type BookClearEditionsPayload = Extract<
  NonNullable<BookClearEditionsMutation['bookClearEditions']>,
  { __typename: 'BookClearEditionsPayload' }
>;

export type UseClearBookEditions = [
  (id: string) => Promise<number | undefined>,
  boolean,
  boolean,
  string | undefined,
];

/**
 * `BookClearEditionsResult` is a single-member union today (schema-verified
 * against `app/server/graphql/schema/book/mutation/clear-editions.ts`) — no
 * error branch. No hand-written `update` function: the payload re-selects
 * `book { id deviceEditionCount }`, and Apollo's own normalization writes
 * the new count onto the existing `Book` entity — proved directly against
 * the cache in this hook's own test ("zeroes deviceEditionCount in the
 * cache with no hand-written update"), per Global Constraints' instruction
 * not to reconstruct what normalization already does.
 */
export const useClearBookEditions = (): UseClearBookEditions => {
  const [runClearEditions] = useMutation(BookClearEditionsDocument);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState(false);
  const [errorMessage, setErrorMessage] = useState<string | undefined>();

  const clearBookEditions = useCallback(
    async (id: string): Promise<number | undefined> => {
      if (loading) return undefined;

      try {
        setLoading(true);
        setError(false);
        setErrorMessage(undefined);

        const { data } = await runClearEditions({ variables: { id } });
        const result = unwrapResult<BookClearEditionsPayload>(
          data?.bookClearEditions,
          'BookClearEditionsPayload'
        );
        if (result.status === 'missing') {
          setError(true);
          setErrorMessage('Failed to clear device editions');
          return undefined;
        }
        if (result.status === 'error') {
          setError(true);
          setErrorMessage(result.message);
          return undefined;
        }

        return result.payload.clearedCount;
      } catch (err) {
        setError(true);
        if (err instanceof Error) setErrorMessage(err.message);
        return undefined;
      } finally {
        setLoading(false);
      }
    },
    [runClearEditions, loading]
  );

  return useMemo(
    () => [clearBookEditions, loading, error, errorMessage] as UseClearBookEditions,
    [clearBookEditions, loading, error, errorMessage]
  );
};
