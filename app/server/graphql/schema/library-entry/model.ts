import type { Book as BookRow, Series as SeriesRow } from '@prisma/client';

import * as book from '../book';
import { builder } from '../builder';
import * as series from '../series';

/**
 * The real Prisma row shapes `Library.entries` (book/query/get-all.ts)
 * resolves into — never a synthetic wrapper. `book/query/get-all.ts` always
 * fetches full, unselected `book`/`series` rows (its `context.prisma.book
 * .findMany` / `series.findMany` calls carry no `select`), so every column
 * either table has — including `sortKey`, which `isSeriesRow` below relies on
 * — is guaranteed present on whatever that resolver hands back.
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
