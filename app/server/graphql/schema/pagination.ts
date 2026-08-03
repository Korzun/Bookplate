import { GraphQLError } from 'graphql';

/**
 * `t.connection` always adds `last`/`before` to the SDL (they are baked into
 * Pothos's `DefaultConnectionArguments`), but every paginated read in this
 * schema delegates to a store method with a single forward keyset cursor —
 * `BookStore.listBooksPage` and `UserStore.getUserProgressPage` both take one
 * cursor plus a `take` and have no keyset to walk backward from. Bolting one
 * on would mean changing stores this migration has kept untouched.
 *
 * Silently ignoring `last`/`before` would mean a client asking for the
 * trailing page instead gets the *leading* page with no error, which is worse
 * than not offering backward pagination at all — so both are rejected loudly,
 * in the same `extensions.code` + `extensions.http.status` shape `builder.ts`'s
 * `unauthorizedError` uses, so a client branches on `code` rather than parsing
 * English.
 *
 * Shared rather than copied: `Library.entries` was the only connection when
 * this rule was written, `Library.progress` is the second, and two copies of a
 * pagination guard that can silently diverge is the pattern this plan has
 * repeatedly extracted rather than duplicated.
 */
export const rejectBackwardPagination = (
  fieldName: string,
  args: { last?: number | null; before?: string | null }
): void => {
  // Each condition is checked independently: `last` alone and `before` alone
  // must both be rejected, which an `&&` between them would not do.
  if (args.last == null && args.before == null) return;
  throw new GraphQLError(
    `${fieldName} only supports forward pagination — use \`first\`/\`after\`, not \`last\`/\`before\`.`,
    { extensions: { code: 'BACKWARD_PAGINATION_UNSUPPORTED', http: { status: 400 } } }
  );
};

/**
 * Shared by `rejectOversizePage` and `rejectOversizeIdBatch` — one
 * `extensions` shape for both, rather than two literal copies of the same
 * object (the same "shared, never copied" reasoning `rejectBackwardPagination`
 * above already documents for its own error).
 */
const pageSizeExceededError = (message: string): GraphQLError =>
  new GraphQLError(message, { extensions: { code: 'PAGE_SIZE_EXCEEDED', http: { status: 400 } } });

/** Rejects over-max page sizes. Reject, never clamp: a silently clamped page
 *  makes a client's pagination look broken instead of telling it what happened. */
export const rejectOversizePage = (
  fieldName: string,
  args: { first?: number | null },
  maxSize: number
): void => {
  if (args.first == null || args.first <= maxSize) return;
  throw pageSizeExceededError(
    `${fieldName} allows at most ${maxSize} items per page (requested ${args.first}).`
  );
};

/**
 * `rejectOversizePage`'s counterpart for `Query.nodes(ids:)`: the same
 * reject-not-clamp ruling and error shape, applied to an id-list length
 * instead of a `first` argument (Relay's `nodes` field has no `first`/page
 * concept at all — the whole `ids` array is the request).
 */
export const rejectOversizeIdBatch = (
  fieldName: string,
  ids: readonly unknown[],
  maxSize: number
): void => {
  if (ids.length <= maxSize) return;
  throw pageSizeExceededError(
    `${fieldName} accepts at most ${maxSize} ids per request (requested ${ids.length}).`
  );
};

/**
 * Every connection's page-size bound, sourced and recorded here once so the
 * native Pothos `maxSize`/`defaultSize` options (where a field uses them)
 * and the `rejectOversizePage`/`query`-callback guards (every field needs
 * one of these — see each model file's own comment for which, and why) can
 * never drift apart by citing two different numbers for the same field.
 *
 * `Library.entries` / `Library.progress` — REST precedent: both REST routes
 * these fields replace already clamp their own `take` query param, and this
 * migration keeps `routes/` untouched, so the GraphQL numbers are read
 * straight off it rather than re-decided:
 *  - `Library.entries` mirrors `routes/ui.ts`'s
 *    `Math.min(Math.max(parseInt(take,10) || 20, 1), 100)` — default 20, max
 *    100 (`Library.entries`'s own resolver already restates this clamp
 *    verbatim; see its comment there).
 *  - `Library.progress` mirrors `utils/progress-pagination.ts`'s
 *    `DEFAULT_TAKE`/`MAX_TAKE` — default 50, max 100 — the same bounds both
 *    `GET /api/my/progress` and `GET /api/users/:username/progress` apply via
 *    `parseProgressTake`/`clampProgressTake`.
 *
 * `Series.books` / `Validation.messages` — NO REST precedent (`GET
 * /api/series/:name` returns every book in the series whole; `bookValidate`'s
 * REST equivalent returns `report.messages` whole); reasoning stated
 * explicitly instead:
 *  - `Series.books` mirrors `LIBRARY_ENTRIES`'s numbers: both connections
 *    list `Book` rows, and a real series (this schema's own `bookCount`
 *    denormalization exists precisely because series are counted, bounded
 *    collections) is nowhere near this ceiling in practice — reusing the
 *    library grid's own already-reasoned bound is more defensible than
 *    inventing an independent number with no data behind it.
 *  - `Validation.messages` mirrors `LIBRARY_PROGRESS`'s *default* (50, a
 *    detail-view connection, not the primary grid), but its *max* is set
 *    well above the cleanup spec's own characterization of this field ("the
 *    one list in the schema with realistic hundreds-of-rows growth" for a
 *    badly-broken EPUB, `docs/superpowers/specs/2026-08-01-schema-cleanup-
 *    design.md` §5) — 500, comfortably past "hundreds" so a legitimately
 *    messy validation report is never the thing this bound rejects.
 *
 * `Query.nodes(ids:)` — NO REST or client precedent (`grep -rn "nodes(ids"
 * app/client` finds no caller; Relay's own spec places no ceiling on `ids`'s
 * length). Set to the largest per-page ceiling already established for any
 * single connection above (100), so a batch node lookup can never out-cost
 * the amplification this same task bounds everywhere else.
 */
export const CONNECTION_LIMITS = {
  libraryEntries: { maxSize: 100, defaultSize: 20 },
  libraryProgress: { maxSize: 100, defaultSize: 50 },
  seriesBooks: { maxSize: 100, defaultSize: 20 },
  validationMessages: { maxSize: 500, defaultSize: 50 },
  nodesBatch: 100,
} as const;
