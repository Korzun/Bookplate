import { useMutation } from '@apollo/client/react';
import { useCallback, useMemo, useState } from 'react';

import type { BookRegenChaptersMutation } from '~/gql/graphql';
import { BookRegenChaptersDocument } from '~/graphql/book';
import { unwrapResult } from '~/provider/apollo';

// `unwrapResult`'s `TPayload` sits in a position TypeScript cannot infer from
// the call, so it is named explicitly here, extracted from the generated
// union rather than hand-duplicated.
type BookRegenChaptersPayload = Extract<
  NonNullable<BookRegenChaptersMutation['bookRegenChapters']>,
  { __typename: 'BookRegenChaptersPayload' }
>;

export type UseRegenChapters = [
  (id: string) => Promise<void>,
  boolean,
  boolean,
  string | undefined,
];

/**
 * The REST-era `renameProgressKey` call is GONE along with the REST progress
 * map it renamed keys in — `ProgressContext` is not touched by this hook at
 * all anymore. Progress lives in its own not-yet-migrated REST hooks
 * (untouched per Global Constraints); nothing here bridges to them.
 *
 * `BookRegenChaptersResult` genuinely has two error members
 * (schema-verified against `app/server/graphql/schema/book/mutation/
 * regen-chapters.ts`): `BookHashCollisionError` and `BookNotValidatedError`.
 * `unwrapResult` treats either as `status: 'error'` uniformly — both types
 * expose only `message` — so both map onto `errorMessage` the same way,
 * with no per-typename branching needed.
 *
 * `update` evicts the STALE `Book:<id>` entity ONLY when the payload's
 * `book.id` differs from the requested `id` — `reimportBook` re-parses the
 * EPUB and recomputes its content-hash fingerprint, which is also the raw
 * local half of the Book's global id, so a regen can genuinely mint a new
 * id. When it does, Apollo's normalization on the payload's `book { id
 * chapterCount chapterNames chapterSpineMap }` selection writes a BRAND NEW
 * `Book:<new-id>` entity — it has no way to know the old entity described
 * the SAME book and needs removing, so the pre-regen `Book:<old-id>` would
 * otherwise linger in the cache forever with stale chapter data. When the
 * id is UNCHANGED, normalization alone updates the existing entity's three
 * re-selected fields and this `update` function does nothing extra.
 *
 * **Seen-to-fail**: deleting the `id !== requestedId` evict branch below
 * leaves this hook's "evicts the old Book entity when the payload reports a
 * different id" test failing — `Book:<old-id>` survives in
 * `cache.extract()` instead of disappearing. Restored; see this file's git
 * history / the task report for the exact failure output.
 */
export const useRegenChapters = (): UseRegenChapters => {
  const [runRegen] = useMutation(BookRegenChaptersDocument);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState(false);
  const [errorMessage, setErrorMessage] = useState<string | undefined>();

  const regenChapters = useCallback(
    async (id: string) => {
      if (loading) return;

      try {
        setLoading(true);
        setError(false);
        setErrorMessage(undefined);

        const { data } = await runRegen({
          variables: { id },
          update: (cache, { data: mutationData }) => {
            const result = unwrapResult<BookRegenChaptersPayload>(
              mutationData?.bookRegenChapters,
              'BookRegenChaptersPayload'
            );
            if (result.status !== 'ok') return;
            if (result.payload.book.id === id) return;

            cache.evict({ id: cache.identify({ __typename: 'Book', id }) });
            cache.gc();
          },
        });

        const result = unwrapResult<BookRegenChaptersPayload>(
          data?.bookRegenChapters,
          'BookRegenChaptersPayload'
        );
        if (result.status === 'missing') {
          setError(true);
          setErrorMessage('Failed to regenerate chapters');
          return;
        }
        if (result.status === 'error') {
          setError(true);
          setErrorMessage(result.message);
          return;
        }
      } catch (err) {
        setError(true);
        if (err instanceof Error) setErrorMessage(err.message);
      } finally {
        setLoading(false);
      }
    },
    [runRegen, loading]
  );

  return useMemo(
    () => [regenChapters, loading, error, errorMessage] as UseRegenChapters,
    [regenChapters, loading, error, errorMessage]
  );
};
