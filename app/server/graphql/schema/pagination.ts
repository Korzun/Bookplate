import { GraphQLError } from 'graphql';

/**
 * Shared by `rejectOversizePage` and `rejectOversizeIdBatch` — one
 * `extensions` shape for both, rather than two literal copies of the same
 * object that could silently diverge.
 */
const pageSizeExceededError = (message: string): GraphQLError =>
  new GraphQLError(message, { extensions: { code: 'PAGE_SIZE_EXCEEDED', http: { status: 400 } } });

/**
 * Rejects over-max page sizes. Reject, never clamp: a silently clamped page
 * makes a client's pagination look broken instead of telling it what
 * happened.
 *
 * Checks BOTH `first` and `last` (review I-2): `Series.books`/
 * `Validation.messages` genuinely support backward pagination, so an
 * oversize `last` would otherwise fall through to the native `maxSize`
 * clamp with no error — exactly the failure mode this ruling exists to
 * prevent, and it applied to `first` only before this fix.
 *
 * `args.last` is nevertheless always `undefined` for
 * `Library.entries`/`Library.progress`: those two fields no longer DECLARE
 * `last`/`before` at all (they are hand-declared with `t.field` over an
 * explicit `connectionObject` — see `library/model.ts`), so GraphQL's own
 * validation rejects the argument as unknown, with `GRAPHQL_VALIDATION_FAILED`,
 * before any resolver runs. That replaced an earlier
 * `rejectBackwardPagination` guard which threw `BACKWARD_PAGINATION_UNSUPPORTED`
 * from inside the resolver — the schema now states forward-only rather than
 * advertising `last`/`before` and refusing them. The `last` branch below is
 * therefore reached only by `Series.books`/`Validation.messages`, where
 * backward pagination genuinely works and this is the only guard `last` ever
 * meets.
 */
