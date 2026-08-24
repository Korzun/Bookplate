import { builder } from '../builder';

type PendingFixResolutionValue = 'accept' | 'dismiss' | 'undo' | 'clear';

/**
 * The single mutation the spec names (`bookResolvePendingFix`) covers the
 * client's upload-queue operations via this discriminator, rather than a
 * separate mutation per action — see `book/mutation/resolve-pending-fix.ts`'s
 * main doc comment for the full design rationale, including why "accept" is
 * NOT a literal 1:1 REST mirror (no REST route atomically applies a pending
 * fix's proposals; the client currently does that itself across several
 * requests — traced in the task report). `CLEAR`, not `DISMISS`, is the
 * literal successor to REST's unconditional `DELETE
 * /api/books/:id/pending-fixes`; `DISMISS` instead clears proposals and arms
 * a recoverable `undo`, leaving the row in place. `UNDO` reverts whatever
 * `undo` snapshot is currently armed — by either `DISMISS` or `ACCEPT` — and
 * is entirely new server-side behaviour: REST's client did the equivalent
 * itself (re-PATCH the original metadata, delete the book's lineage, restore
 * the proposal list locally) across several requests, none of which are
 * possible client-side any more now that the server owns fix state.
 */
export const model = builder.enumType('PendingFixResolution', {
  values: {
    ACCEPT: { value: 'accept' },
    DISMISS: { value: 'dismiss' },
    UNDO: { value: 'undo' },
    CLEAR: { value: 'clear' },
  } as const satisfies Record<
    Uppercase<PendingFixResolutionValue>,
    { value: PendingFixResolutionValue }
  >,
});
