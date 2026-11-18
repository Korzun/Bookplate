import { builder } from '../builder';
import { CONNECTION_LIMITS, rejectOversizePage } from '../pagination';
import { findUnique } from './node-loader';

export const model = builder.prismaNode('Collection', {
  id: { field: 'id' },
  findUnique,
  nullable: true,
  fields: (t) => ({
    name: t.exposeString('name'),
    bookCount: t.relationCount('books'),
    /**
     * Memberships in position order (nulls last), then title, then book id.
     * Bounded exactly like `Series.books`; the reject lives in `query` for
     * the reason documented there.
     */
    books: t.relatedConnection('books', {
      cursor: 'userId_bookId_collectionId',
      maxSize: CONNECTION_LIMITS.collectionBooks.maxSize,
      defaultSize: CONNECTION_LIMITS.collectionBooks.defaultSize,
      query: (args) => {
        rejectOversizePage('Collection.books', args, CONNECTION_LIMITS.collectionBooks.maxSize);
        return {
          orderBy: [
            { position: { sort: 'asc', nulls: 'last' } },
            { book: { title: 'asc' } },
            { bookId: 'asc' },
          ],
        };
      },
    }),
  }),
});
