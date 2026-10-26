import { builder } from '../builder';

type PendingFixResolutionValue = 'accept' | 'dismiss' | 'undo' | 'clear' | 'edit';

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
 *
 * `EDIT` is ACCEPT with a user-typed value in place of the proposal's own
 * `to`: it exists for advisory ("needs review", `to: null`) proposals, which
 * ACCEPT deliberately skips because they carry no suggestion to apply. It
 * addresses exactly one proposal (`fixes[0]`), writes `value` to that
 * proposal's field, and persists the same post-accept row shape ACCEPT does —
 * the proposal moves to `appliedFixes` with `to: value`, and an `apply` undo
 * snapshot is armed, so the client's existing Undo affordance covers it.
 */
export const model = builder.enumType('PendingFixResolution', {
  values: {
    ACCEPT: { value: 'accept' },
    DISMISS: { value: 'dismiss' },
    UNDO: { value: 'undo' },
    CLEAR: { value: 'clear' },
    EDIT: { value: 'edit' },
  } as const satisfies Record<
    Uppercase<PendingFixResolutionValue>,
    { value: PendingFixResolutionValue }
  >,
});
