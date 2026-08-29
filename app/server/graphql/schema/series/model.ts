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
     * The viewer's own aggregate reading progress across this series' member
     * books — the unweighted mean of each book's `Progress.percentage`
     * (missing progress counts as 0%), or `null` when NONE of the series'
     * books have a progress row at all (an unstarted series, not a 0% one).
     * Exactly `calculateSeriesProgressPercent`, the computation
     * `useMySeriesProgress` used client-side before grid rows went
     * fetch-free (task 7 dropped `SeriesRow`'s progress badge for exactly
     * this reason — no such field existed on either transport; task 14
     * restores it here). That helper (`app/client/src/provider/progress/
     * helper.ts`) no longer exists — deleted with `ProgressProvider` and
     * the step-8 bridge (final whole-branch review, docs-only fix); the
     * full semantics are spelled out directly in `series-progress-loader.ts`'s
     * own doc comment, this field's `resolve` below.
     *
     * Named `progressPercentage`, not the bare `progress` this field
     * carried in an earlier revision of this task (review round 1) — a
     * bare `Series.progress: Float` broke two of this schema's own
     * conventions at once: `progress` elsewhere always names an OBJECT
     * (`Book.progress: Progress`) or a CONNECTION (`Library.progress`),
     * never a bare scalar, and this schema already has a word for "a raw
     * float percentage" — `Progress.percentage` — that the aggregate
     * scalars on `Series` itself (`bookCount`, `totalPages`, `totalSize`)
     * already follow the same descriptive-suffix pattern for. The rename
     * also let `SeriesRowFragment` (`app/client/src/graphql/library.ts`)
     * drop the `seriesProgress: progress` alias it needed solely to avoid
     * colliding with `BookRowFragment`'s own `progress` field inside the
     * same `LibraryEntry` union selection set — see that file's (now
     * removed) doc comment on the collision for the mechanism, still
     * worth knowing if a future field ever re-creates it.
     *
     * Resolved through `context.loadSeriesProgress`
     * (`series-progress-loader.ts`), a request-scoped batching loader —
     * NOT a plain per-series query, which would be a textbook N+1 across a
     * page of up to 100 series (`Library.entries`, `pagination.ts`'s
     * `CONNECTION_LIMITS.libraryEntries.maxSize`). See that file's doc
     * comment for why the aggregate needs two batched queries (member
     * books, then their progress rows) rather than one.
     */
    progressPercentage: t.field({
      type: 'Float',
      nullable: true,
      resolve: (series, _args, context) => context.loadSeriesProgress(series.userId, series.id),
    }),
    /**
     * A connection, not the plain list this started as — see the cleanup
     * spec, §"5. Connections for growable lists". Backward pagination
     * (`last`/`before`) genuinely works here, as it does on
     * `Validation.messages` and (since it became a `t.prismaConnection`)
     * `Library.progress`. `Library.entries` is the one connection in this
     * schema that does not OFFER it: it wraps a forward-only service cursor
     * over an interleaved two-table keyset and is hand-declared with a plain
     * `t.field` over an explicit `connectionObject`, so the SDL omits
     * `last`/`before` entirely (see the `entriesConnection` doc comment in
     * `library/model.ts`). `t.relatedConnection` paginates a real Prisma
     * relation and supports `last`/`before` natively — native support wins,
     * and the remaining asymmetry is stated in the schema rather than
     * enforced at runtime.
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
