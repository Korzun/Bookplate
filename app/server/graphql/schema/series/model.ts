import { parseStringArray } from '../../derive';
import { builder } from '../builder';
import { CONNECTION_LIMITS, rejectOversizePage } from '../pagination';
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
      // Native `maxSize`/`defaultSize` bound the actual Prisma query
      // (`@pothos/plugin-prisma`'s `prismaCursorConnectionQuery` — verified
      // by reading `node_modules/@pothos/plugin-prisma/lib/util/cursors.js`)
      // — but by CLAMPING an over-max `first`/`last` down to `maxSize`, not
      // rejecting it, which the "reject, never clamp" ruling forbids. Kept
      // anyway as the defense-in-depth bound on the SQL itself; the actual
      // reject lives in `query` below. 100/20 here is a RESTATEMENT of
      // `@pothos/plugin-prisma`'s own default for an unconfigured
      // `t.relatedConnection` (`cursors.js:58-59`), not a new number — this
      // field was already effectively bounded there before this task; see
      // `CONNECTION_LIMITS`'s doc comment (`pagination.ts`) for the full
      // before/after table.
      maxSize: CONNECTION_LIMITS.seriesBooks.maxSize,
      defaultSize: CONNECTION_LIMITS.seriesBooks.defaultSize,
      // WHY THE REJECT LIVES HERE, NOT IN A `resolve` OVERRIDE: `t
      // .relatedConnection` only calls a user-supplied `resolve` as a
      // fallback, when the relation wasn't already loaded by the parent's
      // own merged Prisma `select` (`@pothos/plugin-prisma/lib/index.js`'s
      // `wrapResolve`: `resolver(parent, args, context, info)` runs on the
      // normal path, the field's OWN `resolve` option only via
      // `pothosPrismaFallback`) — verified empirically: a `resolve` that
      // unconditionally throws never fires for
      // `library.seriesByName.books`, the normal read path, because
      // `seriesByName`'s own query already embeds `books` via `include`.
      // `query`, by contrast, is called from `getQuery` inside BOTH the
      // parent's query-planning walk (`relationSelect`, which runs
      // unconditionally, is what builds that same `include`) and the
      // fallback resolve — so it is the one hook Pothos always calls before
      // this connection's rows are ever fetched, on every path. Confirmed
      // with the same throwing-callback experiment (a `query` that throws
      // above `first: 3` DOES fire for `seriesByName.books`, surfacing as a
      // normal `GraphQLError` on the `seriesByName` field, not a 500).
      query: (args) => {
        rejectOversizePage('Series.books', args, CONNECTION_LIMITS.seriesBooks.maxSize);
        return { orderBy: { seriesIndex: 'asc' } };
      },
    }),
  }),
});
