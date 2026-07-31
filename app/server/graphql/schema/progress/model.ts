import * as book from '../book';
import { builder } from '../builder';

/**
 * Deliberately a prismaObject, not a prismaNode, following `Validation`'s
 * precedent: `Progress` is only ever reached through a `Book` or `Library`
 * that is already owner-scoped, so a global ID would add a second,
 * separately-guarded door onto tenant-owned data for no client benefit.
 */
export const model = builder.prismaObject('Progress', {
  fields: (t) => ({
    document: t.exposeString('document'),
    progress: t.exposeString('progress'),
    percentage: t.exposeFloat('percentage'),
    device: t.exposeString('device'),
    deviceId: t.exposeString('deviceId'),
    timestamp: t.exposeInt('timestamp'),
  }),
});

/**
 * Book -> Progress is not a Prisma relation (`Progress` has no FK to `Book`;
 * it is keyed by KOReader `document` hash, which is *normally* a book's own
 * id). It is looked up by `document = book.id` directly, without consulting
 * `getBookLineage`/`BookIdHistory`, because the store already maintains that
 * invariant: both `reimportBook` (id changes from re-parsing an edited EPUB)
 * and `linkDocument` (manual document merges) migrate any existing progress
 * row onto the book's new/target id inside the same transaction that writes
 * the lineage row, deleting the old-id row unconditionally
 * (see `book-store.ts`'s `reimportBook` and `linkDocument`). KOReader sync
 * writes go through the same normalization (`resolveBookId` before
 * `saveProgress`, in `routes/kosync.ts`). So a live book's progress is never
 * left stranded under a stale id — there is nothing for a lineage-aware
 * lookup to find that this simple lookup would miss, and doing the lookup
 * anyway would just be an extra query on every request.
 *
 * Resolved through `context.loadProgress` rather than a direct
 * `prisma.progress.findUnique`: a page of N books each selecting `progress`
 * measured as N separate `findUnique` calls (see `progress-loader.ts`), so
 * this goes through the request-scoped batching loader instead, the same way
 * `Library.user`/`Viewer.library` go through `context.loadOwner`.
 */
builder.objectField(book.model, 'progress', (t) =>
  t.field({
    type: model,
    nullable: true,
    resolve: (parent, _args, context) => context.loadProgress(parent.userId, parent.id),
  })
);