export const rejectOversizePage = (
  fieldName: string,
  args: { first?: number | null; last?: number | null },
  maxSize: number
): void => {
  if (args.first != null && args.first > maxSize) {
    throw pageSizeExceededError(
      `${fieldName} allows at most ${maxSize} items per page (requested ${args.first}).`
    );
  }
  if (args.last != null && args.last > maxSize) {
    throw pageSizeExceededError(
      `${fieldName} allows at most ${maxSize} items per page (requested ${args.last}).`
    );
  }
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
 * CORRECTED after review (I-1): "no REST precedent" is not the same as "no
 * existing bound" — `@pothos/plugin-prisma` applies its own
 * `DEFAULT_MAX_SIZE = 100` / `DEFAULT_SIZE = 20` to every
 * `t.relatedConnection` that sets neither option
 * (`node_modules/@pothos/plugin-prisma/lib/util/cursors.js:58-59,221-242`),
 * so `Series.books` and `Validation.messages` were ALREADY effectively
 * bounded at 100/20 before this task touched them, by CLAMPING rather than
 * rejecting. The task's job for these two fields is therefore "keep the
 * existing ceiling, change clamp to reject" — not "invent a new ceiling" —
 * and any number above 100/20 is a deliberate *loosening* that needs its
 * own justification, not a default that needs sourcing from scratch.
 * `Library.entries`/`Library.progress` don't have this trap: they were
 * always fully hand-resolved (no Pothos connection option ever applied to
 * them), so their pre-existing REST-mirrored clamp (below) was the only
 * effective bound either way.
 *
 * Before/after effective limit (the number actually enforced, whatever the
 * mechanism) for every connection, confirming none of the four widens what
 * was already there:
 *
 * | Field                  | Before this task (mechanism)                    | After |
 * |-------------------------|--------------------------------------------------|-------|
 * | `Library.entries`       | 100/20, CLAMPED (resolver's own `Math.min`/`Math.max`, pre-existing) | 100/20, REJECTED |
 * | `Library.progress`      | 100/50, CLAMPED (`clampProgressTake`, pre-existing) | 100/50, REJECTED |
 * | `Series.books`          | 100/20, CLAMPED (`@pothos/plugin-prisma` default — no option was set) | 100/20, REJECTED |
 * | `Validation.messages`   | 100/20, CLAMPED (same plugin default) | **100/20, REJECTED** (was shipped as 500/50 — an undetected 5x/2.5x widening; reverted per review I-1: the client has no GraphQL screen reading this field at all today — `grep -rln "graphql\|useQuery\|gql\`" app/client/src` finds nothing — so there is no real-screen evidence to justify anything above the pre-existing bound, and the burden is on justifying an increase, not on finding a reason to keep the default) |
 * | `Query.nodes(ids:)`     | unbounded (relay plugin applies no default cap to `ids.length`) | 100 |
 *
 * `Library.entries` / `Library.progress` — REST precedent, restated here as
 * the origin because it predates and matches the pre-existing effective
 * bound exactly:
 *  - `Library.entries` mirrors `routes/ui.ts`'s
 *    `Math.min(Math.max(parseInt(take,10) || 20, 1), 100)` — default 20, max
 *    100 (`Library.entries`'s own resolver already restates this clamp
 *    verbatim; see its comment there).
 *  - `Library.progress` mirrors `utils/progress-pagination.ts`'s
 *    `DEFAULT_TAKE`/`MAX_TAKE` — default 50, max 100 — the same bounds both
 *    `GET /api/my/progress` and `GET /api/users/:username/progress` apply via
 *    `parseProgressTake`/`clampProgressTake`.
 *
 * `Series.books` / `Validation.messages` — no REST precedent, but (per the
 * correction above) an existing effective bound from `@pothos/plugin-prisma`'s
 * own defaults, which both fields now restate explicitly rather than widen:
 *  - `Series.books`: 100/20, exactly the plugin default — restated so the
 *    `query`-callback reject and the native clamp can't drift, not a new
 *    number.
 *  - `Validation.messages`: 100/20, same reasoning. The cleanup spec's
 *    characterization of this field ("hundreds-of-rows growth" for a
 *    badly-broken EPUB, `docs/superpowers/specs/2026-08-01-schema-cleanup-
 *    design.md` §5) is real, but a client reading hundreds of messages
 *    through this connection pages through them 100 at a time — that is
 *    what pagination is *for* — rather than needing a taller single-page
 *    ceiling. Confirmed the client has no GraphQL-backed validation screen
 *    to measure a real per-page need against yet: the existing
 *    validation-detail modal (`app/client/src/control/validation-detail-
 *    modal/index.tsx`) renders REST's already-whole, unpaginated
 *    `report.messages` array with no scroll/page-size limit of its own — so
 *    there is no "the UI shows N at a time" number to read off it either. A
 *    future task raising this bound needs a real GraphQL screen's measured
 *    need behind it, per this task's own F-1 lesson (a limit without
 *    evidence is how legitimate queries get rejected OR, as here, how an
 *    amplification vector gets reopened).
 *
 * `Query.nodes(ids:)` — NO REST or client precedent (`grep -rn "nodes(ids"
 * app/client` finds no caller; Relay's own spec places no ceiling on `ids`'s
 * length, and `@pothos/plugin-relay` applies none either — this is a
 * genuinely new bound, not a restatement of a pre-existing one). Set to the
 * largest per-page ceiling established for any single connection above
 * (100), so a batch node lookup can never out-cost the amplification this
 * same task bounds everywhere else. NOTE (review N-1, not a Task 1 defect):
 * this caps ids per FIELD OCCURRENCE, not per request — 200 aliased copies
 * of `nodes(ids:[<100 ids>])` still cost 20,000 lookups at depth 2, because
 * nothing in this schema prices repeated/aliased fields yet. That is what
 * makes a widened per-occurrence bound (the I-1 mistake this comment now
 * corrects) dangerous rather than academic, and it is exactly the gap
 * Tasks 3–4's `breadth` limit exists to close — not something this cap can
 * fix on its own.
 */
export const CONNECTION_LIMITS = {
  libraryEntries: { maxSize: 100, defaultSize: 20 },
  libraryProgress: { maxSize: 100, defaultSize: 50 },
  seriesBooks: { maxSize: 100, defaultSize: 20 },
  validationMessages: { maxSize: 100, defaultSize: 20 },
  nodesBatch: 100,
} as const;
