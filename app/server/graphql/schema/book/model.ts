import { getBookLineage } from '../../../services/book-lineage';
import { countForBook } from '../../../services/edition';
import type { Context } from '../../context';
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
// `../linked-document/model`, not `../linked-document`: this file's own rule
// two lines down ("model files import `../<entity>/model`; only `schema/
// index.ts` imports entity indexes") applies here too — the index is
// currently a pure re-export, so this was benign, but task 2 made this edge
// one leg of a real `book`↔`linkedDocument` type cycle (`linked-document/
// model.ts` now imports `../book/model` back), and a future mutation file
// added under `linked-document/` would turn "benign" into another instance
// of the exact hazard this rule exists to prevent.
import { model as linkedDocument } from '../linked-document/model';
import { model as pendingFix } from '../pending-fix';
// `../progress/model`, not `../progress`: the entity index also side-effect-
// imports `progress/mutation/delete.ts`, which reaches `Library` — and
// `Library` reaches back here. Importing the defining module rather than the
// index keeps a model-to-model reference from dragging a whole entity's field
// registrations into the cycle, which is Pothos's own advice for its
// "Received undefined as a type ref" error. The rule generalises: model files
// import `../<entity>/model`; only `schema/index.ts` imports entity indexes.
import { model as progress } from '../progress/model';
import { findUnique } from './node-loader';

/**
 * Builds the query-string suffix (no leading `?`) shared by `coverUrl`,
 * `downloadUrl`, and `thumbnailUrl`. Fixes the admin-broken REST URLs those
 * fields used to emit bare: REST's `resolveOwner` (`routes/ui.ts:150-171`)
 * 400s an admin session that hits a book route without `?user=<username>`,
 * since an admin has no library of its own to default to — so a URL minted
 * for an admin viewer without this param was never actually fetchable.
 *
 * `user=` is admin-only and always comes first (ordering is deterministic,
 * not load-bearing): a self viewer's own session already scopes REST's
 * `resolveOwner` to their own library, and `?user=` on a self URL would be
 * dead weight at best — worse, it would be a param a non-admin session isn't
 * even allowed to pass (REST 403s a regular user who sends `?user=`), so it
 * must never appear on a self-read's URL. `v=<mtime>` is unconditional: it's
 * REST's existing cache-busting token (`routes/ui.ts`'s cover route), present
 * whether or not the viewer is an admin.
 *
 * Owner username comes from `context.loadOwner` — request-scoped and
 * promise-cached (`owner.ts`), so N books on one page share one `User`
 * lookup rather than issuing one per book. A `null` result (the book row's
 * own owner has vanished mid-request — a real but narrow race) omits `user=`
 * and keeps `v=` rather than failing the whole field: the URL degrades to a
 * self-shaped one instead of erroring out a field that has nothing else
 * useful to report. For an admin viewer specifically, that degraded URL is
 * knowingly unfetchable — REST's `resolveOwner` 400s an admin session with no
 * `?user=` (same branch this helper mirrors) — not merely a plainer URL; a
 * field with nothing else useful to report still can't do better than that
 * without failing outright, so the degradation is accepted as-is rather than
 * chased with a test (the race itself is unraceable in-process).
 *
 * `Math.floor` on `mtime`: the Prisma column is a `Float` holding
 * `stat.mtimeMs` (`services/book-lifecycle.ts`), so an unfloored value like
 * `1785702915092.761` would diverge, byte for byte, from the REST client's
 * own cache-busting token (`app/client/src/lib/cover-url.ts`'s
 * `versionToken`, which floors) — two different `?v=` strings for the same
 * cover under an `immutable` cache policy, and so two cache entries and a
 * duplicate download for as long as both URL builders coexist during the
 * Apollo migration.
 */
const urlSuffix = async (
  book: { userId: string; mtime: number },
  context: Context
): Promise<string> => {
  const parts: string[] = [];
  if (context.viewer?.isAdmin === true) {
    const owner = await context.loadOwner(book.userId);
    if (owner !== null) parts.push(`user=${encodeURIComponent(owner.username)}`);
  }
  parts.push(`v=${Math.floor(book.mtime)}`);
  return parts.join('&');
};

