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
    /**
     * A connection, not the plain list this started as — see the cleanup
     * spec, §"5. Connections for growable lists". Backward pagination
     * (`last`/`before`) genuinely works here, unlike `Library.entries` and
     * `Library.progress`, which reject it (see `rejectBackwardPagination`'s
     * doc comment in `pagination.ts`: those wrap a forward-only store
     * cursor). `t.relatedConnection` paginates a real Prisma relation and
     * supports `last`/`before` natively — native support wins.
     */
    books: t.relatedConnection('books', {
      cursor: 'userId_id',
      query: { orderBy: { seriesIndex: 'asc' } },
    }),
  }),
});
