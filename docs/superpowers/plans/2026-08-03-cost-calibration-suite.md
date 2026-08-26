# Cost-Calibration Suite + Debt Cleanup Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Turn the query-cost measurements into a CI-enforced calibration suite, and clear the three recorded debts (memo duplication, under-priced device multiplier, undocumented `BookCard` in §Q).

**Architecture:** `depth-limit.ts` becomes the second consumer of the already-extracted `fragment-walk-memo.ts`; a new `cost-calibration.test.ts` owns the fixture corpus and fails CI when any legitimate shape crosses 70% of budget; the device multiplier is re-derived and the complexity budget raised to satisfy 70% — in that order, measurements before numbers.

**Tech Stack:** vitest, graphql-js validation rules, GitHub Actions.

Spec: `docs/superpowers/specs/2026-08-03-cost-calibration-suite-design.md` — its rulings bind.

## Global Constraints

- Base: `ee8b4a7c`, suite 1928/1928, lint clean, SDL byte-identical to `11c3a495`.
- **Headroom threshold is 70%** (user ruling). **When real screens exceed it, RAISE THE BUDGET** — `INSTANCE_USER_MULTIPLIER = 50` stays; it is a security ceiling sized to the supported instance and shrinking it is the unsafe direction.
- **Measurements before numbers, always.** Land a multiplier change → re-measure → derive the budget from what was measured. Deriving a budget from stale or unvalidated numbers is how `13,483` (an unsendable query) once set a budget.
- **Every fixture schema-validated** via `accepts()`'s `specifiedRules` gate before measurement.
- **Never justify a budget by "gap to nearest attack"** — that measures the fixtures someone wrote, not the attack floor. Legit anchors only.
- Seen-to-fail on every property-protecting test, including the CI guardrail itself.
- SDL must stay byte-identical; `npm run lint` from repo root; server tests from `app/server`.
- Commits end with: `Claude-Session: https://claude.ai/code/session_01DUA8zt35fR6gXqxiT7S5f3`

## File Structure

- Modify: `app/server/graphql/depth-limit.ts` (consume the shared memo; delete its local type)
- Modify: `app/server/graphql/fragment-walk-memo.ts` (its doc comment says depth-limit is "intentionally left untouched" — now false)
- Create: `app/server/graphql/cost-calibration.test.ts` (the fixture corpus + headroom/separation assertions + table)
- Modify: `app/server/graphql/cost-limit.test.ts` (fixtures move out; rule-behaviour unit tests stay)
- Modify: `app/server/package.json` (`test:cost` script), `.github/workflows/ci.yml` (sixth job)
- Modify: `app/server/graphql/cost-limit.ts` (`HOUSEHOLD_DEVICE_MULTIPLIER`, `COMPLEXITY_BUDGET`)
- Modify (docs, gitignored): `docs/superpowers/specs/2026-07-30-graphql-server-design.md` §Q; the calibration spec's status

---

### Task 1: `depth-limit.ts` consumes the shared memo

**Files:**
- Modify: `app/server/graphql/depth-limit.ts:87-91` (local `FragmentDepthMemo` type), `:160-164` and `:218-221` (two inline memo literals)
- Modify: `app/server/graphql/fragment-walk-memo.ts` (doc comment)
- Test: `depth-limit.test.ts`, `depth-limit-integration.test.ts` (must pass UNCHANGED — they are the proof)

**Interfaces:**
- Consumes (already exists, `cost-limit.ts` is its first consumer):
```ts
export type FragmentWalkMemo<T> = {
  cache: Map<string, T>;
  inProgress: Set<string>;
  onCycle: (fragmentName: string) => void;
};
export const createFragmentWalkMemo = <T>(onCycle: (n: string) => void) => FragmentWalkMemo<T>;
```
- Produces: `depth-limit.ts` with zero local memo declarations; one memoization implementation in the repo.

**Note on scope:** the extraction already happened — `fragment-walk-memo.ts` exists and `cost-limit.ts` imports it. What remains is that `depth-limit.ts` still declares a structurally-identical `FragmentDepthMemo` and builds the memo inline twice, because a now-expired ruling froze that file. This task makes it the second consumer. It is small; do not expand it.

