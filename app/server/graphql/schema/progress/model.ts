import { encodeGlobalID } from '@pothos/plugin-relay';

import { deriveCurrentChapter, epochSecondsToDate, parseNumberArray } from '../../derive';
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
      description:
        'Opaque cache identity for this reading position. Unlike other global ' +
        'ids in this schema (e.g. `Book.id`, `PendingFix.id`, `Validation.id` ' +
        '(to their owning `Book`)), this id is NOT resolvable through ' +
        '`node(id:)` or `nodes(ids:)` — ' +
        '`Progress` is deliberately not a `Node`. Use it only to key a ' +
        'normalizing cache.',
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
     * `t.relation`, over the `Progress.book` relation declared in
     * `prisma/schema.prisma` — read that declaration before touching this: the
     * relation carries NO database foreign key, and its comment says why and
     * what would break it.
     *
     * This field used to be a `t.field` + `context.loadBookByDocument`, and it
     * used to live outside this `fields:` callback, in a
     * `builder.prismaObjectField('Progress', 'book', …)` block, because
     * naming the `Book` REF here while `book/model.ts` symmetrically named the
     * `Progress` ref in its own `fields:` callback was the "2 prisma object
     * refs reference each other" case `@pothos/plugin-prisma`'s README warns
     * about — it degraded `Book`'s inferred prisma type to `any` and produced
     * ~150 cascading `tsc` errors across unrelated files.
     *
     * `t.relation('book')` does not name the ref at all: it types off the
     * generated `PrismaTypes` for the relation NAME, so the cycle has nothing
     * to close. Verified, not assumed — `tsc --noEmit` and
     * `tsc --noEmit -p tsconfig.test.json` are both clean with this field
     * inline and `../book/model` no longer imported here at all.
     * `book/model.ts`'s `Book.progress` is the OTHER direction and still needs
     * its loader; see `currentChapter` below and `graphql/loaders/pair-loader.ts`.
     */
    book: t.relation('book', {
      nullable: true,
      description:
        'The library book this reading position belongs to, or null when the ' +
        'document is not in this library at all — a KOReader device syncs ' +
        'progress for whatever it is reading, including books never imported ' +
        'here. Those rows still render; they simply have no book to link to. ' +
        'Mirrors `LinkedDocument.oldBook`/`newBook`: a raw content hash for ' +
        'display (`document`) beside a resolvable edge for navigation.',
    }),

    /**
     * The 1-based chapter this reading position falls in, or null when it
     * cannot be determined.
     *
     * `GET /api/my/progress` (`routes/ui.ts`) computed this in the route
     * handler, from `parseCfiSpineIndex` over the `progress` CFI plus the
     * book's `chapterSpineMap`. That computation lives in `derive.ts` as
     * `deriveCurrentChapter`, so the two readings cannot drift — the same
     * anti-drift rule that put the JSON-column parsers there.
     *
     * THE SPINE MAP COMES FROM A FIELD `select` ON THE `book` RELATION, not
     * from a query of its own and no longer from `context.loadChapterSpineMap`
     * (that loader is deleted). `@pothos/plugin-prisma` merges this `select`
     * into whatever query it planned for the rows this field is resolved on,
     * so a page of N progress rows costs zero extra queries instead of N
     * `findUnique` calls or one batched `findMany`. Measured on a page of 8
     * selecting `book { title }` and `currentChapter`: 3 queries before
     * (1 `progress.findMany` + 2 `book.findMany`, one per loader), 1 after.
     *
     * THAT ONLY WORKS ON A PLUGIN-PLANNED PATH, which is exactly what
     * `Library.progress` became when it stopped being a hand-declared
     * `connectionObject` — see `graphql/loaders/pair-loader.ts` for the
     * mechanism and `library/model.ts`'s `progress` field for the conversion.
     * `Book.progress` (`book/model.ts`) reaches `Progress` from the OTHER
     * direction, through `Library.entries`, which IS still hand-built — so it
     * keeps its loader, and any field added here that needs a second query
     * must reckon with that path too.
     *
     * The relation is owner-scoped by construction: it joins on
     * `[userId, document] -> [userId, id]`, so the book whose spine map is
     * consulted is the *owner's* copy. That matters because book ids are
     * content hashes and two users routinely hold the same id for the same
     * file; it is the same guarantee the loader made by batching explicit
     * `(userId, key)` pairs.
     *
     * `book` is nullable — a KOReader device syncs progress for documents
     * never imported here — so an absent book degrades to `null`, the same
     * answer `deriveCurrentChapter` gives for a book with no chapters.
     */
    currentChapter: t.int({
      nullable: true,
      select: { book: { select: { chapterSpineMap: true } } } as const,
      resolve: (progress) =>
        deriveCurrentChapter(
          progress.progress,
          progress.book ? parseNumberArray(progress.book.chapterSpineMap) : undefined
        ),
    }),
  }),
});
