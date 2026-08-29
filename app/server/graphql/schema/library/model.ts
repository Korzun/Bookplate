import { getAuthors, getSubjects } from '../../../services/book-catalog';
import { resolveBookId } from '../../../services/book-lineage';
import { listBooksPage } from '../../../services/library-page';
import { getUserProgressPage } from '../../../services/progress';
import { getSeriesNextIndex } from '../../../services/series-meta';
import type { BookListFilters, Owner } from '../../../types';
import {
  clampProgressTake,
  decodeProgressCursor,
  encodeProgressCursor,
} from '../../../utils/progress-pagination';
import { isLivePendingFix, parsePendingFixState } from '../../derive';
// `../book/model`, not `../book`: `book/index.ts` now also side-effect-imports
// `book/mutation/*.ts` (task 2). `book/mutation/delete.ts` reaches `Library`
// (this file, for `BookDeletePayload.library`) — and `Library` reaches back
// here for `book`. (Corrected after review — task-2 review Minor-4: this was
// previously misattributed to `BookUpdateMetadataPayload`/`update-metadata.ts`,
// which has no `library` field and never imports this file at all; the real
// edge is `delete.ts` only.) Same reasoning as the `progress` import two
// lines down.
import { model as book } from '../book/model';
import { builder } from '../builder';
import { model as libraryEntry, type LibraryEntryRow } from '../library-entry/model';
import { isOwnerOrAdmin, parseCompoundId } from '../node-scope';
import { CONNECTION_LIMITS, rejectOversizePage } from '../pagination';
import { model as pendingFix } from '../pending-fix';
// `../progress/model`, not `../progress` — see book/model.ts's note on the
// same import for why an entity index must not be pulled in from a model file.
import { model as progress } from '../progress/model';
import { model as scanStatus, type ScanStatusShape } from '../scan-status/model';
import { model as series } from '../series/model';
import { model as suggestionGroup } from '../suggestion-group';
// `../user/model`, not `../user`: `user/index.ts` also side-effect-imports
// `user/mutation/*.ts`, so importing the index here (rather than the
// defining module) closes a require cycle — `user/model.ts` imports
// `../library/model` (this file) for `User.library`, and this file imports
// back for `Library.user`. Same rule every other entity-directory import in
// this schema follows; see `book-hash-collision-error/model.ts`'s identical
// note. (Task 8 review, I-2: this file, not `user/model.ts`, is the actual
// head of the six pre-existing cycles the review's static analysis found —
// `user/model.ts`'s own import was fixed in the same task for the same
// reason but did not itself close anything.)
import { model as user } from '../user/model';
import { decodeCursor, encodeCursor } from './entries-cursor';
import { libraryFilter } from './entries-filter';
import { searchSuggestionsFilter } from './search-suggestions-filter';

/** One connection edge — annotated explicitly so both branches of the ternary in `entries` below (`Book` rows, `Series` rows) unify on the union `LibraryEntryRow` rather than TypeScript inferring two incompatible edge types. */
type Edge = { cursor: string; node: LibraryEntryRow };

/**
 * `entries` and `progress` are declared below with a plain `t.field` over these
 * two refs, NOT with `t.connection` — the one reason being that `t.connection`
 * injects all four of Relay's `first`/`after`/`last`/`before` args and offers
 * no way to withhold any of them. Both fields wrap a forward-only cursor
 * (`services/library-page.ts`'s `listBooksPage`, `getUserProgressPage`: one
 * cursor plus a `take`, no keyset to walk backward from), so advertising
 * `last`/`before` and then throwing on them made the SDL promise a capability
 * the resolver refused.
 * Declaring the connection type here and the field by hand states the
 * forward-only shape in the schema itself, where a client generating from the
 * SDL can see it.
 *
 * Verified against `@pothos/plugin-relay@4.7.1` before choosing this route, so
 * a future reader doesn't re-litigate it:
 *  - `RelayPluginOptions`'s `beforeArgOptions`/`lastArgOptions` (etc.) are typed
 *    `Omit<InputObjectFieldOptions, 'required' | 'type'>` — they customize an
 *    argument, they cannot omit one. They are also builder-wide, so deprecating
 *    `last` through them would mislabel `Series.books`/`Validation.messages`,
 *    where backward pagination genuinely works.
 *  - `args` passed to `t.connection` cannot subtract either:
 *    `field-builder.ts`'s `connection` spreads `...this.arg.connectionArgs()`
 *    AFTER `...fieldOptions.args`, so the defaults always win — which is why
 *    `entries`' `filter` arg could only ever be additive.
 *  - `connectionArgs()` (`input-field-builder.ts`) returns all four
 *    unconditionally.
 *
 * This is not fighting the plugin: `t.connection` itself calls
 * `builder.connectionObject` for exactly this type. The `name` on each call is
 * explicit, and the edge name is passed too, to reproduce byte-for-byte what
 * `t.connection` derived (`${parentType}${Capitalize(fieldName)}Connection` and
 * that name + `Edge` — `connectionObject`'s OWN edge default is the different
 * `…EntriesEdge`, so omitting it would silently rename the type).
 *
 * Both resolvers already hand-build the whole `{ edges, pageInfo }` shape rather
 * than leaning on Pothos's connection helpers, so nothing about their bodies
 * changes.
 */
