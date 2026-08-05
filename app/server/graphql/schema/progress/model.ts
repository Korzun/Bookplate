import { encodeGlobalID } from '@pothos/plugin-relay';

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
    /**
     * A single opaque identifier, built exactly as `Book`, `PendingFix` and
     * `Validation` build theirs: `encodeGlobalID(type, JSON.stringify([userId,
     * localKey]))`, decoded by `parseCompoundId`. Computed — there is no `id`
     * column and no migration; `Progress`'s PK stays `@@id([userId,
     * document])`.
     *
     * Replaces the raw `userId` this type used to expose. That field was a
     * genuine footgun: it carried the RAW Prisma id while every mutation input
     * named `userId` is a `t.globalID` and REJECTS a raw value ("Invalid
     * global ID: …"), so the two shared a name and a GraphQL type while being
     * incompatible — and the output one was the natural thing to pass to
     * `progressDelete`.
     *
     * The owner is still inside the id, so this remains tenant-unique:
     * `document` is a KOReader content hash and COLLIDES across users.
     *
     * `Progress` is still deliberately NOT a `Node` — see this type's own doc
     * comment. This id exists for cache identity only, following the
     * `Device`/`PendingFix`/`Validation` precedent of a scalar id with no
     * `node(id:)` door.
     */
    id: t.field({
      type: 'ID',
      resolve: (progress) =>
        encodeGlobalID('Progress', JSON.stringify([progress.userId, progress.document])),
    }),
    document: t.exposeString('document'),
    position: t.exposeString('progress', {
      description: 'Reader position as a KOReader CFI/xpointer string.',
    }),
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
