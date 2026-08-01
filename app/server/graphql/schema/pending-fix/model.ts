import { epochToDate, parsePendingFixState } from '../../derive';
import { builder } from '../builder';
import { model as pendingFixState } from '../pending-fix-state';

/**
 * Deliberately a prismaObject, not a prismaNode, following `Validation`'s and
 * `Progress`'s precedent: `PendingFix` is only ever reached through a `Book`
 * that is already owner-scoped, so a global ID would add a second,
 * separately-guarded door onto tenant-owned data for no client benefit.
 *
 * `state` resolves the stored JSON string through `parsePendingFixState`
 * (`derive.ts`) into the typed `PendingFixState` object graph — see the
 * cleanup spec, §"2. Typed PendingFixState". The same total parser backs
 * `getPendingFixes`'s DTO reading (`book-store.ts`), so this reading and
 * REST's never disagree about what the string means.
 */
export const model = builder.prismaObject('PendingFix', {
  fields: (t) => ({
    fileName: t.exposeString('fileName'),
    fileSize: t.exposeInt('fileSize'),
    state: t.field({
      type: pendingFixState,
      resolve: (pendingFix) => parsePendingFixState(pendingFix.state),
    }),
    createdAt: t.field({
      type: 'DateTime',
      resolve: (pendingFix) => epochToDate(pendingFix.createdAt),
    }),
    updatedAt: t.field({
      type: 'DateTime',
      resolve: (pendingFix) => epochToDate(pendingFix.updatedAt),
    }),
  }),
});