const entriesConnection = builder.connectionObject(
  { type: libraryEntry, name: 'LibraryEntriesConnection' },
  { name: 'LibraryEntriesConnectionEdge' }
);

const progressConnection = builder.connectionObject(
  { type: progress, name: 'LibraryProgressConnection' },
  { name: 'LibraryProgressConnectionEdge' }
);

/**
 * A Library is backed by an Owner, and only two resolvers can mint one:
 * Viewer.library (self, by construction) and User.library (ownerOf-gated).
 * Every field registered onto this ref therefore trusts its parent — ownership
 * is decided once, at the point the Owner is created, rather than per field.
 */
export const model = builder.objectRef<Owner>('Library');

// `builder.node(ref, options)` both implements `ref` and attaches the `Node`
// interface in a single call — it is not `ref.implement()` followed by a
// separate `builder.node()` registration. Calling `.implement()` first and
// then handing the already-implemented ref to `builder.node` conflicts with
// how the relay plugin's `node()` is documented and typed (see
// @pothos/plugin-relay's README, "Creating Nodes": `builder.node(User, { id,
// loadOne, fields })`), so the two steps are combined here.
//
// `Library` is 1:1 with a `User`, so its global id is the user id under a
// different type name. `loadOne` carries the exact same ownership rule as
// `User`'s `findUnique` (`isOwnerOrAdmin`) — without it `node(id:)` would be a
// second, ungated door onto the same object `User.library` already gates.
builder.node(model, {
  id: { resolve: (owner) => owner.userId },
  loadOne: (id, context) => {
    if (!isOwnerOrAdmin(context.viewer, id)) return null;
    return context.loadOwner(id);
  },
  fields: (t) => ({
    user: t.field({
      type: user,
      resolve: (owner, _args, context) =>
        context.prisma.user.findUniqueOrThrow({ where: { id: owner.userId } }),
    }),

    // `subjects` and `authors` are the two fields the spec assigns to
    // `library/model.ts` itself ("it holds only the fields that belong to no
    // other entity"). Both go through `services/book-catalog.ts` rather than
    // `context.prisma.book` directly: `getSubjects` is a raw `json_each` query
    // over the JSON-string `subjects` column that Prisma cannot express, and
    // `getAuthors` is a `groupBy` with the same empty-value filtering. Reading
    // them through that shared module is what keeps this path and OPDS's
    // (`routes/opds.ts` calls `getAuthors`) from disagreeing about what a
    // distinct subject or author is.
    //
    // Both take `owner` straight off the parent — ownership is decided once,
    // where the Owner is minted, and never re-derived here.
    subjects: t.field({
      type: ['String'],
      resolve: (owner, _args, context) => getSubjects(context.prisma, owner),
    }),
    authors: t.field({
      type: ['String'],
      resolve: (owner, _args, context) => getAuthors(context.prisma, owner),
    }),

    /**
     * `id` is the `Book` global ID — the same one-dialect bridging every
     * book mutation already uses (`node-scope.ts`'s `parseCompoundId` doc
     * comment), replacing the old raw-hash `String!` arg. `t.arg.globalID({
     * for: book })` rejects a wrong-type global id (e.g. a `Series` id) at
     * the arg layer, before this resolver ever runs — `validate.test.ts`'s
     * "rejects a wrong-type global id" test owns that assertion generically,
     * not duplicated here.
     *
     * DENIAL SHAPE: null, not an error — matching this field's pre-existing
     * "no such row" convention. The decoded gid's userId must MATCH this
     * Library's own owner; a mismatch is not a permissions failure but a
     * different-row situation, because book ids are content hashes shared
     * across tenants (`NO_MATCH_USER_ID`'s doc comment): a gid naming bob's
     * copy of the same-hash file, asked through alice's library, refers to a
     * DIFFERENT row than whatever alice's library holds under that same
     * local id. Returning alice's row for bob's gid (or vice versa) would be
     * a silent cross-tenant substitution, so a mismatch resolves exactly
     * like a book that doesn't exist. A malformed local id (decode failure)
     * resolves null for the same "nothing to look up" reasoning
     * `bookValidate`'s doc comment gives.
     *
     * SUPERSEDED IDS resolve to the row that supersedes them, via the
     * imported `resolveBookId` (`services/book-lineage.ts`). A book's local
     * id is its content hash, so
     * re-importing an edited EPUB mints a new one — `reimportBook`, and
     * every `applyEpubChanges` path (accept / undo / replace / regen) —
     * leaving the old id naming nothing. Without this, a bookmark, the back
     * button, a shared link or a second tab left on a pre-rotation id all
     * rendered "Book not found." for a book that plainly still exists, and a
     * RELOAD could not clear it: the same URL hits the same dead id. The
     * mapping already existed (`book_id_history`, written inside the same
     * transaction as the rename, and read here through the same
     * `resolveBookId` KOReader sync uses in `routes/kosync.ts`); this field
     * simply stopped ignoring it.
     *
     * A FALLBACK, not a prefix — the direct `findUnique` runs first and
     * returns on a hit, so a LIVE id costs exactly what it did before and
     * only an id that resolves to nothing pays for the lookup. That ordering
     * is safe rather than merely cheap: a hit under `[owner.userId, localId]`
     * is by construction the live row for that id, since the store refuses a
     * content-hash collision (`BookHashCollisionError`) instead of letting
     * two of a user's books share one id, so no live row can be sitting
     * under an id that history also maps somewhere else. On the miss path,
     * `resolveBookId` is two indexed lookups that return early —
     * `book_id_history` on its `@@id([userId, oldId])` primary key, then
     * `device_editions` on `@@index([userId, editionId])` — and it returns
     * its INPUT when neither matches, which the `currentId === parsed[1]`
     * check turns back into the null this field already answered with.
     *
     * The behaviour change is deliberate and is the point: a consumer
     * passing a superseded id now gets the current book instead of null. It
     * is scoped by `owner.userId`, the parent Library's own owner — never
     * the viewer's — so an admin traversal reads the target user's history
     * and no history row is ever reachable across a tenant boundary, the
     * same discipline the owner-mismatch guard above enforces.
     */
    book: t.prismaField({
      type: book,
      nullable: true,
      args: { id: t.arg.globalID({ required: true, for: book }) },
      resolve: async (query, owner, args, context) => {
        const parsed = parseCompoundId(args.id.id);
        if (parsed === null || parsed[0] !== owner.userId) return null;
        const live = await context.prisma.book.findUnique({
          ...query,
          where: { userId_id: { userId: owner.userId, id: parsed[1] } },
        });
        if (live !== null) return live;
        const currentId = await resolveBookId(context.prisma, owner.userId, parsed[1]);
        if (currentId === parsed[1]) return null;
        return context.prisma.book.findUnique({
          ...query,
          where: { userId_id: { userId: owner.userId, id: currentId } },
        });
      },
    }),

    // NOT `t.prismaField`/`queryFromInfo`-selected, deliberately: `edges.node`
    // is `LibraryEntry` (`library-entry/model.ts`), a union whose `resolveType`
    // discriminates `Book` vs `Series` on `'sortKey' in row` — a Pothos-computed
    // column selection that pruned `sortKey` off an under-requested query would
    // silently misclassify a `Series` row as a `Book`. `queryFromInfo` has no
    // existing usage anywhere in this codebase to pattern-match a safe union
    // path from, so this stays a deliberately deferred optimisation rather than
    // an oversight: `listBooksPage` (`services/library-page.ts`) already fetches
    // full, unselected rows once and returns them directly (task 8's fix for the
    // double read this field used to do), which is correct and provably
    // single-query per page (`entries.test.ts`'s "issues exactly one
    // prisma.book.findMany..." test) even without column-level selection.
    entries: t.field({
      type: entriesConnection,
      description:
        'Forward pagination only: this connection offers `first`/`after` and no ' +
        '`last`/`before` — the underlying cursor is forward-only.',
      // Only `first`/`after` — `last`/`before` are deliberately absent; see the
      // `entriesConnection` doc comment above for why the field is declared
      // this way rather than with `t.connection`. `required: false` is spelled
      // out because the builder sets `defaultInputFieldRequiredness: true`;
      // `connectionArgs()` sets the same flag on every arg it mints.
      args: {
        first: t.arg.int({ required: false }),
        after: t.arg.string({ required: false }),
        filter: t.arg({ type: libraryFilter, required: false }),
      },
      resolve: async (owner, args, context) => {
        // Reject before the clamp below ever runs — see `CONNECTION_LIMITS`'s
        // doc comment (pagination.ts) for where `100`/`20` come from.
        rejectOversizePage('Library.entries', args, CONNECTION_LIMITS.libraryEntries.maxSize);
        const cursor = decodeCursor(args.after);
        // Same default/floor REST applies to `take` (routes/ui.ts): default
        // 20, floor 1. The upper `Math.min` bound below is no longer the
        // operative ceiling (review M-1) — `rejectOversizePage` above already
        // rejects anything past `maxSize` before this line runs — but it's
        // kept as harmless defense-in-depth rather than removed, in case a
        // future edit ever reorders these two lines.
        const take = Math.min(
          Math.max(args.first ?? CONNECTION_LIMITS.libraryEntries.defaultSize, 1),
          CONNECTION_LIMITS.libraryEntries.maxSize
        );
        const filters: BookListFilters | undefined = args.filter
          ? {
              query: args.filter.query ?? undefined,
              author: args.filter.author ?? undefined,
              seriesName: args.filter.seriesName ?? undefined,
              status: args.filter.status ?? undefined,
              subjects: args.filter.subjects ?? undefined,
              entryType: args.filter.entryType ?? undefined,
            }
          : undefined;

        // The single read for this page — ordering, ids, AND the real
        // `Book`/`Series` rows all come from this one call. Before task 8,
        // this resolver re-fetched every row `listBooksPage` had already
        // read (by id/name, in a second `findMany` per type) because the
        // store handed back a `BookSummary[]` DTO instead of Pothos-visible
        // rows; `library-page.test.ts`'s "fetches every book exactly once"
        // test pins the fix at exactly one `prisma.book.findMany` call per
        // page, however many series share it.
        const page = await listBooksPage(context.prisma, owner, cursor, take, filters);

        // `items` is already the interleaved series/standalone order
        // `listBooksPage` computed, each entry carrying the real row it was
        // ordered by — mapping over it only reshapes that ordering into
        // edges, never reimplementing it or re-fetching anything.
        const edges: Edge[] = page.items.map(
          (item): Edge =>
            item.type === 'standalone'
              ? {
                  cursor: encodeCursor({ k: item.row.title, t: 'b', id: item.row.id }),
                  node: item.row,
                }
              : {
                  cursor: encodeCursor({ k: item.row.sortKey, t: 's', id: item.row.id }),
                  node: item.row,
                }
        );

        return {
          edges,
          pageInfo: {
            hasNextPage: page.nextCursor !== null,
            // Forward-only pagination: having resumed from a cursor is exactly
            // what "there is content before this page" means here.
            hasPreviousPage: cursor !== null,
            startCursor: edges[0]?.cursor ?? null,
            // The store's own cursor, not a recomputed one — see decodeCursor's
            // doc comment for why this is the one place parity with REST must
            // be exact rather than merely equivalent.
            endCursor: page.nextCursor,
          },
        };
      },
    }),

    searchSuggestions: t.field({
      type: [suggestionGroup],
      args: {
        query: t.arg.string({ required: true }),
        filter: t.arg({ type: searchSuggestionsFilter, required: false }),
      },
      // Blank/whitespace `query` is not special-cased here — it's handled once,
      // inside `getSearchSuggestions` itself (`normalizeForSearch` short-circuits
      // to `{ groups: [] }`). Duplicating that check here would risk drifting
      // from the store's own definition of "blank".
      resolve: async (owner, args, context) => {
        const response = await context.stores.book.getSearchSuggestions(owner, {
          q: args.query,
          filter: {
            author: args.filter?.author ?? undefined,
            seriesName: args.filter?.seriesName ?? undefined,
            activeSubjects: args.filter?.activeSubjects ?? undefined,
          },
        });
        // A `book`-typed group's items carry the book's own content-hash id
        // as `value` (`suggestion/model.ts`'s `SuggestionRow` doc comment) —
        // `userId` is stitched on here, from this resolver's own `owner`,
        // so `Suggestion.book` can resolve it without re-deriving an owner
        // from `context.viewer`. Every other group type's `value` isn't a
        // book id, so its items are returned untouched (`userId` stays
        // `undefined`, and `Suggestion.book` resolves null for them).
        return response.groups.map((group) =>
          group.type === 'book'
            ? { ...group, items: group.items.map((item) => ({ ...item, userId: owner.userId })) }
            : group
        );
      },
    }),

    // Deliberately a plain list, not a connection: bounded by the user's shelf
    // count, and the library UI renders it whole — `entries` already serves
    // the paginated case. See the cleanup spec, §"5. Connections for growable
    // lists".
    series: t.prismaField({
      type: [series],
      resolve: (query, owner, _args, context) =>
        context.prisma.series.findMany({
          ...query,
          where: { userId: owner.userId },
          orderBy: { sortKey: 'asc' },
        }),
    }),

    seriesByName: t.prismaField({
      type: series,
      nullable: true,
      args: { name: t.arg.string({ required: true }) },
      resolve: (query, owner, args, context) =>
        context.prisma.series.findUnique({
          ...query,
          where: { userId_name: { userId: owner.userId, name: args.name } },
        }),
    }),

    seriesNextIndex: t.int({
      args: { name: t.arg.string({ required: true }) },
      resolve: (owner, args, context) => getSeriesNextIndex(context.prisma, owner, args.name),
    }),

    /**
     * A connection, not the plain list this started as.
     *
     * WHY PAGINATED: REST already was. `GET /api/my/progress` (`routes/ui.ts`,
     * that endpoint since removed) and `GET /api/users/:username/progress`
     * (`routes/users.ts`, removed in Phase 0 along with the rest of that
     * router) both went through `getUserProgressPage` with a keyset
     * cursor and a take clamped to 1..100 — this field reuses that exact page
     * shape. A progress list grows with every book a user opens on any device
     * and is never pruned, so it is genuinely unbounded — an unpaginated
     * field would serve ever-larger responses forever rather than failing,
     * the same silent growth REST's pagination existed to prevent.
     *
     * WHY A CONNECTION RATHER THAN A CLAMP: a bare `first:` clamp caps the damage
     * but throws away the ability to read past the first page at all. The spec
     * exempts "series lists, subjects, authors, users, devices and validation
     * messages" from connections because they are small and unpaginated *today* —
     * progress is in neither category. `Library.entries` is the existing
     * connection precedent and this follows its shape exactly: delegate the
     * keyset to `getUserProgressPage`, pass its own `nextCursor` through
     * untouched as `endCursor`, and reject backward pagination loudly.
     *
     * CURSOR PARITY IS BY CONSTRUCTION, not by two formulas agreeing:
     * `decodeProgressCursor` is the very function REST's handlers call, and
     * `endCursor` is the string `getUserProgressPage` minted, forwarded
     * unmodified. Only the per-edge cursors are encoded here, through
     * `encodeProgressCursor`, which lives beside the decoder it must round-trip
     * with.
     *
     * TWO QUERIES, DELIBERATELY: `getUserProgressPage` returns its `Progress`
     * DTO (`device_id`, no `userId`), while this field's `Progress` type is a
     * `prismaObject` pinned to the real row — and `currentChapter` needs the
     * `userId` the DTO drops. So `getUserProgressPage` decides the window and
     * the cursor, and a second query fetches the rows it named. `Library.entries`
     * looks like the same shape (a store-owned cursor deciding a page) but is
     * NOT this same two-query split: `services/library-page.ts`'s
     * `listBooksPage` returns the real `Book`/`Series` rows themselves, not a
     * DTO missing a column, so that field reads them once and is done (task 8
     * collapsed what used to be a second, redundant `findMany` there). The
     * difference is exactly the DTO gap this paragraph describes — `progress`
     * has one, `entries` no longer does.
     */
    progress: t.field({
      type: progressConnection,
      description:
        'Forward pagination only: this connection offers `first`/`after` and no ' +
        '`last`/`before` — the underlying cursor is forward-only.',
      // Forward args only, hand-declared — same reasoning as `entries` above.
      args: {
        first: t.arg.int({ required: false }),
        after: t.arg.string({ required: false }),
      },
      resolve: async (owner, args, context) => {
        // Reject before `clampProgressTake` ever silently clamps — its bounds
        // (50 default / 100 max) are restated in `CONNECTION_LIMITS.libraryProgress`
        // (pagination.ts) rather than imported from it, since this number's
        // real source of truth is `utils/progress-pagination.ts`, unchanged by
        // this migration; `CONNECTION_LIMITS`'s doc comment records that origin.
        rejectOversizePage('Library.progress', args, CONNECTION_LIMITS.libraryProgress.maxSize);
        const cursor = decodeProgressCursor(args.after);
        // Same default (50) REST applies via `parseProgressTake`, now sharing
        // that function's default rather than restating it. Its own upper
        // clamp is no longer the operative ceiling (review M-1) —
        // `rejectOversizePage` above already rejects anything past `maxSize`
        // before this line runs — kept as harmless defense-in-depth.
        const take = clampProgressTake(args.first);

        const page = await getUserProgressPage(context.prisma, owner.userId, cursor, take);
        const documents = page.items.map((item) => item.document);

        const rows =
          documents.length > 0
            ? await context.prisma.progress.findMany({
                where: { userId: owner.userId, document: { in: documents } },
              })
            : [];
        const byDocument = new Map(rows.map((row) => [row.document, row]));

        // `page.items` is already in `getUserProgressPage`'s `timestamp desc,
        // document asc` order; this only re-associates rows with it, skipping
        // any row that vanished between the two reads rather than resolving
        // `undefined`.
        const edges = page.items.flatMap((item) => {
          const row = byDocument.get(item.document);
          return row
            ? [
                {
                  cursor: encodeProgressCursor({
                    timestamp: row.timestamp,
                    document: row.document,
                  }),
                  node: row,
                },
              ]
            : [];
        });

        return {
          edges,
          pageInfo: {
            hasNextPage: page.nextCursor !== null,
            // Forward-only pagination: having resumed from a cursor is exactly
            // what "there is content before this page" means here.
            hasPreviousPage: cursor !== null,
            startCursor: edges[0]?.cursor ?? null,
            // `getUserProgressPage`'s own cursor, forwarded rather than recomputed.
            endCursor: page.nextCursor,
          },
        };
      },
    }),

    /**
     * Resolves `PendingFix` rows directly, rather than through a DTO — the
     * summary type a DTO existed for (`PendingFixSummary`) is deleted; see
     * the cleanup spec, §"3. One PendingFix type".
     *
     * DELIBERATELY FILTERS, NEVER DELETES: not-live rows are excluded from
     * the list this returns but left in the database, because a read resolver
     * that mutates is the thing the read model declines to do anywhere in
     * this schema. REST's `BookStore.getPendingFixes` used to delete them as
     * a side effect of reading; it is gone with the rest of the REST library
     * surface, so nothing prunes an expired row today — a resolved or
     * TTL-expired row simply stays invisible to every reader (this field and
     * `Book.pendingFix` apply the identical `isLivePendingFix` predicate)
     * until `deletePendingFix` removes it on the next resolve/dismiss of that
     * book, or a future sweep collects it. Client-visible behaviour is
     * unaffected; only the row's physical lifetime is.
     */
    pendingFixes: t.prismaField({
      type: [pendingFix],
      resolve: async (query, owner, _args, context) => {
        const rows = await context.prisma.pendingFix.findMany({
          ...query,
          where: { userId: owner.userId },
        });
        const now = Date.now();
        return rows.filter((row) =>
          isLivePendingFix(parsePendingFixState(row.state), row.updatedAt, now)
        );
      },
    }),

    /**
     * The reconnect/fallback read for a running or just-finished scan (spec
     * §"Scan progress": "`library.scanStatus` stays as a query returning the
     * same type... the fallback if Houdini's SSE support proves awkward in
     * spec 2"). `nullable: true` because no scan has necessarily ever run for
     * this library — `ScanJobStore.get` returns `undefined` in that case,
     * unlike `scanProgress` (`subscription/scan-progress.ts`), whose `ScanStatus!`
     * return type has no such "nothing yet" state to express (a subscription
     * that has never seen an event simply hasn't yielded anything).
     */
    scanStatus: t.field({
      type: scanStatus,
      nullable: true,
      resolve: (owner, _args, context): ScanStatusShape | null => {
        const job = context.stores.scanJob.get(owner.userId);
        return job === undefined ? null : { owner, job };
      },
    }),
  }),
});
