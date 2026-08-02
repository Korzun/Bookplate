import { builder } from '../builder';

type PendingFixResolutionValue = 'accept' | 'dismiss';

/**
 * The single mutation the spec names (`bookResolvePendingFix`) covers both of
 * REST's pending-fix write routes (`PUT`/`DELETE /api/books/:id/pending-fixes`,
 * `routes/ui.ts:776-811`) via this discriminator, rather than two separate
 * mutations — see `book/mutation/resolve-pending-fix.ts`'s main doc comment
 * for the full design rationale, including why "accept" is NOT a literal 1:1
 * REST mirror (no REST route atomically applies a pending fix's proposals;
 * the client currently does that itself across several requests — traced in
 * the task report).
 */
export const model = builder.enumType('PendingFixResolution', {
  values: {
    ACCEPT: { value: 'accept' },
    DISMISS: { value: 'dismiss' },
  } as const satisfies Record<
    Uppercase<PendingFixResolutionValue>,
    { value: PendingFixResolutionValue }
  >,
});
