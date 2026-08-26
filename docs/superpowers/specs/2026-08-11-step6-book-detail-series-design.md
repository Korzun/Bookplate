# Spec 2, Step 6 — Book detail + `/library/series/:name` — Design

Status: approved (design), 2026-08-11
Parent spec: `2026-08-03-apollo-client-migration-design.md` (§9 sequencing row 6). Read its
**§14** (lessons from executing steps 0–2) and **§15** (known behaviour changes) before planning.
Base: `ebc6ae53`, server 1977/1977, client 1107/1107, lint + codegen clean, branch pushed.
Surface map (evidence for every count below):
`scratchpad/step6-surface-map.md` (session-scoped; regenerate if lost).

## User rulings

- **The validation-counts gap is closed server-side**, not by client tallying.
- **Series first, then book detail**, in one plan.

## 1. The gap: `Validation.counts`

REST's `ValidationDetailModal` renders `counts: Record<Severity, number>`, computed by tallying
every message (`services/epub-validator.ts:108-113`). GraphQL's `Validation` exposes only a
paginated `messages` connection (default 20, max 100), so a client tally is wrong-by-construction
for any book with more than 100 messages and costs extra round trips and query budget besides.

**Shape — a list, not an object with one field per severity:**

```graphql
type ValidationSeverityCount {
  severity: ValidationSeverity!
  count: Int!
}
# on Validation:
counts: [ValidationSeverityCount!]!
```

Five severities exist today (`FATAL`, `ERROR`, `WARNING`, `USAGE`, `INFO`). An object with five
named fields would duplicate the enum in a second place, so a sixth severity would require
changing two things and would be invisible to any client not rebuilt. The list stays correct
automatically and matches how the modal actually renders (iterating severities in order).

**Zero-count severities are omitted**, mirroring REST exactly: `counts[s]` is only populated when
a message of that severity exists (`epub-validator.ts:111`). The client renders the same summary
it does today.

**N+1 safety — follow the `Series.progressPercentage` precedent** (`schema/series/model.ts:54-58`):
a request-scoped batching loader, `context.loadValidationCounts(userId, bookId)`, NOT a per-parent
query. A list showing many books' validation status must not fire one COUNT per book. Per the
project's standing loader rule, the loader **captures `reject` and wraps both the query and the
grouping in try/catch** — a loader that only captures `resolve` hangs the request on a DB error.
That exact bug shipped once in this codebase (`progress-loader`) and must not ship again.

Server-side work is confined to this field, its loader, and its tests. It goes through the normal
gates: SDL regeneration, the cost-calibration suite, and its own review.

## 2. Client — series (first)

- **Delete `book-row/from-book.tsx`** — the adapter whose own doc comment reads "TEMPORARY REST
  adapter … delete this file when series migrates". `SeriesPage` points at the real `BookRow` that
  step 5 already migrated.
- `useSeries` + `useSeriesBookList` collapse into an Apollo hook over `Library.seriesByName` (not
  a `Query` root field — rooted at `node(id: $libraryId) { ... on Library { seriesByName(name:) } }`,
  the same way `useLibraryEntries` roots `entries`) and its `Series.books`, following the shape
  steps 3–5 established.
- `Series.progressPercentage` already exists (added during step 5) — no new server field needed
  for the series screen.

## 3. Client — book detail (second)

- `BookPage` reads one query carrying the book plus its `validation` (now including `counts`),
  `lineage`, `pendingFix`, and `series`.
- Four action hooks become mutations with hand-written cache updates: `useDeleteBook`,
  `useValidateBook`, `useRegenChapters`, `useClearBookEditions`. The lineage modal's
  `useBookLineage` / `useUnlinkBookLineage` migrate with them.

## 4. Hook-shape rule

Per hook, choose between returning a new shape and preserving the existing REST tuple **by
call-site count** — preserve where many components consume it, reshape where few do. This is what
steps 3–5 did; it keeps each diff proportional to its value. State the count and the choice per
hook in the plan, so the decision is visible rather than incidental.

## 5. Scope boundary — what stays REST after step 6

Explicitly NOT in this step: progress hooks (step 8), replace/upload (step 9), edit (step 7), and
the download/cover blob seams (permanent, §9.1). **12 of the 20 `useWithTargetUser` consumers
retire here; 8 survive by design.** A plan that retires more has taken another step's work; a plan
that retires fewer has left something behind — either is worth flagging at review.

## 6. Fragment masking

Masking is ON (§14.1). Every shared fragment needs explicit `useFragment` unmasking at each
consumption site — **planned per site, not discovered during implementation**. `useFragment` is a
generated identity function, not a React hook, so it may be called conditionally or on a
possibly-`undefined` value.

## 7. Guardrails

All three existing checks apply to every new document:

- **codegen freshness** (client lint) — committed `src/gql/` matches SDL + documents;
- **cache-key selection** (`provider/apollo/selection-ids.ts`) — derives required key fields from
  `cacheConfig`, so it will demand `id` on each normalizable type, including on `Node` itself
  where a selection roots there (`node(id:) { id ... on Book { id … } }`);
- **query cost** (server `client-operations-cost.test.ts`) — every shipped operation under 70% of
  both budgets.

**Measure the book-detail query against the budget EARLY, not at review.** It is the richest
document this migration has produced (book + validation + lineage + pendingFix + series), and the
70% headroom line is genuinely tight — the admin user-list screen already sits at 68.5%. A screen
that lands over the line forces a selection trim or a budget decision, and discovering that at
review is expensive. `costOf()` in `app/server/graphql/cost-test-support.ts` measures a candidate
document locally.

## 8. Testing

~120 test cases across 17 files migrate to `renderWithApollo` / `renderHookWithApollo`
(`test-utils.tsx`, real `InMemoryCache` + `MockLink`; no MSW). Standing disciplines bind:
seen-to-fail on every property-protecting test; verify against code rather than transcribing from
docs; trace a REST behaviour end to end before mirroring it.

Error surfacing follows the settled policy (§14.6): each migrated screen hook returns
`error: string | undefined`; a first-page failure with no data is the empty-error state, a
`fetchMore` failure keeps existing rows and offers retry.

## 9. Definition of done

- `/library/series/:name` and book detail both on GraphQL; `from-book.tsx` deleted.
- `Validation.counts` shipped with a batching loader and its tests.
- 12 `useWithTargetUser` consumers retired; the surviving 8 accounted for by name.
- Both suites green, lint + codegen clean, `test:cost` green, no document over 70% of budget.
- Any user-visible divergence recorded in the parent spec's §15.

## 10. Out of scope

Steps 7–10. The parent spec's §14.8 residuals (the `Progress.id` description phrasing and the
`progressDelete` guard) are untouched here — they belong to whoever next works in that area.
