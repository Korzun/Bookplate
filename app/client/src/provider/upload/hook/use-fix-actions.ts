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

/**
 * What every action resolves.
 *
 * `ok` is the old boolean return, unchanged in meaning: `true` on success,
 * `false` on any typed error or network failure.
 *
 * `bookGlobalId` is the book id the SERVER reports back in the payload, which
 * is NOT necessarily the one that was passed in: a successful `ACCEPT` (and
 * the `UNDO` of an apply-snapshot) re-imports the rewritten EPUB through
 * `applyEpubChanges`, minting a new content-hash id and re-keying the
 * `PendingFix` row under it. Callers that hold the pre-action id must follow
 * it — the upload queue joins its live transport rows on exactly this id, and
 * froze at the pre-accept value before whole-step review C-1. Present only
 * when `ok` is `true` (a typed error carries no payload to read it from).
 *
 * This is why the actions no longer resolve a bare `boolean`. The queue's own
 * public `UseUploadQueue` contract is still boolean — its mappers consume the
 * id here and hand `ok` on — so `page/upload` is unaffected.
 */
export type FixOutcome = { ok: boolean; bookGlobalId?: string };

export type UseFixActions = {
  acceptFixes: (bookGlobalId: string, fixes?: FixKey[]) => Promise<FixOutcome>;
  dismissFixes: (bookGlobalId: string, fixes?: FixKey[]) => Promise<FixOutcome>;
  undoFixes: (bookGlobalId: string) => Promise<FixOutcome>;
  clearFixes: (bookGlobalId: string) => Promise<FixOutcome>;
  error: string | undefined;
};

/**
 * The write half of the pending-fix queue: all four resolutions
 * (`ACCEPT`/`DISMISS`/`UNDO`/`CLEAR`) through the single
 * `BookResolvePendingFixDocument` mutation, matching the server's own
 * `PendingFixResolution` enum one-to-one.
 *
 * **Mostly no manual cache writes.** The mutation selects `library { id
 * pendingFixes { ... } }`, so Apollo reconciles `usePendingFixes`'s row list
 * from the payload by itself, purely through normalization. The exceptions
 * are both confined to ACCEPT and UNDO, the two actions that rewrite the
 * EPUB: `Library.entries` (they change the metadata the grid sorts and
 * filters on, so both move a book's position in that connection — a move
 * the payload cannot express) and the OLD `Book:<id>` entity when the id
 * rotated out from under it. DISMISS and CLEAR touch only the pending-fix
 * row, which the payload's own `library { pendingFixes }` selection already
 * reconciles, so they evict nothing.
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
 * Each action resolves a `FixOutcome`: `ok` is `true` on success and `false`
 * on any typed error (the mutation's own `BookHashCollisionError`/
 * `BookNotValidatedError`/`EpubValidationError` members) or network failure,
 * and `bookGlobalId` carries the id the server reports back — see
 * `FixOutcome`'s own doc comment for why that id is not always the one that
 * went in. `page/upload`'s REST-era `applyFix`/`undo` boolean contract is
 * preserved one layer up, in `useUploadQueueEngine`'s mappers.
 */
export const useFixActions = (): UseFixActions => {
  const [resolve] = useMutation(BookResolvePendingFixDocument);
  const [error, setError] = useState<string | undefined>(undefined);

  const run = useCallback(
    async (id: string, action: PendingFixResolution, fixes?: FixKey[]): Promise<FixOutcome> => {
      setError(undefined);
      try {
        const { data } = await resolve({
          // `fixes` is OMITTED, not passed as undefined, for bulk actions —
          // see this hook's own doc comment.
          variables: fixes === undefined ? { id, action } : { id, action, fixes },
          update: (cache, { data: mutationData }) => {
            // ACCEPT applies metadata; UNDO reverts it. Both change the
            // fields the grid sorts and filters on, so both move the book's
            // position in the connection. DISMISS and CLEAR only touch the
            // pending-fix row, which the payload's own `library {
            // pendingFixes }` selection already reconciles.
            if (action !== 'ACCEPT' && action !== 'UNDO') return;
            const result = unwrapResult<BookResolvePendingFixPayload>(
              mutationData?.bookResolvePendingFix,
              'BookResolvePendingFixPayload'
            );
            if (result.status !== 'ok') return;
            cache.evict({
              id: cache.identify({ __typename: 'Library', id: result.payload.library.id }),
              fieldName: 'entries',
            });
            // The book id ROTATES whenever the EPUB is rewritten, and
            // normalization writes the payload into a BRAND-NEW
            // `Book:<newId>` entity — it cannot know the old one described
            // the same book. Left alone, `Book:<oldId>` lingers with
            // pre-accept metadata (and a `pendingFix` holding pre-accept
            // proposals, which `page/book-edit`'s guard modal reads).
            // `cache.gc()` below does NOT save us: a `Library.book(id:
            // oldGid)` field written by any prior /book or /book-edit visit
            // still REFERENCES the orphan, so it is reachable and never
            // collected. Same branch, same reason, as
            // `component/book-edit-form`'s save and `page/book`'s regen
            // handler on this identical `applyEpubChanges` path (review I-2).
            if (result.payload.book.id !== id) {
              cache.evict({ id: cache.identify({ __typename: 'Book', id }) });
            }
            cache.gc();
          },
        });
        const result = unwrapResult<BookResolvePendingFixPayload>(
          data?.bookResolvePendingFix,
          'BookResolvePendingFixPayload'
        );
        if (result.status === 'ok') return { ok: true, bookGlobalId: result.payload.book.id };
        setError(result.status === 'error' ? result.message : 'Failed to update fixes');
        return { ok: false };
      } catch (err) {
        setError(err instanceof Error ? err.message : 'Failed to update fixes');
        return { ok: false };
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
