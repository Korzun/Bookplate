# Query-Cost Control — Design

Status: **implemented**, 2026-08-03 (commits `8d28e3f7..63dce940`, suite 1927/1927 green,
lint clean, SDL byte-identical to base). See "Outcome" at the end of this doc for what shipped
vs. what this design originally proposed — Layer 2/3's plugin adoption (below) was NOT taken;
read the Outcome section before treating Layers 2–3's prose as a description of shipped
behavior.
Depends on: the pre-client polish pass (complete at `11c3a495`, suite 1810/1810).
Evidence: `.superpowers/sdd/2026-08-02-pre-client-polish/final-fix-re-review.md` (Part 2)
and the preserved reviews under `docs/superpowers/reviews/`.
Timing: before or alongside the Apollo client migration. Not a merge blocker for the
polish pass (no cost control existed at all before it), but the window it leaves open is
real and proven.

## The problem

Depth cannot express the property being defended — **response cost**. Proven by probe
against a 1,000-book library over real HTTP:

| Probe | Depth | Result |
|---|---|---|
| 3-hop cycle rooted at `Query.nodes(ids:)` | **12 — passes** | 1,354,081 objects, 80.7 MB, 8.2 s, from a 1,015-byte request (152× baseline) |
| 2-hop cycle via `LibraryEntry`'s Series arm | **12 — passes** | 3.5 MB, 368 ms (so 13 was never the amplification floor; the old corridor rested on a fixture artifact) |
| 2-hop cycle rooted at `Query.nodes(ids:)` | 8 | passes trivially |
| 200 aliased copies of the depth-6 calibration fixture | **6** | 61× baseline — depth is blind to breadth entirely |
| `Library.entries(first: 999999999)` | 6 | no connection carries `maxSize`/`defaultSize` |

**Threat model (user ruling): untrusted tenants.** Every one of these requires a valid
session (the query root is `authScopes: { authenticated: true }`, builder.ts:141), so this
is an authenticated-tenant DoS — but on a shared instance, one hostile or compromised
account degrading every other tenant is exactly the case to defend. Budgets are set
accordingly: tight, enforced, calibrated from measurement rather than generosity.

## Layer 1 — connection bounds (independent of everything else)

Explicit `maxSize` / `defaultSize` on every connection: `Library.entries`,
`Library.progress`, `Series.books`, `Validation.messages`. Plus a cap on the number of ids
`Query.nodes(ids:)` accepts.

Sizes derive from what the real screens request (the grid's page size, the detail views'
message lists) — measured, not invented; the implementer reads the client's current REST
pagination to source them, and records each number's origin. Over-max requests are
rejected with a clear error, not silently clamped: silent clamping makes a client's
pagination look broken instead of telling it what happened.

This layer alone kills the widest amplification and stands whether or not layer 2 lands.

## Layer 2 — a real cost model, plugin-first behind a vetting gate

**Not taken as designed — see "Outcome" below.** The vetting gate this section proposes ran
(Task 2) and REJECTED `@pothos/plugin-complexity`. Everything below this point in Layers 2–3
describes the plugin-adoption path that was evaluated and not shipped; it is kept as the
record of why the gate existed and what it checked, not as a description of the enforced
rule. The shipped rule is hand-rolled, per this plan's own documented fallback.

**Adopt `@pothos/plugin-complexity` (v4.2.1, zero dependencies, maintained by the Pothos
team) — but only after it passes an adversarial vetting task.** Our own hand-rolled depth
rule shipped two Criticals (exponential fragment re-expansion; cyclic-fragment stack
overflow → 500) that took two review rounds to fix; the same bug classes are exactly what
a third-party rule must be proven against before it becomes the control.

**Vetting gate (its own task, before adoption):**
- Fragment-walk cost: N nested/repeated fragments — timing curve must stay flat (our fix
  took N=24 from 4777 ms to 1.13 ms; the plugin must not reintroduce the curve).
