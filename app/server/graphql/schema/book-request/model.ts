import type { Prisma } from '@prisma/client';

import type { BookRequestStatus } from '../../../services/book-request';
import { epochToDate } from '../../derive';
import { model as bookRequestStatus } from '../book-request-status/model';
import { builder } from '../builder';
import { ownerScopedFindUnique } from '../node-scope';

/**
 * A reader's wish for a book that is not in Bookplate yet.
 *
 * A `prismaNode` keyed on the COMPOUND id (`@@id([userId, id])`), not on a
 * plain `id`, and the difference is what makes the guard possible:
 * `ownerScopedFindUnique` decides ownership WITHOUT reading the row, by taking
 * the `userId` out of the global id itself and substituting `NO_MATCH_USER_ID`
 * when the viewer is neither the owner nor an admin. A plain `String @id`
 * would carry no owner in the global id, so the guard would have to read the
 * row first — and `node-scope.test.ts` enforces generically that every
 * tenant-owned node type routes its `findUnique` through this helper.
 *
 * `nullable: true` for the same reason every other guarded node here is: a
 * denied read is a null node, not an error.
 */
export const model = builder.prismaNode('BookRequest', {
  id: { field: 'userId_id' },
  findUnique: ownerScopedFindUnique((userId: string, id: string) => ({
    userId_id: { userId, id },
  })),
  nullable: true,
  fields: (t) => ({
    title: t.exposeString('title'),
    author: t.exposeString('author'),
    note: t.exposeString('note'),
    declineReason: t.exposeString('declineReason'),
    status: t.field({
      type: bookRequestStatus,
      resolve: (request) => request.status as BookRequestStatus,
    }),
    createdAt: t.field({
      type: 'DateTime',
      resolve: (request) => epochToDate(request.createdAt),
    }),
    resolvedAt: t.field({
      type: 'DateTime',
      nullable: true,
      resolve: (request) => (request.resolvedAt === null ? null : epochToDate(request.resolvedAt)),
    }),

    /**
     * The book this request was fulfilled with, once it has been. Nullable in
     * two distinct cases the client renders identically: the request is not
     * fulfilled yet, and the book it was fulfilled with has since been deleted
     * (`onDelete: SetNull`, `prisma/schema.prisma`). "Added to your library"
     * without a link is the correct rendering of the second, not an error.
     */
    book: t.relation('book', { nullable: true }),
  }),
});

/**
 * Translates `User.bookRequests`'s parsed cursor into the keyset `where` that
 * page starts from, for `orderBy: [{createdAt:'desc'}, {id:'asc'}]`.
 *
 * WHY THIS EXISTS AT ALL — `t.prismaConnection` already hands the resolver a
 * ready-made `{ cursor, skip: 1, take }`, and using it directly is one line.
 * That line has a defect worth this function: Prisma implements `cursor` by
 * SEEKING TO A ROW, so it needs that row to still be there. When it is not,
 * the page comes back EMPTY with `hasNextPage: false` and no error. A keyset
 * compares VALUES CARRIED IN the cursor and never looks the row up, and both
 * values it needs are in there — that is what `@@unique([userId, createdAt,
 * id])` is for. Deleting a request is a first-class action on both surfaces
 * (`bookRequestDelete`), so this is the expected case, not an edge one.
 *
 * `take`'s SIGN is the direction, and it is the plugin's own
 * (`prismaCursorConnectionQuery` negates it for `before`/`last`), not something
 * re-derived from `args` here. Forward (`take > 0`) means rows strictly AFTER
 * the cursor in the sort order — an OLDER `createdAt`, or the same `createdAt`
 * and a LATER `id`. Backward is the mirror image.
 *
 * No cursor (a first page, forward or backward) means no predicate at all.
 *
 * Same construction as `progressKeyset` in `schema/library/model.ts`, over
 * different columns; read that one's comments too.
 */
export const requestKeyset = (
  from: { createdAt: number; id: string } | undefined,
  take: number | undefined
): Prisma.BookRequestWhereInput => {
  if (!from) return {};
  return take !== undefined && take < 0
    ? {
        OR: [
          { createdAt: { gt: from.createdAt } },
          { createdAt: from.createdAt, id: { lt: from.id } },
        ],
      }
    : {
        OR: [
          { createdAt: { lt: from.createdAt } },
          { createdAt: from.createdAt, id: { gt: from.id } },
        ],
      };
};
