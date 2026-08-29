import { epochToDate } from '../../derive';
// `../book/model`, not `../book`: `book/index.ts` also side-effect-imports
// `book/mutation/*.ts`, so importing the defining module rather than the
// index keeps this from dragging that whole surface into the require graph —
// same rule library/model.ts's own note documents. This IS a back-edge into
// a cycle (`book/model.ts` imports `../linked-document`, the index, for
// `Book.lineage`'s field type), but every reference to `book` below is
// inside a `fields:`/`resolve` closure Pothos only calls once the whole
// module graph has finished loading, so the live runtime binding is always
// populated by the time it's read.
import { model as book } from '../book/model';
import { builder } from '../builder';
import { model as lineageType } from '../lineage-type';

type LineageTypeValue = 'edit' | 'merge';

/**
 * One id transition a book has been through — either an organic re-import
 * (`type: 'edit'`, written by `reimportBook` when re-parsing an edited EPUB
 * changes its content hash) or a manual KOReader document merge (`type:
 * 'merge'`, written by `linkDocument`). Mirrors one entry of REST's `GET
 * /api/books/:id/lineage` response (`routes/ui.ts`), minus the `currentId`
 * that response also carries at the top level — every entry's `newId` chains
 * to the next, and the last one's `newId` is the book's own (current) id, so
 * nothing here is lost by dropping it.
 *
 * `userId` is internal only — not exposed as an SDL field. `Book.lineage`'s
 * resolver (`book/model.ts`) stitches it onto every entry it builds so
 * `oldBook`/`newBook` below have an owner to resolve under without a second
 * `context.loadOwner` round trip; a raw `getBookLineage` entry has no
 * `userId` of its own (`BookIdHistory` doesn't carry the book's owner beyond
 * the query it was already scoped by).
 *
 * `objectRef(...)` and `.implement(...)` are DELIBERATELY two statements,
 * not one chained expression (unlike this file's own pre-task-2 shape, and
 * most other `objectRef` types in this schema): `book/model.ts`'s `fields`
 * callback references this ref's TYPE (via `type: [linkedDocument]` on
 * `Book.lineage`), and `fields` below references `book`'s type right back —
 * a genuine mutual type dependency, not just a mutual runtime import. With
 * the two calls chained, TypeScript must resolve `.implement()`'s own field
 * types to know this ref's exported type, which needs `book`'s type, which
 * needs this ref's type — infinite regress, surfaced as `book/model.ts`'s
 * `model` silently degrading to `any` (TS7022) and cascading Prisma-client
 * type errors through every other file that reads `type: book` (confirmed
 * empirically: chaining these two calls reintroduces exactly that failure).
 * Splitting them means this ref's exported type is just `ObjectRef<...>` —
 * fixed by the explicit generic below, never dependent on `.implement()`'s
 * fields — so `book/model.ts` has a concrete, non-circular type to resolve
 * `linkedDocument` against. Pothos's own docs recommend this split
 * specifically for circular-reference type situations.
 */
export const model = builder.objectRef<{
  oldId: string;
  newId: string;
  timestamp: number;
  type: string;
  userId: string;
}>('LinkedDocument');

model.implement({
  fields: (t) => ({
    oldId: t.exposeString('oldId', {
      description: 'Raw content-hash for display; resolve `oldBook` to navigate.',
    }),
    newId: t.exposeString('newId', {
      description: 'Raw content-hash for display; resolve `newBook` to navigate.',
    }),
    type: t.field({
      type: lineageType,
      resolve: (entry) => entry.type as LineageTypeValue,
    }),
    timestamp: t.field({ type: 'DateTime', resolve: (entry) => epochToDate(entry.timestamp) }),
    // Nullable: lineage can reference a book that no longer exists (deleted,
    // or — for `oldId` — never re-imported into a live row at all). A
    // resolved edge uses the parent book's own owner (`entry.userId`), the
    // same owner-scoping every other tenant-owned lookup in this schema
    // uses, never re-derived from `context.viewer`.
    //
    // `t.field` + `context.loadBookByDocument`, NOT `t.prismaField`. These two
    // resolve once PER LINEAGE ENTRY, and entries hang off `Book.lineage`,
    // which hangs off `Library.entries` — so the multiplier is books x entries
    // x 2. Measured on a page of 8 books with 2 entries each: 32
    // `book.findUnique` calls for these two fields alone, now batched into the
    // loader's single `findMany`.
    //
    // The `query` merge given up by leaving `t.prismaField` costs nothing on
    // that path: `Library.entries` builds its own query, so Pothos never plans
    // it and there is no merge to lose (`graphql/loaders/pair-loader.ts`).
    // `loadBookByDocument` is the right loader rather than a new one — its key
    // IS `(userId, book id)`, the identity these two fields rely on. It is
    // named for `Progress.document`, its original consumer; that field is a
    // `t.relation` now (`Library.progress` became plugin-planned, these two did
    // not), so THESE are the loader's only consumers and its doc comment is
    // written for them.
    oldBook: t.field({
      type: book,
      nullable: true,
      resolve: (entry, _args, context) => context.loadBookByDocument(entry.userId, entry.oldId),
    }),
    newBook: t.field({
      type: book,
      nullable: true,
      resolve: (entry, _args, context) => context.loadBookByDocument(entry.userId, entry.newId),
    }),
  }),
});