- [ ] **Step 1: Confirm the baseline is green and record it.** `npx vitest run graphql/depth-limit` → note the pass count. These tests are the verification instrument; they must not change.
- [ ] **Step 2: Replace the local type.** Delete `type FragmentDepthMemo = {…}` (`:87-91`); import and use `FragmentWalkMemo<number>` at the two reference sites (`:117` param, `:218` annotation). Keep the existing doc comment's *reasoning* — move any of it not already in `fragment-walk-memo.ts` there rather than deleting it.
- [ ] **Step 3: Replace both inline literals** with `createFragmentWalkMemo<number>(…)`: `:160-164` passes `() => {}` (measurement path, cycles ignored); `:218-221` passes the existing deduping `onCycle` closure verbatim — do not restructure it.
- [ ] **Step 4: Update `fragment-walk-memo.ts`'s doc comment.** It currently states depth-limit is "intentionally left untouched (query-cost-control ledger, 'CONTROLLER RULING')". That ruling expired when the plugin was rejected and `depth-limit.ts` became permanent. Rewrite to say both rules consume this module and why one implementation matters (the 2^N and cycle bugs it prevents).
- [ ] **Step 5: Verify by diff, not judgement.** `npx vitest run graphql/depth-limit graphql/cost-limit` — identical pass counts to Step 1, zero test-file edits (`git diff --stat` on both depth-limit test files must be empty). Then the linearity check on BOTH rules: a document with 30 nested/repeated fragments validates in single-digit ms through each. Report both timings.
- [ ] **Step 6: Seen-to-fail.** Remove the `inProgress` guard from the shared module → the cyclic-fragment tests in BOTH files must red (this is what proves both rules now share one guard). Restore; re-verify green.
- [ ] **Step 7:** Full suite + lint; SDL byte-identical. Commit `refactor(graphql): depth-limit consumes the shared fragment-walk memo`.

### Task 2: The calibration suite + CI job

**Files:**
- Create: `app/server/graphql/cost-calibration.test.ts`
- Modify: `app/server/graphql/cost-limit.test.ts` (move fixtures out; keep rule-behaviour tests)
- Modify: `app/server/package.json` (scripts), `.github/workflows/ci.yml`

**Interfaces:**
- Consumes: `measureOperationCost` (`cost-limit.ts`), the `accepts()`/`costOf()` helpers in `cost-limit.test.ts` — move or export them so both files use ONE implementation; say which you chose.
- Produces: `npm run test:cost -w app/server`; a CI job named `Cost calibration`.

**This task changes NO numbers.** It captures today's measurements as they stand. Task 3 moves numbers.

- [ ] **Step 1: Inventory the corpus.** List every fixture currently in `cost-limit.test.ts`, classified: legitimate-screen, near-future, attack (with its expected catcher), boundary. This inventory is the suite's contents — report it.
- [ ] **Step 2: Build the suite with three assertion groups.**
  - *Headroom*: for each legitimate/near-future fixture, `breadth ≤ 0.70 × BREADTH_BUDGET` AND `complexity ≤ 0.70 × COMPLEXITY_BUDGET`. **Expect failures at today's numbers** (the admin user list is at 75.3%) — that is the point; Task 3 fixes them. Mark those specific fixtures `.fails()` (vitest) or skip with an explicit `TODO(Task 3)` reason so the suite is green-but-honest at this commit, and Task 3 flips them on. Say which mechanism you used.
  - *Separation*: every attack fixture rejects, asserting its catcher (`QUERY_COMPLEXITY` / `QUERY_BREADTH` / both).
  - *Table*: emit `fixture → breadth / complexity / % of each budget` via a `console.table`-style report at suite end so it lands in CI logs and in a reviewer's diff.
  - Every fixture goes through the schema-validating `accepts()` path before measurement.
- [ ] **Step 3: Wire the script + CI.** `"test:cost": "vitest run graphql/cost-calibration"` in `app/server/package.json`; a sixth job in `.github/workflows/ci.yml` mirroring the existing `Server tests` job's shape (checkout, node, `npm ci`, then `npm run test:cost -w app/server`), named `Cost calibration`.
- [ ] **Step 4: DEMONSTRATE THE GUARDRAIL FAILING.** Add a deliberately over-70% legitimate fixture; run `npm run test:cost -w app/server`; confirm it FAILS with a message naming the fixture and its percentage; remove it. Paste the failure output in your report. A guardrail never seen to fail is not known to work.
- [ ] **Step 5:** Full suite + lint; SDL byte-identical. Commit `test(graphql): add the CI-enforced cost-calibration suite`.

