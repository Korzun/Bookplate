import { parseStringArray } from '../../derive';
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
