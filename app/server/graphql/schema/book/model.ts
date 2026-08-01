import {
  epochToDate,
  isLivePendingFix,
  parseIdentifiers,
  parseNullableStringArray,
  parseNumberArray,
  parsePendingFixState,
  parseStringArray,
} from '../../derive';
import { builder } from '../builder';
import { model as identifier } from '../identifier';
import { model as linkedDocument } from '../linked-document';
import { model as pendingFix } from '../pending-fix';
import { model as progress } from '../progress';
import { findUnique } from './node-loader';

export const model = builder.prismaNode('Book', {
  id: { field: 'userId_id' },
  findUnique,
  nullable: true,
  fields: (t) => ({
    // The raw content-hash id, alongside the Relay global `id`.
    //
    // Not redundant with `id`: three sibling fields in this schema already
    // carry this exact value as an opaque string — `Progress.document`,
    // `LinkedDocument.oldId`/`newId` — and `Library.book(id:)` takes it as an
    // argument. Without this field a client holding a `Book` cannot join to
    // any of them, cannot re-fetch itself through `Library.book(id:)`, and
    // cannot build the cover, thumbnail or download URLs (which are
    // `/api/books/<this>/...`).
    //
    // `Book.id` cannot serve that purpose: it is a base64 global ID over
    // `JSON.stringify([userId, id])`, so extracting the hash from it client-
    // side would mean re-implementing Pothos's compound-id encoding.
    bookId: t.exposeString('id'),

    title: t.exposeString('title'),
    titleSort: t.exposeString('titleSort'),
    author: t.exposeString('author'),
    authorSort: t.exposeString('authorSort'),
    description: t.exposeString('description'),
    publisher: t.exposeString('publisher'),
    publishDate: t.exposeString('publishDate'),
    seriesIndex: t.exposeFloat('seriesIndex'),
    size: t.exposeInt('size'),
    pageCount: t.exposeInt('pageCount'),
    chapterCount: t.exposeInt('chapterCount'),

    subjects: t.field({ type: ['String'], resolve: (book) => parseStringArray(book.subjects) }),
    identifiers: t.field({
      type: [identifier],
      resolve: (book) => parseIdentifiers(book.identifiers),
    }),
    chapterSpineMap: t.field({
      type: ['Int'],
      resolve: (book) => parseNumberArray(book.chapterSpineMap),
    }),
    chapterNames: t.field({
      type: ['String'],
      nullable: true,
      resolve: (book) => parseNullableStringArray(book.chapterNames),
    }),

    mtime: t.field({ type: 'DateTime', resolve: (book) => epochToDate(book.mtime) }),
    addedAt: t.field({ type: 'DateTime', resolve: (book) => epochToDate(book.addedAt) }),

    hasCover: t.boolean({ resolve: (book) => book.coverMime !== null }),
    coverUrl: t.string({ resolve: (book) => `/api/books/${book.id}/cover` }),
    downloadUrl: t.string({ resolve: (book) => `/api/books/${book.id}/download` }),
    thumbnailUrl: t.string({
      args: { width: t.arg.int({ required: true }) },
      resolve: (book, args) => `/api/books/${book.id}/cover?width=${args.width}`,
    }),

    // `Book.series` is the relation, not the denormalized `series` string
    // column — that column stays in the database for OPDS and the import
    // pipeline. `t.relation` needs no import of `Series`: the prisma plugin
    // reads the GraphQL type off the Prisma relation itself.
    series: t.relation('seriesRel', { nullable: true }),

    validation: t.relation('validation', { nullable: true }),

    // Gated by the same `isLivePendingFix` predicate as `Library.pendingFixes`
    // (cleanup spec, §"3. One PendingFix type") — the relation resolves, then
    // a not-live row is nulled out here rather than returned. This closes a
    // previously-accepted drift: before this predicate existed, this field
    // was a bare relation with no expiry check, so a fix applied 7+ days ago
    // with no proposals left would vanish from `Library.pendingFixes` (which
    // ran `getPendingFixes`'s TTL cleanup) while still showing here as a
    // stale badge, until something else happened to read the list and
    // trigger REST's delete-on-read. Both GraphQL readings now apply the
    // identical predicate, so that gap cannot reopen from this side. Read
    // cleanup (deleting the expired row, as REST's `getPendingFixes` still
    // does) is deliberately NOT replicated here — see `Library.pendingFixes`'s
    // doc comment in `library/model.ts` for why a read resolver filters
    // rather than mutates.
    //
    // `t.field`, not `t.relation`: `t.relation`'s `resolve` option is only a
    // *fallback*, used solely when the plugin's own query-merging optimizer
    // did not already eagerly select the relation onto the parent `Book` row
    // — and `Library.book` (`library/model.ts`) fetches `Book` through
    // `t.prismaField`, whose smart-select machinery does exactly that, so a
    // `t.relation` gate here would silently never run.
    //
    // Resolved through `context.loadPendingFix` rather than a direct
    // `prisma.pendingFix.findUnique`, for exactly the reason `Book.progress`
    // (below) goes through `context.loadProgress`: `PendingFix` has the same
    // shape for this purpose — non-relation from Pothos's perspective (once a
    // custom resolver replaces `t.relation`), compound-keyed
    // (`@@id([userId, bookId])`), one per-book lookup reached from `Book` —
    // and `Book` is reachable from a list (`Library.entries`). A plain
    // `findUnique` here would be N queries for a page of N books; the
    // request-scoped batching loader (`pending-fix-loader.ts`) collapses that
    // into one `findMany`. See that file for the loader itself, including why
    // it batches by an explicit `{userId, bookId}` pair list rather than a
    // single `userId` + `bookId IN (...)` (book ids are content hashes shared
    // across users).
    pendingFix: t.field({
      type: pendingFix,
      nullable: true,
      resolve: async (book, _args, context) => {
        const row = await context.loadPendingFix(book.userId, book.id);
        if (!row) return null;
        return isLivePendingFix(parsePendingFixState(row.state), row.updatedAt, Date.now())
          ? row
          : null;
      },
    }),

    /**
     * Book -> Progress is not a Prisma relation (`Progress` has no FK to
     * `Book`; it is keyed by KOReader `document` hash, which is *normally* a
     * book's own id). It is looked up by `document = book.id` directly, without
     * consulting `getBookLineage`/`BookIdHistory`, because the store already
     * maintains that invariant: both `reimportBook` (id changes from re-parsing
     * an edited EPUB) and `linkDocument` (manual document merges) migrate any
     * existing progress row onto the book's new/target id inside the same
     * transaction that writes the lineage row, deleting the old-id row
     * unconditionally (see `book-store.ts`'s `reimportBook` and `linkDocument`).
     * KOReader sync writes go through the same normalization (`resolveBookId`
     * before `saveProgress`, in `routes/kosync.ts`). So a live book's progress
     * is never left stranded under a stale id — there is nothing for a
     * lineage-aware lookup to find that this simple lookup would miss, and
     * doing the lookup anyway would just be an extra query on every request.
     *
     * Resolved through `context.loadProgress` rather than a direct
     * `prisma.progress.findUnique`: a page of N books each selecting `progress`
     * measured as N separate `findUnique` calls (see `progress-loader.ts`), so
     * this goes through the request-scoped batching loader instead, the same
     * way `Library.user`/`Viewer.library` go through `context.loadOwner`.
     *
     * `t.field`, not `t.prismaField`: the loader's `findMany` fetches whole
     * rows for the batch regardless of which `Progress` sub-fields the query
     * actually selected — there is no per-field `query.select` to merge into a
     * batched call the way `t.prismaField` merges one into a single-row lookup,
     * and `progress` has no relations to avoid over-fetching, so trading that
     * optimization away for a single request-wide query is deliberate, not an
     * oversight.
     */
    progress: t.field({
      type: progress,
      nullable: true,
      resolve: (parent, _args, context) => context.loadProgress(parent.userId, parent.id),
    }),

    /**
     * `Book.lineage` is not a Prisma relation (`BookIdHistory` is keyed by
     * `(userId, oldId)`, not by a FK to `Book`), so it goes through
     * `context.stores.book.getBookLineage` — the same store method REST's
     * `GET /api/books/:id/lineage` calls — rather than `t.relation`.
     *
     * `getBookLineage` takes a full `Owner` (`{ userId, username }`), but a
     * `Book` row only carries `userId`. Resolved via `context.loadOwner(userId)`
     * — the same request-scoped, memoized loader `Viewer.library` and `Library`
     * itself already use — rather than synthesizing a `{ userId, username: '' }`
     * stand-in. `getBookLineage` only reads `owner.userId` today (it scopes its
     * SQL by `user_id` alone; `username` is unused — see `book-store.ts`), so a
     * synthesized owner would work right now, but it would be a landmine for
     * whoever changes that store method later to also depend on `username` (or
     * for any future caller who copies this resolver as a template). Going
     * through the real loader costs one memoized `User` lookup per request (or a
     * cache hit if `Viewer.library` already ran) and always yields a genuine
     * `Owner` instead of a field-by-field guess about which parts of it matter.
     *
     * A `null` `loadOwner` result (the book's own user row missing) is treated
     * the same as "no lineage" rather than surfaced as an error: the resolver
     * has nothing else to report, and the owner-scoped `Book` this field hangs
     * off of could only be reached at all because that row already resolved once
     * upstream.
     */
    lineage: t.field({
      type: [linkedDocument],
      resolve: async (parent, _args, context) => {
        const owner = await context.loadOwner(parent.userId);
        if (owner === null) return [];
        const lineage = await context.stores.book.getBookLineage(owner, parent.id);
        return lineage?.entries ?? [];
      },
    }),

    /**
     * How many per-device converted editions of this book are cached for its
     * owner. `GET /api/books/:id` (`routes/ui.ts`) asks `getBookById` for it via
     * `{ withEditionCount: true }`, and `getBookById` in turn calls exactly this
     * store method with exactly these two arguments (`book-store.ts`:
     * `book.deviceEditionCount = await this.editionStore.countForBook(owner.userId, id)`),
     * so this is the same number REST reports, from the same query.
     *
     * Both arguments come off the parent row — `parent.userId` is the book's own
     * owner, never re-derived from the viewer — so the count is owner-scoped by
     * construction, in the same sense `Book.progress` is.
     *
     * `t.int` over a store call, not `t.relationCount`: this resolves through a
     * store, not a Prisma relation — `DeviceEdition` has no relation to `Book`
     * in `schema.prisma` (it is keyed `[userId, originalBookId, deviceId]` with
     * no foreign key), so `t.relationCount` cannot express it.
     */
    deviceEditionCount: t.int({
      resolve: (book, _args, context) => context.stores.edition.countForBook(book.userId, book.id),
    }),
  }),
});
