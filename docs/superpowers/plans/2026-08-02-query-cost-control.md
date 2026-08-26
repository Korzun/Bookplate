# Query-Cost Control Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make response cost the enforced property — bounded connections plus a complexity/breadth/depth model — closing the proven authenticated-tenant DoS that depth alone cannot see.

**Architecture:** Three layers, cheapest first: explicit size bounds on every connection and `Query.nodes(ids:)`; then a cost model (`@pothos/plugin-complexity` if it survives an adversarial vetting gate, hand-rolled on our existing `addValidationRule` seam if it doesn't) owning complexity, breadth, AND depth; the hand-rolled `depth-limit.ts` is deleted when the plugin takes over depth.

**Tech Stack:** Pothos v4, graphql-yoga v5, graphql-js validation rules, vitest.

Spec: `docs/superpowers/specs/2026-08-02-query-cost-control-design.md` — its rulings bind. Evidence: `docs/superpowers/reviews/` + the probe table in the spec.

## Global Constraints

- Base: `11c3a495`, suite 1810/1810, lint clean. Branch `graphql-migration`.
- **Threat model: untrusted tenants.** Any logged-in account may be hostile; budgets are tight and enforced, calibrated from measurement.
- Established pattern rules bind: zero try/catch/throw in resolver bodies; errors carry `extensions: { code, http: { status } }` (precedent: `pagination.ts:31`, `builder.ts`'s `unauthorizedError`); shared guards are extracted, never copied (precedent: `rejectBackwardPagination`); seen-to-fail on every property-protecting test — a test that cannot fail against a disabled rule proves nothing.
- **Task 2 is a GATE.** Its verdict (plugin adopted / plugin rejected) decides whether tasks 3–4 are plugin-shaped or hand-rolled. Its report must state the verdict unambiguously in its first line. Do not begin task 3 without it.
- SDL diff: Task 1 changes connection arg descriptions only if the bound is documented there; Task 4 may change error shapes. Every task regenerates and gates the SDL.
- Tests from `app/server`, lint from repo root. Commits end with:
  `Claude-Session: https://claude.ai/code/session_01DUA8zt35fR6gXqxiT7S5f3`

## File Structure

- Modify: `app/server/graphql/schema/pagination.ts` (new bound guard beside `rejectBackwardPagination`)
- Modify: `schema/library/model.ts:136` (`entries`), `:318` (`progress`), `schema/series/model.ts:26` (`books`), `schema/validation/model.ts:51` (`messages`), and the `Query.nodes` registration (locate: `grep -rn "nodes" app/server/graphql/schema/ --include="*.ts" | grep -v test`)
- Create: `app/server/graphql/cost-limit.ts` (+ test) — the cost rule, plugin-config or hand-rolled per Task 2's verdict
- Delete (Task 4): `app/server/graphql/depth-limit.ts` + its wiring, IF the plugin takes over depth
- Modify: `app/server/graphql/yoga.ts` (rule wiring), `schema/builder.ts` (plugin registration if adopted)
- Docs: `docs/superpowers/specs/2026-07-30-graphql-server-design.md` (handoff query-budget section), the query-cost spec (status)

---

### Task 1: Connection bounds + `Query.nodes(ids:)` cap

**Files:**
- Modify: `app/server/graphql/schema/pagination.ts`
- Modify: `schema/library/model.ts` (`entries` :136, `progress` :318), `schema/series/model.ts` (`books` :26), `schema/validation/model.ts` (`messages` :51), the `Query.nodes` registration
- Test: each model's test file + `pagination.test.ts`

**Interfaces:**
- Consumes: `rejectBackwardPagination(fieldName, args)` (existing, same file — the shape to mirror).
- Produces:

```ts
/** Rejects over-max page sizes. Reject, never clamp: a silently clamped page
 *  makes a client's pagination look broken instead of telling it what happened. */
export const rejectOversizePage = (
  fieldName: string,
  args: { first?: number | null },
  maxSize: number
): void => {
  if (args.first == null || args.first <= maxSize) return;
  throw new GraphQLError(
    `${fieldName} allows at most ${maxSize} items per page (requested ${args.first}).`,
    { extensions: { code: 'PAGE_SIZE_EXCEEDED', http: { status: 400 } } }
  );
};
```

- [ ] **Step 1 — source the numbers, don't invent them.** Read the client's current REST pagination for each surface (grid page size, progress list, series books, validation messages) and record each `maxSize`/`defaultSize` with its origin in a comment. Where no REST precedent exists, state the reasoning. `defaultSize` = what a client gets omitting `first`; `maxSize` = the ceiling.
- [ ] **Step 2 — failing tests** per connection: `first: <maxSize>` succeeds; `first: <maxSize + 1>` → error with `extensions.code === 'PAGE_SIZE_EXCEEDED'` and `http.status === 400`; omitting `first` returns at most `defaultSize` items (seed more rows than that so the assertion discriminates). Plus `Query.nodes(ids:)` over its cap → same shape.
- [ ] **Step 3 — implement**: `rejectOversizePage` in pagination.ts; call it in each of the four connection resolvers alongside the existing `rejectBackwardPagination` call; set Pothos's own `defaultSize`/`maxSize` connection options where they exist (check the Pothos version's `t.connection`/`t.relatedConnection` options — if it supports `maxSize` natively, prefer it AND keep the explicit guard only where the native option doesn't cover the error shape we want; say which you used per field). `Query.nodes(ids:)`: reject `ids.length > cap` with the same code.
- [ ] **Step 4 — seen-to-fail**: remove one `rejectOversizePage` call → that connection's oversize test reds; restore. Confirm `first: 999999999` on `Library.entries` is now rejected (the spec's probe).
- [ ] **Step 5**: regenerate SDL (arg descriptions may gain the limit — that's the only expected diff). Suite + lint. Commit `feat(graphql): bound connection page sizes and node batch size`.

### Task 2: Vetting gate — `@pothos/plugin-complexity` (VERDICT GATES TASKS 3-4)

**Files:**
- Create: a scratch probe harness under the plan workspace (NOT committed to `app/server` unless a probe becomes a permanent test in Task 4)
- Modify: nothing in `app/server` unless adopting requires a dependency install to probe — install in a scratch branch state and revert if rejected

**Interfaces:**
- Produces: THE VERDICT — `PLUGIN ADOPTED` or `PLUGIN REJECTED (reason)` as the first line of `.superpowers/sdd/<workspace>/task-2-report.md`, plus the probe evidence table. Tasks 3–4 read this.

Plugin under test: `@pothos/plugin-complexity` v4.2.1. Config shape (from its docs, verified 2026-08-02):

```js
complexity: { limit: { complexity: 500, depth: 10, breadth: 50 } }   // each field optional
// per field: complexity: (args, ctx) => ({ field: 5, multiplier: args.first ?? 5 })
```

- [ ] **Step 1 — fragment-walk timing curve.** Build documents with N = 6, 12, 18, 24, 30 nested/repeated fragments (our own rule's bug: 2^N re-expansion; the fix took N=24 from 4777 ms → 1.13 ms). Time the plugin's validation for each. PASS = curve stays flat (single-digit ms at N=30). FAIL = any superlinear growth.
- [ ] **Step 2 — cyclic + mutually-recursive fragments.** PASS = clean validation error. FAIL = throw, RangeError, or HTTP 500 (our rule's C-2).
- [ ] **Step 3 — alias fan-out.** 200 aliased copies of a cheap field (the probe that cost 61× baseline at depth 6). PASS = the `breadth` limit rejects it. FAIL = priced as one field.
- [ ] **Step 4 — pre-execution, empirically.** Spy a resolver; send an over-limit query; PASS = zero resolver calls (its docs claim pre-root-field computation — confirm, don't trust).
- [ ] **Step 5 — depth parity.** Run `depth-limit.test.ts` + `depth-limit-integration.test.ts`'s committed fixtures through the plugin's depth limit at 12. PASS = same accept/reject verdicts as `depth-limit.ts`. Any divergence: record the shape, the two numbers, and whether the plugin counts fragments/inline-fragments differently — a divergence is not automatically a FAIL, but it means the number gets re-derived under its semantics in Task 3 (say so).
- [ ] **Step 6 — error shape.** What it emits (message, `extensions`), and whether it survives production masking (`maskedErrors: isProduction`). Record it — Task 4 updates `content-negotiation.test.ts` and the operation-logging tests against it.
- [ ] **Step 7 — VERDICT.** Adopt only if steps 1–4 PASS. Any failure → `PLUGIN REJECTED`, and tasks 3–4 hand-roll complexity + breadth on the existing `addValidationRule` seam, keeping `depth-limit.ts` (fallback coherence: one implementation family, never a mix). Write the verdict as the report's first line. No commit if rejected (revert any install); commit the dependency add only if adopted: `chore(deps): add @pothos/plugin-complexity`.

### Task 3: Cost rule, log-only + calibration

**Files:**
- Create: `app/server/graphql/cost-limit.ts` + `cost-limit.test.ts`
- Modify: `app/server/graphql/yoga.ts` (wire the rule), `schema/builder.ts` (plugin registration + per-field complexity if adopted)

**Interfaces:**
- Consumes: Task 2's verdict (plugin-shaped or hand-rolled).
- Produces: a rule that COMPUTES and LOGS cost without rejecting, plus the measured calibration table Task 4 sets budgets from.

- [ ] **Step 1 — per-field costs (plugin path)**: connection fields get args-aware multipliers, e.g. `complexity: (args) => ({ field: 1, multiplier: args.first ?? <defaultSize from Task 1> })` on `Library.entries`, `Library.progress`, `Series.books`, `Validation.messages`. Hand-rolled path: the equivalent weighting inside your rule. Document the cost of one "unit" so the numbers are interpretable.
- [ ] **Step 2 — log-only wiring**: the rule computes complexity/breadth/depth and logs `{operationName, complexity, breadth, depth}` at info, rejecting NOTHING. Reuse the operation-logging plugin's conventions (no query text/variables in logs).
- [ ] **Step 3 — build the calibration fixture set.** MUST cover what the depth exercise missed: both `LibraryEntry` union arms (Book AND Series, the Series arm nesting to its book cards); a `BookCard` fragment reused across both arms (fragment-composed, as Apollo will generate); aliased shapes; admin traversal (`user(id:) { library { … } }`); the richest detail views (`pendingFix.state.autoFixes`, `validation.messages`); series detail. Reuse `depth-limit-integration.test.ts`'s fixtures where they already encode a real screen.
- [ ] **Step 4 — measure and record**: run every fixture, record the table (fixture → complexity, breadth, depth) in the code comment AND the report. Also measure the four attack probes (3-hop `nodes()` cycle, Series-arm 2-hop, 200-alias fan-out, `first: 999999999` — the last should now fail at Task 1's bound before costing anything; note that).
- [ ] **Step 5**: suite + lint (nothing rejects yet, so no existing test should change). Commit `feat(graphql): compute query cost in log-only mode`.

### Task 4: Enforcement + regression suite + depth handover

**Files:**
- Modify: `cost-limit.ts` (budgets + enforcement), `yoga.ts`
- Delete (plugin path only): `app/server/graphql/depth-limit.ts`, `depth-limit.test.ts`, `depth-limit-integration.test.ts` — after porting their fixtures
- Modify: `content-negotiation.test.ts`, the operation-logging tests (error shapes)
- Test: `cost-limit-integration.test.ts` (new, or the ported depth integration file renamed)

- [ ] **Step 1 — set budgets** from Task 3's measured table: each limit = legitimate max + a stated margin, with the number's reasoning in the comment (the F-1 lesson: a shape landing exactly on the limit is a production outage waiting for one new field). State the gap to the nearest attack shape for each of the three limits.
- [ ] **Step 2 — the regression suite.** Every proven probe becomes a committed test asserting REJECTION with the right shape: the 3-hop `Query.nodes(ids:)`-rooted cycle (1.35M objects / 80.7 MB / 8.2 s at depth 12 — the one that passes today), the Series-arm 2-hop (depth 12), the 200-alias fan-out (depth 6), and `first: 999999999` (rejected at Task 1's bound — assert which layer catches it). Every real screen fixture asserts ACCEPTANCE. Integration-level (real HTTP) for at least the 3-hop cycle and one screen query.
- [ ] **Step 3 — seen-to-fail on all of them**: disable the rule → every rejection test reds; restore. Disable Task 1's bounds → the `first:` test reds. Report both directions.
- [ ] **Step 4 — depth handover (plugin path)**: port `depth-limit.test.ts`/`depth-limit-integration.test.ts`'s fixtures into the cost-rule tests, prove the plugin's depth limit reproduces their accept/reject verdicts (Task 2 Step 5's parity result is the input), THEN delete `depth-limit.ts` and its wiring. If Task 2 REJECTED the plugin, `depth-limit.ts` stays and this step is a no-op — say so explicitly rather than skipping silently.
- [ ] **Step 5 — error-shape fallout**: update `content-negotiation.test.ts` and the operation-logging tests to the new rejection shape (Task 2 Step 6 recorded it). Validation rejections must still log at warn (the operator-visibility rule from the prior plan).
- [ ] **Step 6**: SDL check; suite + lint. Commit `feat(graphql): enforce query cost budgets`.

### Task 5: Docs

**Files (docs, gitignored, no commit):**
- Modify: `docs/superpowers/specs/2026-07-30-graphql-server-design.md` (Apollo handoff), `docs/superpowers/specs/2026-08-02-query-cost-control-design.md` (status)

- [ ] **Step 1 — handoff "Query budget" section**: the three limits with their numbers; what blows each (deep nesting, wide aliasing, big `first:`); the rejection shape a client sees (`extensions.code`, HTTP status) and how Apollo should surface it; the connection `maxSize`s so client authors size their pages correctly; the guidance that fragment composition is depth-transparent but NOT breadth-transparent.
- [ ] **Step 2 — record the outcome**: Task 2's verdict and why; the calibration table; whether `depth-limit.ts` survived. Update the query-cost spec's Status with the commit range and final suite count.
- [ ] **Step 3 — grep gate**: `depth-limit`, `MAX_DEPTH`, `graphql-depth-limit` across both specs and the handoff — survivors must be historical or accurate-post-change. Suite + lint once proving docs-only (`git status` clean of tracked changes).

---

## Definition of done

- Suite green (report final count vs 1810 base), lint clean, `graphql:schema:check` clean.
- All four proven attack probes REJECTED by a committed test; all real screen fixtures ACCEPTED.
- Exactly one depth enforcer exists (whichever Task 2's verdict chose) — grep proves no second one.
- Handoff carries the query budget; specs' statuses current.