- Cyclic and mutually-recursive fragments → clean validation error, never a throw/500.
- Alias fan-out: 200 aliased copies must be priced, not ignored (expected to be the
  `breadth` limit's job — confirm it fires).
- Limits enforced pre-execution: its docs state complexity is computed before any root
  field resolves — confirm empirically, don't take the doc's word.
- **Depth parity**: since the plugin takes over depth (Layer 3), its counting must be
  checked against `depth-limit.ts`'s committed fixtures — same rejections, same
  acceptances, or the number gets re-derived under its semantics.
- Error shape: what it emits, and whether it survives production masking.

**Documented fallback:** if the plugin fails any probe, hand-roll the complexity rule on
the same `addValidationRule` seam instead — the plugin is the default, not a commitment.
Either way the outcome is recorded in the spec with the probe evidence.

**The plugin enforces three independently-optional limits** (verified against its docs,
2026-08-02) — all computed before any root field resolves, i.e. the same validation-stage
guarantee our depth rule has:

```js
complexity: { limit: { complexity: 500, depth: 10, breadth: 50 } }   // each field optional
```

Each maps to a probe:
- **complexity** — field cost with args-aware multipliers
  (`complexity: (args, ctx) => ({ field: 5, multiplier: args.first ?? <default> })`), so
  connection-cycling is expensive *in the model*. Answers the 3-hop cycle.
- **breadth** — total selections in a query. **This is the direct control for the
  200-aliased-copies probe** (61× baseline at depth 6), which complexity multipliers would
  only price indirectly. Named as a first-class limit, not a side effect.
- **depth** — see Layer 3.

## Layer 3 — ONE depth enforcer, and it is the plugin

**Not taken — see "Outcome" below.** Task 2 rejected the plugin, so `depth-limit.ts` was
never deleted; `MAX_DEPTH` stays 12 and was never re-derived under a plugin's counting
semantics. This section is kept for the same reason as Layer 2 above: it explains the
decision structure the vetting gate resolved, not what shipped.

**Decision (explicit, because the naive reading of layers 2+3 gives two enforcers):** when
the plugin is adopted, it owns depth via `limit.depth`, and our hand-rolled
`depth-limit.ts` (plus its `addValidationRule` wiring) is **deleted**.

Two depth enforcers would mean two error shapes for the client to branch on, two numbers
to calibrate, and silent drift the first time someone updates one and not the other. A
second enforcer is only worth its liability if the plugin's implementation is unproven —
and the vetting gate exists precisely to remove that doubt. If the gate proves it safe,
redundancy buys nothing; if the gate fails it, we do not adopt the plugin at all.

**Fallback coherence:** if vetting fails, we keep `depth-limit.ts` AND hand-roll
complexity/breadth beside it on the same seam — one implementation family either way,
never a mix.

The depth number itself carries over as measured (`12`, legitimate max 11), re-verified
under the plugin's own counting semantics during calibration — a different implementation
may count fragment/inline-fragment levels differently, so the number is re-measured, not
assumed portable. The migration must show the plugin rejecting the same shapes
`depth-limit.ts` rejected and accepting the same shapes it accepted (the committed
fixtures make this a diff, not a judgement call).

## Calibration and rollout

1. **Log-only first.** The rule computes and logs cost for every operation without
   rejecting. This runs against the real test corpus and (if practical) a manual pass over
   the app, producing the actual cost distribution.
2. **Set budgets from measurement**, with the fixture set covering what the depth exercise
   missed: BOTH `LibraryEntry` union arms, the aliased/fragment-composed shapes Apollo
   generates, admin traversal, and the deepest detail views. The measured table goes in
   the spec so a future field addition forces re-measurement rather than assumed headroom.
3. **Flip to enforcing** with the budget + a stated margin. The margin is stated as a
   number with its reasoning, not "some headroom".

## Blast radius

The plugin's error shapes differ from the current hand-rolled rule's. Update together:
`content-negotiation.test.ts`, the operation-logging tests, and the Apollo handoff's
client-error-handling guidance. The handoff also gains a **"query budget"** section: the
ceiling, what blows it, and the shapes to avoid — client authors need this before they
write fragments, not after their query gets rejected.

## Testing

Every probe from the re-review becomes a committed regression test: the 3-hop
`nodes()`-rooted cycle, the Series-arm 2-hop variant, the 200-alias fan-out, and
`first: 999999999` — each asserting REJECTION with the right shape. Every real screen
query asserts ACCEPTANCE. Seen-to-fail on all of them (a test that cannot fail against a
disabled rule proves nothing — the lesson from this codebase's own history).

Plus the vetting-gate probes above, kept as tests if the plugin is adopted, so a plugin
upgrade can't silently reintroduce the bug classes.

## Out of scope

Persisted queries / operation allowlisting (a stronger control, but it belongs with the
client migration and presumes a frozen operation set); per-user rate limiting on
`/graphql` (different mechanism, different task); the 72KB parse-stage 500 (recorded debt,
bounded by the 100kb body cap).

## Delivery

One plan, roughly: (1) connection bounds + `nodes(ids:)` cap; (2) the plugin vetting gate
with its documented verdict (this task's outcome decides whether the rest is
plugin-shaped or hand-rolled — it gates the plan's remainder and its report must state
the verdict unambiguously); (3) the cost rule log-only + calibration across
complexity/breadth/depth; (4) enforcement + regression suite + `depth-limit.ts` removal
with fixture-parity proof; (5) docs — handoff query-budget section, spec status.
Subagent-driven execution with the usual review cadence.

## Outcome — implemented, do not re-litigate

*(Added 2026-08-03, Task 5; corrected 2026-08-03 by the plan's final fix wave.)* Commits
`8d28e3f7..63dce940` (Task 5), plus a final fix-wave commit correcting this section's own
numbers per a whole-branch independent review (`final-review.md`, findings I-1/I-2). Final
suite **1928/1928 green**, lint clean (both workspaces), SDL byte-identical to base throughout.
Full evidence for every claim below: `.superpowers/sdd/2026-08-02-query-cost-control/{progress.md,
task-1-report.md,task-2-report.md,task-3-report.md,task-4-report.md,final-review.md,
final-fix-report.md}` (gitignored, not committed).

**Layer 1 (connection bounds) shipped as designed.** `pagination.ts`'s `CONNECTION_LIMITS`:
`Library.entries` 100/20, `Library.progress` 100/50, `Series.books` 100/20,
`Validation.messages` 100/20 (maxSize/defaultSize), `Query.nodes(ids:)` capped at 100.
Every one of the four connections was ALREADY effectively bounded at these exact numbers by
`@pothos/plugin-prisma`'s own default clamp (or, for `Library.entries`/`Library.progress`, by
a pre-existing REST-derived resolver clamp) — the real change Task 1 made is CLAMP → REJECT,
not new numbers. Oversize `first`/`last` now gets `PAGE_SIZE_EXCEEDED`/400 instead of a
silently truncated page.

**Layer 2's plugin vetting gate ran and REJECTED `@pothos/plugin-complexity` v4.2.1
(Task 2).** It shipped both bug classes this codebase's own `depth-limit.ts` was fixed for,
plus a third the plan never anticipated:

1. **No fragment memo** — `complexityFromSelectionSet` re-walks a spread fragment's body once
   per occurrence, recursively: measured 2^N growth (67 ms at N=18, 3,551 ms at N=24,
   28,255 ms at N=27, ×7.9 per +3 fragments) against this codebase's own hand-rolled rule's
   flat 0.1–0.9 ms across the identical curve. Reachable through the plugin's OWN documented
   `wrapResolve` wiring over real HTTP too: a 1,142-byte authenticated POST blocked the event
   loop for 3,520 ms.
2. **No cycle guard** — three cyclic-fragment shapes each threw `RangeError: Maximum call
   stack size exceeded` out of `validate()` on the plugin's validation-rule seam (our own C-2
   bug, verbatim) — an uncaught exception, not a clean GraphQL error.
3. **A bug class this codebase never had:** an unknown field, a missing fragment definition,
   or an unknown type condition each throw `PothosValidationError` straight out of validation
   — i.e., **one ordinary client typo becomes an HTTP 500**, not a normal validation-error
   response.

Not adoptable at any configuration. The plugin install was reverted; no commit exists for it
(per the plan's own "a rejected plugin is not committed" rule). Full probe evidence:
`task-2-report.md`.

**Consequence for Layer 3: `depth-limit.ts` survives, untouched, and `MAX_DEPTH` stays 12.**
Because the plugin was rejected, there is no plugin-based depth limit to migrate to and
nothing to delete — `depth-limit.ts` and both its test files (`depth-limit.test.ts`,
`depth-limit-integration.test.ts`) are byte-identical to base across every commit in this
plan's range. `MAX_DEPTH = 12` was never re-derived (the plugin's own counting, measured as
exactly `+1` over this codebase's semantics on every fixture, is irrelevant once the plugin
isn't adopted). Task 4's "depth handover" step is accordingly a stated, explicit NO-OP, not a
silently skipped one.

**Layer 2's cost model was hand-rolled instead, on the existing `addValidationRule` seam**
(`cost-limit.ts`, Task 3 log-only → Task 4 enforcing), per the plan's own documented
fallback-coherence rule ("one implementation family, never a mix"). Shipped budgets:
`BREADTH_BUDGET = 100`, `COMPLEXITY_BUDGET = 30,000` — the complexity number has moved twice.
First, from an initial, miscalibrated **17,000** to **25,000** (Task 4's own fix round) after
independent review found the fixture that had set its floor was invalid GraphQL (selecting
connection-payload fields directly on a `*Connection` type instead of through `edges { node { …
} } }`); written correctly, that same shape measures 22,283, above 17,000, and 17,000 separately
rejected a shape Task 1's own limits explicitly permit (`entries(first: 100)`, complexity
19,103). Second, from **25,000 to 30,000** (the plan's final fix wave, `final-review.md` I-2)
after a whole-branch independent review measured a REAL admin screen — the admin user-list
traversal (`viewer { users { library { progress(first: 50) { … } } } } }`, the exact fields
`component/user-progress-row` renders) — at complexity 22,602, 91% of the then-25,000 budget and
present in no calibration table. The multiplier driving that screen's cost
(`INSTANCE_USER_MULTIPLIER = 50`, pricing `Viewer.users`/`Device.enabledUsers`) was re-examined
and KEPT — self-hosted Bookplate has no multi-tenancy, so 50 registered users is a deliberate,
generous ceiling for "how many people share one instance" (a household through a small reading
community), not an arbitrary guess to shrink — and the budget was raised instead, giving that
screen real headroom (75% of the new budget). Every committed attack fixture still rejects —
but note that no meaningful gap-to-attack margin exists in either direction: a constructible
complexity-only attack sits at 30,103, ~0.3% above the budget, just as one sat ~0% above the
previous 25,000. That is the documented overlap band, not a regression. Both budget raises were derived
from legit anchors (now 19,103 / 22,283 / 22,602 / a pre-existing 7,705 ACCEPT-asserting HTTP
fixture), never from "gap to nearest attack" reasoning, which was found unsound in both
directions during Task 4. Full derivation, including the client-facing cost MODEL (no fixed
"safe first" number, corrected away from an earlier unsafe one by this same fix wave) and the
catch-split table: `task-4-report.md` §1–2, `final-fix-report.md`; client-facing summary: the
Apollo handoff's §Q, `docs/superpowers/specs/2026-07-30-graphql-server-design.md`.

**Permanent carried debt: the fragment-walk memo is DUPLICATED, not extracted, by explicit
ruling.** `cost-limit.ts`'s `fragment-walk-memo.ts` (`FragmentWalkMemo<T>` + `resolveFragment`)
is a second, independent implementation of `depth-limit.ts`'s own `{cache, inProgress}` +
`onCycle` control flow, written fresh rather than imported. This plan's own standing
discipline ("shared guards are extracted, never copied") and its own binding constraint
("`depth-limit.ts` stays byte-identical to base") are mutually unsatisfiable within this
plan's scope — real extraction (editing `depth-limit.ts` to import a shared module) was never
possible here without touching the file the binding constraint forbids touching. `cost-limit.ts`
is the module's only consumer today. **A future fix to either walk's cycle-guard or memo
semantics must be mirrored into the other BY HAND, or the two will silently diverge** — closing
this properly (extracting for real, with `depth-limit.ts` importing the shared module and a
full re-test) is named debt for a future task, not attempted here. `isIntrospectionOnly` has
the identical duplication, for the identical reason.

Other carried debt, unchanged since Task 4 (full detail: `task-3-report.md` §7,
`task-4-report.md` §7): variable-valued `first`/`last`/`ids.length` are priced at worst-case
in the complexity walk, inflating logged complexity for variable-driven pagination vs. an
equivalent literal; one log line is emitted per `OperationDefinition` in a document, not per
executed operation; the `UNBOUNDED_LIST_FIELD_LIMITS` allow-list is hand-maintained, not
individually measured or automatically kept in sync with schema growth (`Book.lineage`'s own
per-book multiplier is likewise assumed, not measured — see `cost-limit.ts`); `Library.
searchSuggestions`'s safety rests on a SQL-layer `LIMIT` invisible to `cost-limit.ts`.
**`INSTANCE_USER_MULTIPLIER` is no longer open debt** — the final fix wave re-examined it
against a real screen that made it load-bearing (91% of budget), kept it at 50 with stated
deployment-size reasoning rather than a bare assumption, and permanently added that screen to
`cost-limit.test.ts`'s calibration table (`final-review.md`/`final-fix-report.md`, I-2).
`HOUSEHOLD_DEVICE_MULTIPLIER` (`Viewer.devices`, then 20) was not re-examined this round — it
measured only 9% of budget in Task 3's own calibration and nothing in this fix wave changed
that; still assumed, not measured, and worth revisiting if a future screen makes it
load-bearing the same way `INSTANCE_USER_MULTIPLIER` became. **Superseded 2026-08-03** by the
cost-calibration plan, which did exactly that revisiting: the constant is now
`INSTANCE_DEVICE_MULTIPLIER = 100` (renamed because the admin path is instance-wide, not
household-scoped — `Viewer.devices` runs `findMany` with no `where`). See
`2026-08-03-cost-calibration-suite-design.md`.
