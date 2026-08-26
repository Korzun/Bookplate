# Cost-Calibration Suite + Debt Cleanup — Design

Status: implemented, 2026-08-03 (commits `51ead6d0..71d9b7f7`; suite 1933/1933 +
`npm run test:cost -w app/server` 30/30, zero deferred/excluded assertions; lint clean; SDL
byte-identical throughout. Final numbers: `BREADTH_BUDGET` 100, `COMPLEXITY_BUDGET` 33,000
(30,000 → 33,000), `INSTANCE_USER_MULTIPLIER` 50 unchanged, `INSTANCE_DEVICE_MULTIPLIER` 100
(renamed from `HOUSEHOLD_DEVICE_MULTIPLIER`, 20 → 100). §5's worked numbers synced to §Q by
Task 4 — see that doc's "Query budget" section.)
Depends on: query-cost control (complete at `ee8b4a7c`, suite 1928/1928).
Timing: before the Apollo client migration — the calibration suite is what keeps the budgets
honest once client fragments start landing.

## User rulings

- **Headroom threshold: 70%** (not the 80% originally proposed). Consequence accepted below.
- **Resolution when real screens exceed it: raise the budget**, keeping
  `INSTANCE_USER_MULTIPLIER = 50` — it is a *security ceiling* sized to the supported
  instance, and shrinking it is the unsafe direction (final-review adjudication, endorsed).
- Deduplicate the fragment-walk memo now.
- Bake the measurements into a dedicated, CI-run suite.

## 1. The cost-calibration suite (the substantial piece)

**Problem it solves.** Today's fixtures live inside `cost-limit.test.ts` as accept/reject
assertions. That proves *behaviour* but not *headroom* — which is exactly how the admin user
list reached 91% of budget unnoticed, and how the depth limit shipped with a legitimate screen
sitting exactly on the wall (F-1). Both were caught by a human asking for a measurement, not
by a test.

**Shape.** A dedicated `app/server/graphql/cost-calibration.test.ts`, run by
`npm run test:cost -w app/server`, added to `.github/workflows/ci.yml` as a sixth job
alongside the existing `test:scripts` precedent. It owns the fixture corpus and asserts:

1. **Headroom** — every legitimate fixture stays **under 70%** of both budgets. Crossing it
   FAILS CI, so "one more field would reject this screen" surfaces on the PR that adds the
   field. This is the F-1 class converted into a test.
2. **Separation** — every attack fixture still rejects, and each asserts *which* budget
   catches it (the catch-split). A multiplier change that silently moves an attack from
   complexity-caught to admitted fails loudly rather than passing quietly.
3. **The table** — the suite prints `fixture → breadth / complexity / % of each budget`, so a
   reviewer sees drift in the diff instead of re-deriving it.

**Fixture provenance.** Every fixture is schema-validated via Task 4's `accepts()` mechanism
(`specifiedRules` before measurement) — an unsendable query can never define a number again,
which is how the 13,483 figure got into a budget derivation.

**Ownership.** Fixtures move here from `cost-limit.test.ts`; that file keeps rule-behaviour
unit tests (memoization, cycles, introspection exemption, arg pricing). One corpus, one place.

## 2. `HOUSEHOLD_DEVICE_MULTIPLIER` — re-derive

*(As shipped: renamed to `INSTANCE_DEVICE_MULTIPLIER` during implementation — Task 3,
task-3-review.md I-2 — and re-derived 20 → 100. This section is left as designed, describing the
pre-implementation name and value; it is a correct historical record of the task, not a current
claim about the constant's name.)*

Currently 20, inconsistent with the 50-user ceiling this system adopts: `Viewer.devices` runs
`device.findMany({ orderBy })` with **no `where`** for an admin caller
(`viewer/model.ts:127-140`), so it returns every device on the instance. At the supported
50-user scale that is 60–120 devices, not 20 — under-priced.

Re-derive from that reality, state the supported device count the number encodes, and
re-measure everything through the new suite.

## 3. Budget raise to satisfy 70%

Adopting 70% means today's admin user list (75.3%) and any screen the new device multiplier
pushes up must come under the line. Per the ruling: **raise `COMPLEXITY_BUDGET`**, do not
shrink the multipliers.

Procedure, in this order (order matters — the budget is derived from measurements, never the
reverse):
1. Land the device multiplier (§2).
2. Re-measure every legitimate fixture through the suite.
3. Set `COMPLEXITY_BUDGET` = whatever puts the worst legitimate fixture at **≤ 70%**, stated
   as `worst_legit / 0.70` rounded to a round number, with the arithmetic in the comment.
4. Re-run all 12 attack fixtures. **Every one must still reject.** If any crosses
   reject→accept, STOP and report — that is the point where raising the budget stops being
   free and the trade needs a human ruling.

**Acknowledged cost, stated plainly:** raising the budget widens the overlap band with
bounded-cost attack shapes. That band is already documented as the region Task 1's per-hop row
caps make acceptable — the cost rule was never separating it, and a constructible
complexity-only attack already sits ~0.3% above the current budget. The raise makes an
existing, documented property slightly larger; it does not create a new one. `BREADTH_BUDGET`
stays 100 unless a measurement says otherwise.

## 4. Deduplicate the fragment-walk memo

`{cache, inProgress}` — the memoization that makes both rules linear instead of 2^N, i.e. the
exact bug class `@pothos/plugin-complexity` was rejected for — currently exists twice
(`depth-limit.ts` and `cost-limit.ts`). The duplication came from a ruling that has expired:
`depth-limit.ts` was required to stay byte-identical because Task 2 might have adopted the
plugin and deleted it. The plugin was rejected; the file is permanent; the constraint is gone.

Extract into one module both rules import. Verification is a diff, not a judgement:
`depth-limit.ts`'s committed fixtures must produce identical accept/reject verdicts before and
after, and the N=30 linearity check must pass for **both** rules. The ledger's
mirror-your-changes note is deleted along with the hazard.

## 5. §Q's worked numbers

The spec's §Q measures its worked examples against a `BookCard` fragment it never prints, so a
reader reconstructing it gets 18,503 instead of 24,203. Fix: print the fragment inline, and
pin every worked number with a fixture in the new suite so the doc's examples are
generated-from-truth rather than transcribed. §Q then points at the suite for the full table
instead of restating figures that drift.

## Out of scope (documented, unchanged)

Scalar-list fields priced 1 (breadth catches the alias family at ≥120; complexity is blind by
design); the overlap band itself; the deliberately non-coextensive validation and resolver
layers.

## Testing

The suite IS the test deliverable. Beyond it: the memo extraction is verified by
`depth-limit.ts`'s existing fixtures plus both linearity checks; the CI job must be
demonstrated failing (introduce a fixture over 70%, watch it red, remove it) — a guardrail
never seen to fail is not known to work.

## Delivery

One plan, roughly: (1) memo extraction (isolated, verifiable, no numbers move);
(2) the calibration suite with today's numbers + CI wiring, including the seen-to-fail
demonstration; (3) device multiplier + budget raise, measured through the suite;
(4) §Q + spec/ledger updates. Subagent-driven, usual review cadence.
