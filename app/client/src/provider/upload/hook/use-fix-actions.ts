import { useMutation } from '@apollo/client/react';
import { useCallback, useMemo, useState } from 'react';

import type { BookResolvePendingFixMutation, PendingFixResolution } from '~/gql/graphql';
import { BookResolvePendingFixDocument } from '~/graphql/upload';
import { unwrapResult } from '~/provider/apollo';

// `unwrapResult`'s `TPayload` sits in a position TypeScript cannot infer from
// the call, so it is named explicitly here, extracted from the generated
// union rather than hand-duplicated — same shape as
// `control/unlink-book-lineage-button/index.tsx`.
type BookResolvePendingFixPayload = Extract<
  NonNullable<BookResolvePendingFixMutation['bookResolvePendingFix']>,
  { __typename: 'BookResolvePendingFixPayload' }
>;

export type FixKey = { field: string; kind: string; from: string };

export type UseFixActions = {
  acceptFixes: (bookGlobalId: string, fixes?: FixKey[]) => Promise<boolean>;
  dismissFixes: (bookGlobalId: string, fixes?: FixKey[]) => Promise<boolean>;
  undoFixes: (bookGlobalId: string) => Promise<boolean>;
  clearFixes: (bookGlobalId: string) => Promise<boolean>;
  error: string | undefined;
};

/**
 * The write half of the pending-fix queue: all four resolutions
 * (`ACCEPT`/`DISMISS`/`UNDO`/`CLEAR`) through the single
 * `BookResolvePendingFixDocument` mutation, matching the server's own
 * `PendingFixResolution` enum one-to-one.
 *
 * **No manual cache writes.** The mutation selects `library { id
 * pendingFixes { ... } }`, so Apollo reconciles `usePendingFixes`'s row list
 * from the payload by itself, purely through normalization — a later task
 * (the library grid's `entries` connection) adds the one eviction the
 * payload genuinely cannot express, but that is out of scope here.
 *
 * **`fixes` is OMITTED from the variables, not passed as `undefined`, for
 * every bulk action** (`acceptFixes`/`dismissFixes` called with no `fixes`
 * argument, and always for `undoFixes`/`clearFixes`, which never take one).
 * "Absent" is what `BookResolvePendingFixInput.fixes` being optional means
 * server-side: every proposal, so omitting the key is the honest expression
 * of that intent. This is a CLARITY choice, not a behavioural one: a
 * `variables: { id, action, fixes: undefined }` object is wire-identical to
 * omitting the key (`JSON.stringify` drops `undefined`-valued properties the
 * same way either form would be sent), and no test — this hook's own or
 * otherwise — can distinguish the two, so nothing here is actually guarding
 * against the `fixes: undefined` form regressing back in.
 *
 * Each action resolves `true` on success and `false` on any typed error
 * (the mutation's own `BookHashCollisionError`/`BookNotValidatedError`/
 * `EpubValidationError` members) or network failure — the same boolean
 * contract `page/upload`'s REST-era `applyFix`/`undo` already expects,
 * which is what lets Task 9 swap this in without reshaping that call site.
 */
export const useFixActions = (): UseFixActions => {
  const [resolve] = useMutation(BookResolvePendingFixDocument);
  const [error, setError] = useState<string | undefined>(undefined);

  const run = useCallback(
    async (id: string, action: PendingFixResolution, fixes?: FixKey[]): Promise<boolean> => {
      setError(undefined);
      try {
        const { data } = await resolve({
          // `fixes` is OMITTED, not passed as undefined, for bulk actions —
          // see this hook's own doc comment.
          variables: fixes === undefined ? { id, action } : { id, action, fixes },
        });
        const result = unwrapResult<BookResolvePendingFixPayload>(
          data?.bookResolvePendingFix,
          'BookResolvePendingFixPayload'
        );
        if (result.status === 'ok') return true;
        setError(result.status === 'error' ? result.message : 'Failed to update fixes');
        return false;
      } catch (err) {
        setError(err instanceof Error ? err.message : 'Failed to update fixes');
        return false;
      }
    },
    [resolve]
  );

  const acceptFixes = useCallback(
    (bookGlobalId: string, fixes?: FixKey[]) => run(bookGlobalId, 'ACCEPT', fixes),
    [run]
  );
  const dismissFixes = useCallback(
    (bookGlobalId: string, fixes?: FixKey[]) => run(bookGlobalId, 'DISMISS', fixes),
    [run]
  );
  const undoFixes = useCallback((bookGlobalId: string) => run(bookGlobalId, 'UNDO'), [run]);
  const clearFixes = useCallback((bookGlobalId: string) => run(bookGlobalId, 'CLEAR'), [run]);

  return useMemo(
    () => ({ acceptFixes, dismissFixes, undoFixes, clearFixes, error }),
    [acceptFixes, dismissFixes, undoFixes, clearFixes, error]
  );
};
