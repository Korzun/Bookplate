# Prompt: put the GraphQL layer on the Pothos Prisma + Relay integrations

Written 2026-08-28. This is a **prerequisite** for the book-requests feature
(`2026-08-28-book-requests-design.md`) — the user wants it done before that work
starts.

Scope as written below is the **whole schema**, audit-first. The alternative
discussed but not chosen was to bound it to just the surface book-requests sits
on (the `Viewer.*` / `User.*` connections and the loaders `book/model.ts` uses);
narrowing means editing the "Current state" and Phase 1 sections only — the
invariants stay as they are.

Everything from the `#` heading down is the prompt itself, meant to be handed
over verbatim.

---

# Task: put the GraphQL layer on the Pothos Prisma + Relay integrations

Repo: Bookplate. Work in `app/server/graphql/`.

Read first, before writing anything:
  app/server/graphql/schema/builder.ts       (plugin set + ordering, and two
                                              plugins deliberately absent)
  app/server/graphql/to-result.ts            (the resolver error contract)
  app/server/graphql/schema/pagination.ts    (connection bounds, reject-not-clamp)
  app/server/services/README.md              (services layout after the store removal)

## Goal

Queries and mutations should be expressed through `@pothos/plugin-prisma` and
`@pothos/plugin-relay` — `builder.prismaNode` / `builder.prismaObject`,
`t.prismaField`, `t.prismaConnection`, `t.relatedConnection`, `t.relation`,
`t.relationCount`, and the relay plugin's own global-ID handling — instead of
hand-rolled Prisma calls, hand-built connection objects, hand-written cursors,
and request-scoped DataLoaders that duplicate what the plugin already does.

## Current state (verified at cd1f569b; counts exclude test files)

Already on the plugins: 57 `t.prismaField`, 9 `t.relatedConnection`,
5 `t.relationCount`, 3 `t.relation(`, 3 `builder.prismaNode`,
7 `builder.prismaObject`.

Deviations to examine:
  - `t.prismaConnection`: ZERO uses. Connections are hand-built via
    `builder.connectionObject` (`library/model.ts`, `series/model.ts`) over
    hand-written cursors (`library/entries-cursor.ts`,
    `utils/progress-pagination.ts`).
  - 20 manual `prisma.*.findMany/findUnique/findFirst/count` calls inside
    `schema/` — concentrated in `library/model.ts`, `viewer/model.ts`,
    `device/model.ts`, `scan-result/model.ts`. These bypass the Prisma
    plugin's query merging, so nested selections cost extra round trips.
  - 7 request-scoped DataLoaders in `graphql/*-loader.ts` (owner, progress,
    pending-fix, chapter-spine-map, series-progress, validation-counts,
    book-by-document), consumed mostly by `book/model.ts`. Several are
    per-parent lookups on relations that already exist in the Prisma schema,
    which `t.relation` / `t.relationCount` would fold into the parent query.
  - 16 `encodeGlobalID` / 6 `decodeGlobalID` hand calls.

## Phase 1 — audit. Deliverable is a written inventory, NOT code.

One row per deviation: `file:line`, what it does by hand, the plugin feature
that would replace it, and a convert / keep recommendation with the reason.
Cover all four categories above. Where the plugin genuinely cannot express
something, say so and why — a documented "keep" is a valid outcome and is
worth as much as a conversion.

Stop after the inventory and get it reviewed before converting anything.

## Phase 2 — convert in slices

One reviewable slice per commit, each green on its own. Prefer the slices the
audit rates highest-value / lowest-risk first.

## Invariants — do not break these. Each has a verified reason written in a
## code comment nearby; read the comment before concluding something is a bug.

1. Plugin order is `RelayPlugin, ScopeAuthPlugin, PrismaPlugin` and is
   load-bearing: relay must parse global IDs before `authScopes` runs, or
   `ownerOf` compares a base64 global ID against a database id and fails closed.
2. `Library` is a synthetic type over `{userId, username}`, NOT a Prisma model,
   so it cannot become a `prismaNode` and its connections cannot become
   `t.prismaConnection` rooted on it. `Library.entries` / `Library.progress`
   (and `Series.books`) are hand-declared over `connectionObject` specifically
   so the SDL omits `last`/`before` — that omission was a deliberate breaking
   change (commit e7f99557), not an oversight.

   > **CORRECTED, twice over, by the audit this brief produced** (see
   > `2026-08-29-pothos-prisma-relay-audit.md`, Category A). Two claims in this
   > invariant are false as stated:
   >
   > - **"its connections cannot become `t.prismaConnection` rooted on it"** —
   >   they can. `t.prismaConnection` is a FIELD builder; it roots on the node
   >   type, not on the parent, so a synthetic parent is no obstacle at all.
   >   `Library.progress` is one today.
   > - **`Series.books` is not hand-declared** — it is `t.relatedConnection` and
   >   offers `last`/`before`, as do `Validation.messages` and now
   >   `Library.progress`.
   >
   > What survives: `Library.entries` cannot be a `t.prismaConnection`, for a
   > reason this invariant never gives — its node type is the union
   > `LibraryEntry = Book | Series` over an interleaved two-table keyset, and
   > `t.prismaConnection` binds to one model. And `e7f99557` was a deliberate
   > decision, correctly recorded here; it was reversed for `Library.progress`
   > by an explicit ruling, because stating it as an invariant had made two
   > request-scoped loaders look permanent when they were a consequence of a
   > choice.
3. `@pothos/plugin-errors` and `@pothos/plugin-validation` were removed on
   purpose, with reasons in `builder.ts`. Do not re-add either.
4. The ~30 `builder.objectRef` types are error and payload shapes — plain data
   carrying a readonly `owner: Owner`, deliberately not classes. That is not a
   smell to convert; it is why plugin-errors cannot be used.
5. Resolver bodies contain no `try`, no `catch`, no `throw`. `toResult` is the
   single boundary that turns known domain errors into union members.
6. Reads live in the schema; writes live in `services/*.ts` as plain functions
   taking `prisma` as the first argument. Do not move writes into resolvers,
   and do not reintroduce injected store classes.
7. Import `../x/model`, never `../x`, inside model files — the entity index
   files side-effect-import mutations and close require cycles.

## Verification — all green before any slice is offered as done

  npm run lint                  # server lint includes tsc + graphql:schema:check
  npm test
  npm run test:cost -w app/server

`app/server/graphql/schema.generated.graphql` is checked in and asserted by
`print-schema.test.ts`. Any SDL change must be intentional, called out
explicitly in the slice's description, and the snapshot regenerated on purpose
via `npm run graphql:schema -w app/server`. A conversion that silently changes
the public schema is a failed conversion.

The cost budgets (breadth / complexity / depth, with calibration tests) price
fields statically. Converting a hand-built connection can move those numbers —
if a budget moves, report the before/after rather than adjusting the budget to
fit.

## Out of scope

- The raw `Prisma.sql` in `services/search-suggestions.ts`. Record in the audit
  whether the plugin could express it; do not convert it in this task.
- Adding plugins, changing auth scopes, or touching the REST seams in
  `routes/ui.ts`.