export const model = builder.prismaNode('Book', {
  id: { field: 'userId_id' },
  findUnique,
  nullable: true,
  fields: (t) => ({
    /**
     * The raw content-hash id, for DISPLAY ONLY — never to address this book.
     * `id` (the Relay global id) is the only identifier; every mutation and
     * every `node(id:)`/`Library.book(id:)` lookup takes that. This is the
     * same display-only contract `LinkedDocument.oldId`/`newId` already carry
     * ("Raw content-hash for display; resolve `oldBook`/`newBook` to
     * navigate.", `linked-document/model.ts`) — applied to the type those
     * ids are entries *about*, not a reversal of the decision that made the
     * Relay id the sole address.
     *
     * Exists because the client's book-lineage modal renders a book's own
     * document id as visible text alongside its former ids, and those former
     * ids are raw hashes too. Without this field a book with no lineage
     * entries — one never edited or re-imported — has no id to show in that
     * row at all, since the entry list it would otherwise be derived from is
     * empty.
     */
    documentId: t.exposeString('id', {
      description:
        'Raw content-hash id, for DISPLAY ONLY. `id` (the Relay global id) is ' +
        'the sole address for this book — every mutation and every lookup ' +
        'takes that, never this. Same display-only contract as ' +
        '`LinkedDocument.oldId`/`newId`.',
    }),

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
    coverUrl: t.string({
      description:
        "REST URL for this book's cover image. Admin viewers get " +
        '`?user=<owner username>` appended (their session has no library of ' +
        'its own to default to); every viewer gets `v=<mtime epoch>` for ' +
        'cache-busting.',
      resolve: async (book, _args, context) =>
        `/api/books/${book.id}/cover?${await urlSuffix(book, context)}`,
    }),
    downloadUrl: t.string({
      description:
        "REST URL to download this book's EPUB file. Same `?user=`/`v=` " +
        'suffix as `coverUrl` — see its description.',
      resolve: async (book, _args, context) =>
        `/api/books/${book.id}/download?${await urlSuffix(book, context)}`,
    }),
    thumbnailUrl: t.string({
      description:
        'REST URL for a resized cover thumbnail. `width` comes first, then ' +
        'the same `?user=`/`v=` suffix `coverUrl` appends.',
      args: { width: t.arg.int({ required: true }) },
      resolve: async (book, args, context) =>
        `/api/books/${book.id}/cover?width=${args.width}&${await urlSuffix(book, context)}`,
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
    // ran REST's now-removed `getPendingFixes` TTL cleanup) while still
    // showing here as a stale badge. Both readings now apply the identical
    // predicate, so that gap cannot reopen. Read cleanup (deleting the
    // expired row) is deliberately NOT done here — see `Library
    // .pendingFixes`'s doc comment in `library/model.ts` for why a read
    // resolver filters rather than mutates, and for what prunes rows now.
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
     * Whether this book has a LIVE pending fix carrying at least one
     * ACTIONABLE proposal — one with a concrete `to`. That is the single
     * question `page/book-edit`'s conflict guard asks, and it is answered
     * here rather than by shipping the proposal list to the client.
     *
     * The reason is a client cache defect, not a preference.
     * `PendingFixState` has no `id` and no `keyFields` entry in the client's
     * `provider/apollo/cache.ts`, so it is NOT normalized — the cache
     * replaces it WHOLESALE. A page selecting a NARROW `state` therefore
     * destroyed the fuller one already cached under the shared
     * `PendingFix:<id>` entity, which turned the app-wide
     * `LibraryPendingFixes` watcher's diff incomplete and cost a spurious
     * refetch of the client's second most expensive operation on every
     * book-edit visit to a book with a pending fix. A boolean writes nothing
     * into that entity, so the defect cannot recur from a caller of this
     * field however narrow its selection.
     *
     * ADVISORY proposals (`to: null`, "needs review") do NOT count, and that
     * asymmetry is load-bearing: `bookResolvePendingFix`'s ACCEPT filters to
     * `to !== null` and leaves them behind, so they can never be cleared by
     * accepting, and `FixReview` resolves them by linking to the edit page —
     * the very screen a guard on them would bounce the user away from.
     *
     * Gated by the same `isLivePendingFix` predicate as `pendingFix` above
     * and `Library.pendingFixes`, so a third reading of the same row cannot
     * drift from the other two. Resolved through the same
     * `context.loadPendingFix` batching loader for the same reason: `Book`
     * is reachable from a list, and a plain `findUnique` would be N queries
     * for a page of N books.
     */
    hasActionablePendingFix: t.boolean({
      resolve: async (book, _args, context) => {
        const row = await context.loadPendingFix(book.userId, book.id);
        if (!row) return false;
        const state = parsePendingFixState(row.state);
        if (!isLivePendingFix(state, row.updatedAt, Date.now())) return false;
        return state.proposals.some((proposal) => proposal.to !== null);
      },
    }),

    /**
     * Book -> Progress is not a Prisma relation (`Progress` has no FK to
     * `Book`; it is keyed by KOReader `document` hash, which is *normally* a
     * book's own id). It is looked up by `document = book.id` directly, without
     * consulting `getBookLineage`/`BookIdHistory`, because `reimportBook`/
     * `linkDocument` already maintain that invariant: both `reimportBook`
     * (id changes from re-parsing an edited EPUB) and `linkDocument` (manual
     * document merges) migrate any existing progress row onto the book's
     * new/target id inside the same transaction that writes the lineage row,
     * deleting the old-id row unconditionally (see `services/book-lifecycle.
     * ts`'s `reimportBook` and `services/book-lineage.ts`'s `linkDocument`).
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
     * `(userId, oldId)`, not by a FK to `Book`), so it goes through the
     * imported `getBookLineage` (`services/book-lineage.ts`) — the same
     * function REST's `GET /api/books/:id/lineage` calls — rather than
     * `t.relation`.
     *
     * `getBookLineage` takes a full `Owner` (`{ userId, username }`), but a
     * `Book` row only carries `userId`. Resolved via `context.loadOwner(userId)`
     * — the same request-scoped, memoized loader `Viewer.library` and `Library`
     * itself already use — rather than synthesizing a `{ userId, username: '' }`
     * stand-in. `getBookLineage` only reads `owner.userId` today (it scopes its
     * SQL by `user_id` alone; `username` is unused — see
     * `services/book-lineage.ts`), so a synthesized owner would work right
     * now, but it would be a landmine for whoever changes that function later
     * to also depend on `username` (or for any future caller who copies this
     * resolver as a template). Going
     * through the real loader costs one memoized `User` lookup per request (or a
     * cache hit if `Viewer.library` already ran) and always yields a genuine
     * `Owner` instead of a field-by-field guess about which parts of it matter.
     *
     * A `null` `loadOwner` result (the book's own user row missing) is treated
     * the same as "no lineage" rather than surfaced as an error: the resolver
     * has nothing else to report, and the owner-scoped `Book` this field hangs
     * off of could only be reached at all because that row already resolved once
     * upstream.
     *
     * Each entry is extended with `parent.userId` here — an internal shape
     * addition, not an SDL field — so `LinkedDocument`'s `oldBook`/`newBook`
     * resolvers (`linked-document/model.ts`) have an owner to look the
     * referenced book up under without a second `loadOwner` round trip. Same
     * "thread the owner the parent already resolved" shape
     * `Library.searchSuggestions` uses for `Suggestion.book` (`library/
     * model.ts`), for the identical reason.
     */
    lineage: t.field({
      type: [linkedDocument],
      resolve: async (parent, _args, context) => {
        const owner = await context.loadOwner(parent.userId);
        if (owner === null) return [];
        const lineage = await getBookLineage(context.prisma, owner, parent.id);
        return (lineage?.entries ?? []).map((entry) => ({ ...entry, userId: parent.userId }));
      },
    }),

    /**
     * How many per-device converted editions of this book are cached for its
     * owner. `GET /api/books/:id` (`routes/ui.ts`) asks `getBookById` for it via
     * `{ withEditionCount: true }`, and `getBookById` in turn calls exactly this
     * function with exactly these two arguments (`book-catalog.ts`:
     * `book.deviceEditionCount = await countForBook(prisma, owner.userId, id)`),
     * so this is the same number REST reports, from the same query.
     *
     * Both arguments come off the parent row — `parent.userId` is the book's own
     * owner, never re-derived from the viewer — so the count is owner-scoped by
     * construction, in the same sense `Book.progress` is.
     *
     * `t.int` over a direct call, not `t.relationCount`: this resolves through a
     * plain function, not a Prisma relation — `DeviceEdition` has no relation to
     * `Book` in `schema.prisma` (it is keyed `[userId, originalBookId, deviceId]`
     * with no foreign key), so `t.relationCount` cannot express it.
     */
    deviceEditionCount: t.int({
      resolve: (book, _args, context) => countForBook(context.prisma, book.userId, book.id),
    }),
  }),
});