### Task 3: Device multiplier + budget raise

**Files:**
- Modify: `app/server/graphql/cost-limit.ts` (`HOUSEHOLD_DEVICE_MULTIPLIER`, `COMPLEXITY_BUDGET` + their derivation comments)
- Modify: `app/server/graphql/cost-calibration.test.ts` (flip Task 2's deferred headroom assertions on)

**Order is binding: multiplier → re-measure → budget. Never the reverse.**

- [ ] **Step 1: Re-derive `HOUSEHOLD_DEVICE_MULTIPLIER`.** Currently 20. Read `viewer/model.ts:127-140`: for an admin caller `Viewer.devices` runs `device.findMany({ orderBy })` with **no `where`** — every device on the instance. At the 50-user scale `INSTANCE_USER_MULTIPLIER` already encodes, that is 60–120 devices. Choose a number, state the device count it encodes and the reasoning, and record what the effective limit was BEFORE (20).
- [ ] **Step 2: Re-measure everything** through the calibration suite. Report the full table: every legitimate fixture's new % of each budget, and every attack fixture's new score.
- [ ] **Step 3: Derive the budget.** `COMPLEXITY_BUDGET = worst_legit_complexity / 0.70`, rounded up to a round number. Put the arithmetic in the comment: worst legit fixture, its name, the division, the rounded result. Do NOT reference gap-to-attack.
- [ ] **Step 4: STOP CONDITION.** Re-run all attack fixtures at the new budget. If ANY crosses reject→accept, **stop and report** — that is where raising stops being free and needs a human ruling. Do not proceed past this step in that case.
- [ ] **Step 5: Flip the headroom assertions on.** Every fixture Task 2 deferred now asserts normally; the suite is green with no exclusions. If any legitimate fixture still exceeds 70%, the budget from Step 3 was mis-derived — recheck rather than adding an exclusion.
- [ ] **Step 6: Seen-to-fail.** Revert the multiplier to 20 → the device-touching fixtures' recorded percentages must change; confirm the suite's table reflects it. Restore.
- [ ] **Step 7:** Full suite + lint; SDL byte-identical. Commit `fix(graphql): re-derive device multiplier and raise complexity budget to 70% headroom`.

### Task 4: §Q's fragment + docs

**Files (docs, gitignored, no commit):**
- Modify: `docs/superpowers/specs/2026-07-30-graphql-server-design.md` (§Q), `docs/superpowers/specs/2026-08-03-cost-calibration-suite-design.md` (status)

- [ ] **Step 1: Print the `BookCard` fragment** inline in §Q — the exact fragment its worked numbers are measured against. Today a reader reconstructing it gets 18,503 instead of 24,203.
- [ ] **Step 2: Pin every §Q worked number** with a named fixture in `cost-calibration.test.ts`, so the doc's examples are generated-from-truth. Cross-reference each number to its fixture name.
- [ ] **Step 3: Point §Q at the suite** for the full table rather than restating figures that drift, and update every number §Q states to Task 3's post-raise values (budgets, percentages, the worked examples).
- [ ] **Step 4: Grep gate** across both specs: the old `COMPLEXITY_BUDGET` value, `HOUSEHOLD_DEVICE_MULTIPLIER`'s old 20, and any surviving "gap to nearest attack" phrasing — each survivor must be a correct historical reference. Report the table.
- [ ] **Step 5:** Suite + lint once, proving docs-only (`git status` clean of tracked changes). No commit.

---

## Definition of done

- Suite green (report final count vs 1928 base), lint clean, SDL byte-identical to `11c3a495`.
- `npm run test:cost -w app/server` passes with NO deferred/excluded headroom assertions.
- The CI job exists and has been demonstrated failing on an over-threshold fixture.
- One memoization implementation in the repo (grep proves no second `cache: new Map()` memo literal).
- Every §Q number traceable to a named fixture.
