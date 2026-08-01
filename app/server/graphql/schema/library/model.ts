import type { BookListFilters, Owner } from '../../../types';
import {
  clampProgressTake,
  decodeProgressCursor,
  encodeProgressCursor,
} from '../../../utils/progress-pagination';
import { isLivePendingFix, parsePendingFixState } from '../../derive';
import { model as book } from '../book';
import { builder } from '../builder';
import { model as libraryEntry, type LibraryEntryRow } from '../library-entry';
import { isOwnerOrAdmin } from '../node-scope';
import { rejectBackwardPagination } from '../pagination';
import { model as pendingFix } from '../pending-fix';
import { model as progress } from '../progress';
import { model as series } from '../series';
import { model as suggestionGroup } from '../suggestion-group';
import * as user from '../user';
import { decodeCursor, encodeCursor } from './entries-cursor';
import { libraryFilter } from './entries-filter';
import { searchSuggestionsFilter } from './search-suggestions-filter';

/** One connection edge — annotated explicitly so both branches of the `flatMap` in `entries` below (`Book` rows, `Series` rows) unify on the union `LibraryEntryRow` rather than TypeScript inferring two incompatible edge-array types. */
type Edge = { cursor: string; node: LibraryEntryRow };

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
      type: user.model,
      resolve: (owner, _args, context) =>
        context.prisma.user.findUniqueOrThrow({ where: { id: owner.userId } }),
    }),

    // `subjects` and `authors` are the two fields the spec assigns to
    // `library/model.ts` itself ("it holds only the fields that belong to no
    // other entity"). Both go through `BookStore` rather than
    // `context.prisma.book` directly: `getSubjects` is a raw `json_each` query
    // over the JSON-string `subjects` column that Prisma cannot express, and
    // `getAuthors` is a `groupBy` with the same empty-value filtering. Reading
    // them through the store is what keeps this path and OPDS's
    // (`routes/opds.ts` calls `getAuthors`) from disagreeing about what a
    // distinct subject or author is.
    //
    // Both take `owner` straight off the parent — ownership is decided once,
    // where the Owner is minted, and never re-derived here.
    subjects: t.field({
      type: ['String'],
      resolve: (owner, _args, context) => context.stores.book.getSubjects(owner),
    }),
    authors: t.field({
      type: ['String'],
      resolve: (owner, _args, context) => context.stores.book.getAuthors(owner),
    }),

    book: t.prismaField({
      type: book,
      nullable: true,
      args: { id: t.arg.string({ required: true }) },
      resolve: (query, owner, args, context) =>
        context.prisma.book.findUnique({
          ...query,
          where: { userId_id: { userId: owner.userId, id: args.id } },
        }),
    }),

    entries: t.connection({
      type: libraryEntry,
      args: {
        filter: t.arg({ type: libraryFilter, required: false }),
      },
      resolve: async (owner, args, context) => {
        rejectBackwardPagination('Library.entries', args);
        const cursor = decodeCursor(args.after);
        // Same clamp REST applies to `take` (routes/ui.ts): default 20, 1..100.
        const take = Math.min(Math.max(args.first ?? 20, 1), 100);
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

        const page = await context.stores.book.listBooksPage(owner, cursor, take, filters);

        const bookIds = page.items.flatMap((item) =>
          item.type === 'standalone' ? [item.bookId] : []
        );
        const seriesNames = page.items.flatMap((item) =>
          item.type === 'series' ? [item.seriesName] : []
        );

        const [bookRows, seriesRows] = await Promise.all([
          bookIds.length > 0
            ? context.prisma.book.findMany({ where: { userId: owner.userId, id: { in: bookIds } } })
            : Promise.resolve([]),
          seriesNames.length > 0
            ? context.prisma.series.findMany({
                where: { userId: owner.userId, name: { in: seriesNames } },
              })
            : Promise.resolve([]),
        ]);

        const bookById = new Map(bookRows.map((row) => [row.id, row]));
        const seriesByName = new Map(seriesRows.map((row) => [row.name, row]));

        // `items` is already the interleaved series/standalone order
        // `listBooksPage` computed — flatMap over it (skipping a row that
        // vanished between the store's read and this one, rather than
        // resolving `undefined`) is only ever reordering data the store
        // already ordered, not reimplementing that ordering.
        const edges: Edge[] = page.items.flatMap((item): Edge[] => {
          if (item.type === 'standalone') {
            const row = bookById.get(item.bookId);
            return row
              ? [{ cursor: encodeCursor({ k: row.title, t: 'b', id: row.id }), node: row }]
              : [];
          }
          const row = seriesByName.get(item.seriesName);
          return row
            ? [{ cursor: encodeCursor({ k: row.sortKey, t: 's', id: row.id }), node: row }]
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
        return response.groups;
      },
    }),

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

    seriesNextIndex: t.float({
      args: { name: t.arg.string({ required: true }) },
      resolve: (owner, args, context) => context.stores.book.getSeriesNextIndex(owner, args.name),
    }),

    /**
     * A connection, not the plain list this started as.
     *
     * WHY PAGINATED: REST already is. `GET /api/my/progress` (`routes/ui.ts`) and
     * `GET /api/users/:username/progress` (`routes/users.ts`) both go through
     * `UserStore.getUserProgressPage` with a keyset cursor and a take clamped to
     * 1..100. A progress list grows with every book a user opens on any device and
     * is never pruned, so it is genuinely unbounded — an unpaginated field would
     * mean the capability REST has today vanishes when the REST routes are
     * deleted, and it would do so silently, by serving ever-larger responses
     * rather than by failing.
     *
     * WHY A CONNECTION RATHER THAN A CLAMP: a bare `first:` clamp caps the damage
     * but throws away the ability to read past the first page at all. The spec
     * exempts "series lists, subjects, authors, users, devices and validation
     * messages" from connections because they are small and unpaginated *today* —
     * progress is in neither category. `Library.entries` is the existing
     * connection precedent and this follows its shape exactly: delegate the
     * keyset to the store, pass the store's own `nextCursor` through untouched as
     * `endCursor`, and reject backward pagination loudly.
     *
     * CURSOR PARITY IS BY CONSTRUCTION, not by two formulas agreeing:
     * `decodeProgressCursor` is the very function REST's handlers call, and
     * `endCursor` is the string `getUserProgressPage` minted, forwarded
     * unmodified. Only the per-edge cursors are encoded here, through
     * `encodeProgressCursor`, which lives beside the decoder it must round-trip
     * with.
     *
     * TWO QUERIES, DELIBERATELY: the store returns its `Progress` DTO
     * (`device_id`, no `userId`), while this field's `Progress` type is a
     * `prismaObject` pinned to the real row — and `currentChapter` needs the
     * `userId` the DTO drops. So the store decides the window and the cursor, and
     * a second query fetches the rows it named. Same division of labour as
     * `Library.entries`, which asks `listBooksPage` for the page and then reads
     * the `Book`/`Series` rows itself.
     */
    progress: t.connection({
      type: progress,
      resolve: async (owner, args, context) => {
        rejectBackwardPagination('Library.progress', args);
        const cursor = decodeProgressCursor(args.after);
        // Same clamp and same default (50) REST applies via `parseProgressTake`,
        // now sharing that function's bounds rather than restating them.
        const take = clampProgressTake(args.first);

        const page = await context.stores.user.getUserProgressPage(owner.userId, cursor, take);
        const documents = page.items.map((item) => item.document);

        const rows =
          documents.length > 0
            ? await context.prisma.progress.findMany({
                where: { userId: owner.userId, document: { in: documents } },
              })
            : [];
        const byDocument = new Map(rows.map((row) => [row.document, row]));

        // `page.items` is already in the store's `timestamp desc, document asc`
        // order; this only re-associates rows with it, skipping any row that
        // vanished between the two reads rather than resolving `undefined`.
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
            // The store's own cursor, forwarded rather than recomputed.
            endCursor: page.nextCursor,
          },
        };
      },
    }),

    /**
     * Resolves `PendingFix` rows directly, rather than `context.stores.book
     * .getPendingFixes`'s DTO — the summary type that DTO existed for
     * (`PendingFixSummary`) is deleted; see the cleanup spec, §"3. One
     * PendingFix type".
     *
     * DELIBERATELY FILTERS, NEVER DELETES: `getPendingFixes` deletes expired
     * rows as a side effect of reading (`book-store.ts:685-717`) — REST keeps
     * that behaviour untouched (this migration does not modify `routes/` or
     * `book-store.ts`). A read resolver that mutates was the thing the read
     * model declined to replicate elsewhere in this schema, and this field
     * keeps that stance: it excludes not-live rows from the list it returns,
     * but leaves them in the database for REST (or a future phase-3 sweep) to
     * clean up. The net effect for a client is the same list either way — a
     * not-live row is invisible here whether or not REST has gotten to it
     * yet.
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
  }),
});
