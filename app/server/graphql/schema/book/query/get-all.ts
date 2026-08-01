import type { BookListFilters, PageCursor } from '../../../../types';
import { builder } from '../../builder';
import { model as library } from '../../library';
import { libraryEntry, type LibraryEntryRow } from '../../library-entry';
import { rejectBackwardPagination } from '../../pagination';

/** One connection edge — annotated explicitly so both branches of the `flatMap` below (`Book` rows, `Series` rows) unify on the union `LibraryEntryRow` rather than TypeScript inferring two incompatible edge-array types. */
type Edge = { cursor: string; node: LibraryEntryRow };

/**
 * Runtime guard for a cursor decoded off the wire. `PageCursor` itself is
 * just a type — nothing stops `after` from being attacker- or
 * client-supplied garbage that happens to parse as JSON, so every field is
 * checked before the value is trusted as a `PageCursor`.
 */
const isPageCursor = (value: unknown): value is PageCursor =>
  typeof value === 'object' &&
  value !== null &&
  typeof (value as { k?: unknown }).k === 'string' &&
  ((value as { t?: unknown }).t === 's' || (value as { t?: unknown }).t === 'b') &&
  typeof (value as { id?: unknown }).id === 'string';

/**
 * Decodes `after` exactly the way `routes/ui.ts`'s `GET /api/books` decodes
 * its `cursor` query param — base64 JSON, malformed input degrading to `null`
 * (start of the list) rather than an error — so a cursor minted by one API
 * resumes at the same place on the other. The one addition over REST's `as
 * PageCursor` cast is the shape check above: REST hands a JSON-parsed-but-
 * unvalidated value straight to `listBooksPage`, this validates it first.
 * That only changes behaviour for a malformed cursor (falls back to `null`
 * either way in effect, since a shapeless cursor can't match any WHERE
 * clause), never for a well-formed one, so pagination parity is unaffected.
 */
const decodeCursor = (after: string | null | undefined): PageCursor | null => {
  if (typeof after !== 'string' || after === '') return null;
  let parsed: unknown;
  try {
    parsed = JSON.parse(Buffer.from(after, 'base64').toString('utf-8'));
  } catch {
    return null;
  }
  return isPageCursor(parsed) ? parsed : null;
};

/** Mirrors `nextCursor`'s own encoding in `BookStore.listBooksPage` exactly, so a cursor this resolver mints for an interior edge is interchangeable with one the store mints for `endCursor`. */
const encodeCursor = (cursor: PageCursor): string =>
  Buffer.from(JSON.stringify(cursor)).toString('base64');

const libraryEntryStatus = builder.enumType('LibraryEntryStatus', {
  values: {
    NOT_STARTED: { value: 'not-started' },
    IN_PROGRESS: { value: 'in-progress' },
    COMPLETED: { value: 'completed' },
  },
});

const libraryEntryType = builder.enumType('LibraryEntryType', {
  values: {
    SERIES: { value: 'series' },
    STANDALONE: { value: 'standalone' },
  },
});

/** Mirrors `BookListFilters` (types.ts) field-for-field — see that type's doc comment before changing either. */
const libraryFilter = builder.inputType('LibraryFilter', {
  fields: (t) => ({
    query: t.string({ required: false }),
    author: t.string({ required: false }),
    seriesName: t.string({ required: false }),
    status: t.field({ type: libraryEntryStatus, required: false }),
    subjects: t.stringList({ required: false }),
    entryType: t.field({ type: libraryEntryType, required: false }),
  }),
});

builder.objectField(library, 'entries', (t) =>
  t.connection({
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
  })
);
