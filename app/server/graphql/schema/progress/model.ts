import { deriveCurrentChapter, epochSecondsToDate } from '../../derive';
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

    // `DateTime!`, not the column's raw `Int`. Every other epoch column in
    // this schema (`Book.mtime`/`addedAt`, `Device.createdAt`/`updatedAt`,
    // `PendingFix.createdAt`/`updatedAt`, `Validation.validatedAt`) is a
    // `DateTime`, so a client that trusted the schema's own convention and
    // did `new Date(timestamp)` on a bare number would land in 1970 — this
    // one column is stored in SECONDS, because KOReader's sync protocol
    // writes it that way (`routes/kosync.ts`).
    //
    // The seconds→milliseconds conversion is explicit, via a function whose
    // name says "seconds": reusing `epochToDate` would be silently wrong,
    // since it documents its input as milliseconds and both are bare numbers
    // at the call site.
    timestamp: t.field({
      type: 'DateTime',
      resolve: (progress) => epochSecondsToDate(progress.timestamp),
    }),

    /**
     * The 1-based chapter this reading position falls in, or null when it
     * cannot be determined.
     *
     * `GET /api/my/progress` (`routes/ui.ts`) computes this in the route
     * handler, from `parseCfiSpineIndex` over the `progress` CFI plus the
     * book's `chapterSpineMap`. That computation now lives in `derive.ts` as
     * `deriveCurrentChapter`, so the two readings cannot drift — the same
     * anti-drift rule that put the JSON-column parsers there.
     *
     * The spine map is fetched through `context.loadChapterSpineMap`, a
     * request-scoped batching loader, because a page of progress rows would
     * otherwise be one book lookup per row. REST solves the same N+1 with
     * `getChapterSpineMaps`, batching the whole page in its handler; a
     * resolver has no page to batch over, so the loader does it instead.
     *
     * `parent.userId` is the progress row's own owner, read off the parent
     * and never re-derived — the book whose spine map is consulted is the
     * *owner's* copy, which matters because book ids are content hashes and
     * two users routinely hold the same id for the same file.
     */
    currentChapter: t.int({
      nullable: true,
      resolve: async (progress, _args, context) =>
        deriveCurrentChapter(
          progress.progress,
          (await context.loadChapterSpineMap(progress.userId, progress.document)) ?? undefined
        ),
    }),
  }),
});
