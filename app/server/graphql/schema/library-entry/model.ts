import type { Book as BookRow, Series as SeriesRow } from '@prisma/client';

// `../book/model`, not `../book`: `book/index.ts` now also side-effect-imports
// `book/mutation/*.ts` (task 2). `book/mutation/delete.ts` reaches `Library`
// (for `BookDeletePayload.library`) — and `Library` reaches `LibraryEntry`
// (this file) for its `entries` connection. (Corrected after review — task-2
// review Minor-4: this was previously misattributed to
// `BookUpdateMetadataPayload`/`update-metadata.ts`, which never imports
// `library/model` at all; the real edge is `delete.ts` only.) Importing the
// defining module rather than the index keeps that reference from dragging
// the whole `book` entity's mutation registrations into the cycle. See
// `book/model.ts`'s note on the identical `progress` situation.
import * as book from '../book/model';
import { builder } from '../builder';
import * as series from '../series/model';

/**
 * The real Prisma row shapes `Library.entries` (library/model.ts)
 * resolves into — never a synthetic wrapper. The fetch itself lives in
 * `services/library-page.ts`'s `listBooksPage` (task 8 moved it there, out
 * of `library/model.ts`'s own resolver, to collapse a double read into one),
 * but the invariant is unchanged: its `prisma.book.findMany`/`series.findMany`
 * calls carry no `select`, so every column either table has — including
 * `sortKey`, which `isSeriesRow` below relies on — is guaranteed present on
 * whatever `Library.entries` hands back.
 */
export type LibraryEntryRow = BookRow | SeriesRow;

/**
 * `Series` rows always carry `sortKey` (the column the library list sorts
 * series by); `Book` rows never do — they sort by `title` instead (see
 * `prisma/schema.prisma`'s `Book`/`Series` models). That is a permanent,
 * structural difference between the two tables, not an incidental one, so
 * `resolveType` discriminates on it directly rather than on a synthetic
 * `kind` tag the resolver would have to remember to attach — there is nothing
 * for the two to drift apart on, because the property either genuinely exists
 * on the row or it doesn't.
 */
const isSeriesRow = (row: LibraryEntryRow): row is SeriesRow => 'sortKey' in row;

export const model = builder.unionType('LibraryEntry', {
  types: [book.model, series.model],
  resolveType: (row) => (isSeriesRow(row) ? 'Series' : 'Book'),
});
