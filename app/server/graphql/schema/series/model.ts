import { parseStringArray } from '../../derive';
import * as book from '../book';
import { builder } from '../builder';
import { findUnique } from './node-loader';

export const model = builder.prismaNode('Series', {
  id: { field: 'id' },
  findUnique,
  nullable: true,
  fields: (t) => ({
    name: t.exposeString('name'),
    author: t.exposeString('author'),
    publisher: t.exposeString('publisher'),
    bookCount: t.exposeInt('bookCount'),
    totalPages: t.exposeInt('totalPages'),
    totalSize: t.exposeInt('totalSize'),
    subjects: t.field({ type: ['String'], resolve: (series) => parseStringArray(series.subjects) }),
    books: t.relation('books', {
      query: { orderBy: { seriesIndex: 'asc' } },
    }),
  }),
});

// `Book.series` is the relation, not the denormalized `series` string column —
// that column stays in the database for OPDS and the import pipeline.
// `t.relation` (a prisma-select-aware field) is only available through
// `prismaObjectField`/the `fields` callback of `prismaNode` itself, not through
// the plugin-agnostic `builder.objectField` `book/query/get.ts` uses elsewhere.
builder.prismaObjectField(book.model, 'series', (t) => t.relation('seriesRel', { nullable: true }));
