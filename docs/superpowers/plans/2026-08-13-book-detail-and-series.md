# Step 6 — Book detail + `/library/series/:name` Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Move `/library/series/:name` and the book detail page entirely onto GraphQL, closing the
`Validation.counts` server gap and the raw-id/global-ID seam that the surviving REST children
would otherwise fall into.

**Architecture:** Two server sub-tasks first (a batched `Validation.counts` field; extending
step 5's `resolveBookLocalId` decoding to the `/api/books/:id/*` routes that survive this step),
then series, then book detail. Every client screen roots at `node(id: $libraryId) { ... on Library }`
— never `viewer.library` — per spec §2's rooting decision. Mutations get hand-written cache
updates, each demonstrated failing without its update function.

**Tech Stack:** graphql-yoga + Pothos v4 + Prisma (server); Apollo Client v4 + `client-preset`
codegen with **fragment masking ON** (client); vitest + `@testing-library/react` both sides.

## Global Constraints

- **Base:** `ebc6ae53`. Server 1977/1977, client 1107/1107, lint + codegen clean, `test:cost` 33/33.
- **The client never decodes a global ID.** Raw ids are resolved server-side, always.
- **Fragment masking is ON — but COMPILE-TIME ONLY.** (Established during execution, Task 5.)
  Every shared fragment needs `useFragment` at each consumption site, planned per site.
  `useFragment` is a generated *identity cast*, not a React hook — it may be called conditionally
  or on a possibly-`undefined` value. Critically: `FragmentType` is a **type-only** marker
  (`{ ' $fragmentRefs'?: … }` in `gql/fragment-masking.ts`) and this app never enables Apollo's
  real `dataMasking` option, so **masked data is NOT stripped at runtime** — every field is present
  on the object. Any test asserting `expect(x).not.toHaveProperty('title')` to "prove masking" is
  asserting a falsehood and will fail. Prove masking at the TYPE level instead (`@ts-expect-error`
  on a property access, which `tsc --noEmit` enforces), and assert runtime *data integrity*
  separately.
- **Root at `node(id: $libraryId)`**, selecting `id` on `Node` *and* on the inline fragment.
- **Every shipped operation stays under 70% of both cost budgets** (BREADTH 100, COMPLEXITY 33,000 — verified against `cost-limit.ts`; an earlier draft of this plan said 30,000, which was stale).
  Measure with `costOf()` from `app/server/graphql/cost-test-support.ts`.
- **Loaders capture `reject` and wrap query + grouping in try/catch.** A loader that only captures
  `resolve` hangs the request on a DB error. That bug shipped once here (`progress-loader`).
- **Connections reject, never clamp** oversize pages.
- **Seen-to-fail is mandatory** for every property-protecting test: watch it fail for the right
  reason before making it pass, and re-run it at the branch tip in the final task.
- **Verify against code, never transcribe from docs.** Where this plan and the code disagree, the
  code wins and this plan gets corrected in place.
- Commands: `npm run test -w app/server`, `npm run test -w app/client`, `npm run test:cost -w app/server`,
  `npm run lint` (root), `npm run codegen -w app/client` (WRITES `src/gql/`), `npm run lint -w app/client` (freshness-CHECKS it via `codegen:check` — it never writes).

## User rulings carried into this plan

1. **The validation-counts gap is closed server-side** (spec §1), not by client tallying.
2. **Series first, then book detail**, in one plan (spec §1).
3. **The raw-id seam is closed by extending server-side global-ID decoding** (2026-08-13). The
   client never holds a raw book id. Rejected: adding `Book.documentId` to the schema; pulling
   steps 8/9 forward.

## Correction to the spec, to be applied in Task 13

Spec §2 says the series hooks collapse "into Apollo hooks over `seriesByName` and `Series.books`".
`seriesByName` is **not** a `Query` root field — it is `Library.seriesByName(name: String!): Series`
(`app/server/graphql/schema.generated.graphql`). The rooting stays `node(id: $libraryId)` like every
other library-scoped screen. Fix that sentence in the spec when the plan completes.

## File Structure

**Server — create:**
- `app/server/graphql/validation-counts-loader.ts` — request-scoped batching loader.
- `app/server/graphql/validation-counts-loader.test.ts`
- `app/server/graphql/schema/validation-severity-count/model.ts` — the `ValidationSeverityCount` object.

**Server — modify:**
- `app/server/graphql/context.ts` — wire `loadValidationCounts`.
- `app/server/graphql/schema/validation/model.ts` — add `counts`.
- `app/server/graphql/schema/index.ts` — register the new model.
- `app/server/graphql/schema.generated.graphql` — regenerated, committed.
- `app/server/routes/ui.ts` — extend `resolveBookLocalId` to six surviving routes.
- `app/server/routes/ui.*.test.ts` — route coverage.

**Client — create:**
- `app/client/src/graphql/series.ts` — `SeriesDetail` document + `SeriesBookRowFragment`.
- `app/client/src/graphql/book.ts` — `BookDetail` document, its fragments, and the five mutations.
- `app/client/src/provider/library/hook/use-series-detail.ts` (+ test)
- `app/client/src/provider/book/hook/use-book-detail.ts` (+ test)
- `app/client/src/component/book-row/from-series-book.tsx` (+ test)

**Client — modify:** `page/series/index.tsx`, `page/book/index.tsx`,
`control/book-lineage-modal/index.tsx`, `control/unlink-book-lineage-button/index.tsx`, and the six
book hooks listed in the surface map.

**Client — delete:** `component/book-row/from-book.tsx` (+ its test),
`provider/book/hook/use-series.ts`, `use-series-book-list.ts` *(only if Task 13 confirms no
surviving caller)*, `use-book-lineage.ts`, `use-unlink-book-lineage.ts`.

**Evidence:** `docs/superpowers/notes/2026-08-13-step6-surface-map.md` — the regenerated surface
map (the spec's `scratchpad/` copy was lost with its session; this replacement lives under `docs/`
so it survives).

---

## Task 1: `ValidationSeverityCount` and the batching loader

**Files:**
- Create: `app/server/graphql/validation-counts-loader.ts`
- Test: `app/server/graphql/validation-counts-loader.test.ts`

**Interfaces:**
- Consumes: `PrismaClient`.
- Produces: `createValidationCountsLoader(prisma: PrismaClient): ValidationCountsLoader`, where
  `ValidationCountsLoader = (userId: string, bookId: string) => Promise<SeverityCount[]>` and
  `SeverityCount = { severity: string; count: number }`. Zero-count severities are **omitted**.

- [ ] **Step 1: Write the failing tests**

```ts
// app/server/graphql/validation-counts-loader.test.ts
import { describe, expect, it, vi } from 'vitest';

import { createValidationCountsLoader } from './validation-counts-loader';

type GroupRow = { userId: string; bookId: string; severity: string; _count: { _all: number } };

const prismaWith = (rows: GroupRow[], groupBy = vi.fn().mockResolvedValue(rows)) => ({
  prisma: { validationMessage: { groupBy } } as never,
  groupBy,
});

describe('createValidationCountsLoader', () => {
  it('batches every pending lookup into ONE groupBy call', async () => {
    const { prisma, groupBy } = prismaWith([
      { userId: 'u1', bookId: 'b1', severity: 'ERROR', _count: { _all: 2 } },
      { userId: 'u1', bookId: 'b2', severity: 'WARNING', _count: { _all: 5 } },
    ]);
    const load = createValidationCountsLoader(prisma);

    const [first, second] = await Promise.all([load('u1', 'b1'), load('u1', 'b2')]);

    expect(groupBy).toHaveBeenCalledTimes(1);
    expect(first).toEqual([{ severity: 'ERROR', count: 2 }]);
    expect(second).toEqual([{ severity: 'WARNING', count: 5 }]);
  });

  it('omits zero-count severities rather than reporting them as 0', async () => {
    const { prisma } = prismaWith([
      { userId: 'u1', bookId: 'b1', severity: 'FATAL', _count: { _all: 1 } },
    ]);
    const load = createValidationCountsLoader(prisma);

    const counts = await load('u1', 'b1');

    expect(counts).toEqual([{ severity: 'FATAL', count: 1 }]);
    expect(counts.map((c) => c.severity)).not.toContain('ERROR');
  });

  it('resolves an empty list for a book with no messages', async () => {
    const { prisma } = prismaWith([]);
    const load = createValidationCountsLoader(prisma);

    await expect(load('u1', 'b1')).resolves.toEqual([]);
  });

  it('scopes by (userId, bookId) PAIRS, never a bare bookId IN (...)', async () => {
    const { prisma, groupBy } = prismaWith([]);
    const load = createValidationCountsLoader(prisma);

    await Promise.all([load('u1', 'b1'), load('u2', 'b1')]);

    const where = groupBy.mock.calls[0][0].where as { OR: unknown[] };
    expect(where.OR).toEqual([
      { userId: 'u1', bookId: 'b1' },
      { userId: 'u2', bookId: 'b1' },
    ]);
  });

  it('REJECTS every pending lookup when the query throws — never hangs the request', async () => {
    const groupBy = vi.fn().mockRejectedValue(new Error('db down'));
    const load = createValidationCountsLoader({ validationMessage: { groupBy } } as never);

    await expect(Promise.all([load('u1', 'b1'), load('u1', 'b2')])).rejects.toThrow('db down');
  });

  it('memoizes per key: a repeat lookup issues no second query', async () => {
    const { prisma, groupBy } = prismaWith([
      { userId: 'u1', bookId: 'b1', severity: 'INFO', _count: { _all: 3 } },
    ]);
    const load = createValidationCountsLoader(prisma);

    await load('u1', 'b1');
    await load('u1', 'b1');

    expect(groupBy).toHaveBeenCalledTimes(1);
  });
});
```

- [ ] **Step 2: Run the tests and confirm they fail**

Run: `npm run test -w app/server -- validation-counts-loader`
Expected: FAIL — `Failed to resolve import "./validation-counts-loader"`.

- [ ] **Step 3: Implement the loader**

```ts
// app/server/graphql/validation-counts-loader.ts
import type { PrismaClient } from '@prisma/client';

export type SeverityCount = { severity: string; count: number };
export type ValidationCountsLoader = (userId: string, bookId: string) => Promise<SeverityCount[]>;

type PendingLookup = {
  userId: string;
  bookId: string;
  resolve: (value: SeverityCount[]) => void;
  reject: (err: unknown) => void;
};

/**
 * Batches `Validation.counts` lookups for the life of one request, so a page
 * of N books each resolving the field issues ONE `groupBy` rather than N
 * COUNTs. Same shape as `createProgressLoader`/`createPendingFixLoader`/
 * `createSeriesProgressLoader` — see `series-progress-loader.ts`'s doc comment
 * for the fuller rationale on why per-key memoization alone would not collapse
 * N different keys into one query.
 *
 * Batched by `(userId, bookId)` PAIRS, not a bare `bookId IN (...)`: a book's
 * raw id is a content hash and the same file imported by two users yields the
 * SAME id under different `userId`s (`@@id([userId, bookId])` on
 * `ValidationMessage`), so a bare `bookId` filter would cross tenants.
 *
 * ZERO-COUNT SEVERITIES ARE OMITTED, mirroring REST exactly: `epub-validator.ts`
 * only ever populates `counts[s]` when a message of that severity exists, and
 * `ValidationDetailModal` renders the same summary either way.
 *
 * `flush` wraps BOTH the query and the grouping in one try/catch and settles
 * every pending lookup on failure. A loader that captures only `resolve` leaves
 * unsettled promises that hang the whole request instead of surfacing a GraphQL
 * error — the exact bug `progress-loader` shipped once.
 */
export const createValidationCountsLoader = (prisma: PrismaClient): ValidationCountsLoader => {
  const cache = new Map<string, Map<string, Promise<SeverityCount[]>>>();
  let pending: PendingLookup[] = [];
  let flushScheduled = false;

  const flush = async (): Promise<void> => {
    const batch = pending;
    pending = [];
    flushScheduled = false;

    try {
      const rows = await prisma.validationMessage.groupBy({
        by: ['userId', 'bookId', 'severity'],
        where: { OR: batch.map(({ userId, bookId }) => ({ userId, bookId })) },
        _count: { _all: true },
      });

      const countsByUser = new Map<string, Map<string, SeverityCount[]>>();
      for (const row of rows) {
        const byBook = countsByUser.get(row.userId) ?? new Map<string, SeverityCount[]>();
        byBook.set(row.bookId, [
          ...(byBook.get(row.bookId) ?? []),
          { severity: row.severity, count: row._count._all },
        ]);
        countsByUser.set(row.userId, byBook);
      }

      for (const lookup of batch) {
        lookup.resolve(countsByUser.get(lookup.userId)?.get(lookup.bookId) ?? []);
      }
    } catch (err) {
      for (const lookup of batch) lookup.reject(err);
    }
  };

  return (userId: string, bookId: string): Promise<SeverityCount[]> => {
    const byBookId = cache.get(userId) ?? new Map<string, Promise<SeverityCount[]>>();
    cache.set(userId, byBookId);

    const cached = byBookId.get(bookId);
    if (cached !== undefined) return cached;

    const result = new Promise<SeverityCount[]>((resolve, reject) => {
      pending.push({ userId, bookId, resolve, reject });
      if (!flushScheduled) {
        flushScheduled = true;
        queueMicrotask(() => void flush());
      }
    });
    byBookId.set(bookId, result);
    return result;
  };
};
```

- [ ] **Step 4: Run the tests and confirm they pass**

Run: `npm run test -w app/server -- validation-counts-loader`
Expected: PASS, 6/6.

- [ ] **Step 5: Prove the reject path is load-bearing**

Temporarily change `catch { for (const l of batch) l.reject(err) }` to a bare `catch {}` and re-run.
Expected: the "REJECTS every pending lookup" test **times out** (it does not merely fail an
assertion) — that timeout is the hang this discipline exists to prevent. Restore the `catch`.

- [ ] **Step 6: Commit**

```bash
git add app/server/graphql/validation-counts-loader.ts app/server/graphql/validation-counts-loader.test.ts
git commit -m "feat(server): add a request-scoped batching loader for validation severity counts"
```

---

## Task 2: `Validation.counts` on the schema

**Files:**
- Create: `app/server/graphql/schema/validation-severity-count/model.ts`, `.../index.ts`
- Modify: `app/server/graphql/context.ts`, `app/server/graphql/schema/validation/model.ts`,
  `app/server/graphql/schema/index.ts`, `app/server/graphql/schema.generated.graphql`
- Test: `app/server/graphql/schema/validation/model.test.ts`

**Interfaces:**
- Consumes: `createValidationCountsLoader` from Task 1.
- Produces: `context.loadValidationCounts(userId, bookId)`; SDL
  `ValidationSeverityCount { severity: ValidationSeverity!, count: Int! }` and
  `Validation.counts: [ValidationSeverityCount!]!`.

- [ ] **Step 1: Write the failing schema test**

Append to `app/server/graphql/schema/validation/model.test.ts` (follow the file's existing harness
for building a schema + seeding Prisma; read it first rather than inventing a new one):

```ts
it('reports one entry per severity present, omitting severities with no messages', async () => {
  // seed: a book whose validation has 2 ERROR and 1 WARNING message
  const result = await execute(`
    query {
      node(id: "${libraryGlobalId}") {
        id
        ... on Library {
          id
          book(id: "${bookGlobalId}") {
            id
            validation { id counts { severity count } }
          }
        }
      }
    }
  `);

  expect(result.errors).toBeUndefined();
  const counts = result.data.node.book.validation.counts as Array<{
    severity: string;
    count: number;
  }>;
  expect(counts).toHaveLength(2);
  expect(counts).toEqual(
    expect.arrayContaining([
      { severity: 'ERROR', count: 2 },
      { severity: 'WARNING', count: 1 },
    ])
  );
  expect(counts.map((c) => c.severity)).not.toContain('INFO');
});

it('resolves an empty list for a validation with no messages', async () => {
  const result = await execute(/* same query against a clean book */);
  expect(result.data.node.book.validation.counts).toEqual([]);
});

it('does not fire one query per book across a page of books', async () => {
  // seed three validated books; spy on prisma.validationMessage.groupBy
  await execute(/* Library.entries selecting validation { counts { severity count } } per book */);
  expect(groupBySpy).toHaveBeenCalledTimes(1);
});
```

- [ ] **Step 2: Run and confirm failure**

Run: `npm run test -w app/server -- schema/validation`
Expected: FAIL — `Cannot query field "counts" on type "Validation"`.

- [ ] **Step 3: Add the object type**

```ts
// app/server/graphql/schema/validation-severity-count/model.ts
import type { Severity } from '@korzun/epubcheck-ts';

import { builder } from '../builder';
import { model as validationSeverity } from '../validation-severity';

export type ValidationSeverityCountShape = { severity: string; count: number };

/**
 * A LIST of {severity, count}, not an object with one field per severity.
 * Five severities exist today; an object shape would duplicate the enum in a
 * second place, so a sixth would require changing two things and would be
 * invisible to any client not rebuilt. The list stays correct automatically
 * and matches how `ValidationDetailModal` actually renders — iterating
 * severities in `SEVERITY_ORDER`.
 *
 * Severities with no messages are OMITTED, not reported as 0 — see
 * `validation-counts-loader.ts` for why that mirrors REST exactly.
 */
export const model = builder
  .objectRef<ValidationSeverityCountShape>('ValidationSeverityCount')
  .implement({
    fields: (t) => ({
      severity: t.field({
        type: validationSeverity,
        resolve: (row) => row.severity as never,
      }),
      count: t.exposeInt('count'),
    }),
  });
```

Add `export { model } from './model';` in that directory's `index.ts`, matching how the sibling
`validation-message/` directory is structured (read it first).

- [ ] **Step 4: Wire the loader into the context**

In `app/server/graphql/context.ts`, mirror the five existing loaders exactly:

```ts
import { createValidationCountsLoader, type ValidationCountsLoader } from './validation-counts-loader';
// … in the context type:
  loadValidationCounts: ValidationCountsLoader;
// … in the factory:
    loadValidationCounts: createValidationCountsLoader(deps.prisma),
```

- [ ] **Step 5: Add the field**

In `app/server/graphql/schema/validation/model.ts`, add the import alongside the existing
`validation-threshold` one:

```ts
import { model as validationSeverityCount } from '../validation-severity-count';
```

then inside `fields`, after `validatedAt`:

```ts
    /**
     * Per-severity message tallies. Resolved through
     * `context.loadValidationCounts` (`validation-counts-loader.ts`), a
     * request-scoped batching loader — NOT a per-parent COUNT, which would be
     * an N+1 across a page of up to 100 books (`Library.entries`,
     * `CONNECTION_LIMITS.libraryEntries.maxSize`). Same precedent as
     * `Series.progressPercentage`.
     *
     * Exists because `messages` is a connection capped at 100: a client tally
     * is wrong-by-construction for any book with more than 100 messages, and
     * costs extra round trips and query budget besides. `ValidationDetailModal`
     * has rendered this summary since long before GraphQL.
     *
     * `validation.userId`/`.bookId` read straight off this row, never off
     * `context.viewer` — see `id`'s doc comment above for why that matters
     * under admin traversal.
     */
    counts: t.field({
      type: [validationSeverityCount],
      resolve: (validation, _args, context) =>
        context.loadValidationCounts(validation.userId, validation.bookId),
    }),
```

- [ ] **Step 6: Register the model and regenerate the SDL**

Add the new directory to `app/server/graphql/schema/index.ts` alongside its siblings, then:

```bash
npm run graphql:schema -w app/server
```

This regenerates `schema.generated.graphql`. (Corrected during execution: the plan originally said
`npm run test -w app/server -- print-schema`, which only *checks* the committed SDL against the
built schema — it never rewrites the file. `graphql:schema` is the writer; the `print-schema` test
is the freshness gate that fails until you have run it.) **While the schema is open, fold in §14.8's parked
one-phrase fix** to `Progress.id`'s description — "…(to their owning `Book`)" after the
`PendingFix.id`/`Validation.id` citation — which the spec asked for "whenever the schema is next
regenerated". Regenerate again after editing the description.

- [ ] **Step 7: Run the tests and confirm they pass**

Run: `npm run test -w app/server` — expected: all green, count risen from 1977.
Run: `npm run test:cost -w app/server` — expected: 33/33 still green (no client document uses the
new field yet).

- [ ] **Step 8: Commit**

```bash
git add app/server/graphql app/server/graphql/schema.generated.graphql
git commit -m "feat(server): add Validation.counts, a batched per-severity tally"
```

---

## Task 3: The surviving REST routes accept a Relay global ID

**Files:**
- Modify: `app/server/routes/ui.ts`
- Test: the existing `app/server/routes/ui.*.test.ts` files (find the one already covering task
  13's five routes and extend it — do not create a parallel harness)

**Interfaces:**
- Consumes: `resolveBookLocalId(owner, rawId)` at `app/server/routes/ui.ts:491` — unchanged.
- Produces: six more routes that accept either id form.

**Seventh route, added during execution (2026-08-13, human ruling).** The plan's list named only
`DELETE /api/books/:id/pending-fixes`, but `putPendingFix` and `deletePendingFix` are siblings in
`provider/upload/api.ts`, both keyed by book id and called from the same place. Decoding one and
not the other splits the pair — and `putPendingFix` **swallows its errors by design** (best-effort
state sync), so an undecoded 404 there is silent: pending-fix state simply never syncs, with
nothing surfacing. Two of the original list's method labels were also wrong and are corrected
above (`pending-fixes` is `DELETE`, not `GET`; `cover` is `GET`, not `POST`).

**Why this task exists:** once `page/book` reads GraphQL, the only identifier it holds is a global
ID, and these routes are reached with it by children that stay REST until steps 7–9. Without
this, "Edit metadata", "Replace file", and "Set progress" all 404 the moment Task 9 lands. This is
the same mechanism step 5 authorized for the first five routes — extended, not re-invented.

- [ ] **Step 1: Write the failing route tests**

For each of the six routes, one test asserting a global ID resolves and one asserting a
cross-tenant global ID 404s. Model them on the existing task-13 tests. The six:

| Route | Handler line (at `ebc6ae53`) |
|---|---|
| `DELETE /api/books/:id/pending-fixes` | 1132 |
| `PUT /api/books/:id/pending-fixes` | 1128 (added during execution — see below) |
| `GET /api/books/:id/cover` | 1251 |
| `PATCH /api/books/:id/metadata` | 1456 |
| `POST /api/books/:id/replace/analyze` | 1765 |
| `POST /api/books/:id/replace` | 1805 |
| `PUT /api/my/progress/:document` | (progress route; see Step 3) |

```ts
it('PATCH /api/books/:id/metadata accepts a Relay global id', async () => {
  const globalId = encodeGlobalID('Book', JSON.stringify([owner.userId, book.id]));
  const res = await request(app)
    .patch(`/api/books/${encodeURIComponent(globalId)}/metadata`)
    .set('Authorization', `Bearer ${token}`)
    .send({ title: 'Renamed' });

  expect(res.status).toBe(200);
  expect(res.body.title).toBe('Renamed');
});

it('PATCH /api/books/:id/metadata 404s on another tenant’s global id', async () => {
  const foreignId = encodeGlobalID('Book', JSON.stringify([otherUser.userId, book.id]));
  const res = await request(app)
    .patch(`/api/books/${encodeURIComponent(foreignId)}/metadata`)
    .set('Authorization', `Bearer ${token}`)
    .send({ title: 'Renamed' });

  expect(res.status).toBe(404);
});
```

- [ ] **Step 2: Run and confirm failure**

Run: `npm run test -w app/server -- routes/ui`
Expected: FAIL — the global-id requests 404 (the raw handler treats the encoded string as a
content hash and finds nothing).

- [ ] **Step 3: Apply the existing helper at each site**

In each of the five `/api/books/:id/*` handlers, replace the direct `req.params.id` use with the
same three lines the task-13 routes already carry:

```ts
      const bookId = resolveBookLocalId(owner, req.params.id);
      if (bookId === null) {
        res.status(404).json({ error: 'Book not found' });
        return;
      }
```

then pass `bookId` onward instead of `req.params.id`.

`PUT /api/my/progress/:document` is different and needs its own care: its param is a KOReader
**document** id, not a book id, and a progress row may legitimately exist for a document with no
`Book` row (an e-reader syncing a book outside the library). So decode **permissively** — resolve a
Book global ID to its raw id, and pass anything else through untouched, which is exactly what
`resolveBookLocalId` already does for a non-global-ID input (it returns `rawId` on a decode
failure or a non-`Book` typename). The only behavioural change is that a *cross-tenant* Book global
ID now 404s instead of creating a stray progress row under a hash nobody owns. Apply the same
change to the sibling `DELETE` route if one exists — check.

- [ ] **Step 4: Run and confirm they pass**

Run: `npm run test -w app/server -- routes/ui`
Expected: PASS.

- [ ] **Step 5: Guard against regression on the untouched routes**

Add one test asserting a **raw** id still works on each of the six — the whole point is "either
form", not "global ID only". Existing raw-id tests may already cover this; if so, note that in the
commit message instead of duplicating them.

- [ ] **Step 6: Run the full server suite and commit**

```bash
npm run test -w app/server
git add app/server/routes
git commit -m "feat(server): accept a Relay global ID on the six book routes that outlive step 6"
```

---

## Task 4: Measure the two documents BEFORE building on them

**Files:**
- Create: `app/client/src/graphql/series.ts`, `app/client/src/graphql/book.ts`
- Modify: `app/server/graphql/client-operations-cost.test.ts` (it reads the manifest; no edit
  needed unless it pins a document count — check)

**Interfaces:**
- Produces: `SeriesDetailDocument`, `SeriesBookRowFragment`, `BookDetailDocument`,
  `BookDetailFragment`, `ValidationFragment`, `LineageEntryFragment`.

**Why first:** spec §7 — "Measure the book-detail query against the budget EARLY, not at review."
It is the richest document this migration has produced and the admin user-list screen already sits
at 68.5%. Discovering an over-budget document after three tasks of UI work is expensive.

- [ ] **Step 1: Write the series document**

```ts
// app/client/src/graphql/series.ts
import { graphql } from '~/gql';

/**
 * One row of the series' book list. Deliberately NOT `BookRowFragment`
 * (`graphql/library.ts`): that one selects `thumbnailUrl(width: 88)` for the
 * grid and is spread inside the `LibraryEntry` union, where `Series`'s own
 * fields sit beside it. This is a plain `Series.books` edge — no union, no
 * collision — and the series page shows no author per row (`showAuthor={false}`),
 * so `author` is dropped.
 */
export const SeriesBookRowFragment = graphql(`
  fragment SeriesBookRowFragment on Book {
    id
    title
    seriesIndex
    hasCover
    thumbnailUrl(width: 88)
    progress {
      id
      percentage
    }
  }
`);

/**
 * Rooted at `node(id: $libraryId)` like every library-scoped screen (spec §2):
 * `Query.user(id:)` is admin-only and `viewer.library` is null for the
 * config-based admin, so `node(id:)` is the only single root serving both roles.
 *
 * `books(first: 100)` is a LITERAL page size, priced at 100 rather than the
 * `maxSize` a variable `$first` would price at — identical to
 * `SeriesRowFragment`'s `books(first: 3)` in `graphql/library.ts`. 100 matches
 * `CONNECTION_LIMITS.seriesBooks.maxSize` and the `MAX_TAKE` the REST hook this
 * replaces used, so a >100-book series truncates exactly as it did before; that
 * is a carried limitation, not a new one.
 *
 * `progressPercentage` replaces `useMySeriesProgress`'s client-side tally —
 * the server field added in step 5 whose semantics were verified to match it
 * exactly (parent spec §15).
 */
export const SeriesDetailDocument = graphql(`
  query SeriesDetail($libraryId: ID!, $name: String!) {
    node(id: $libraryId) {
      id
      ... on Library {
        id
        seriesByName(name: $name) {
          id
          name
          author
          publisher
          totalPages
          totalSize
          subjects
          progressPercentage
          books(first: 100) {
            edges {
              node {
                id
                ...SeriesBookRowFragment
              }
            }
          }
        }
      }
    }
  }
`);
```

- [ ] **Step 2: Write the book-detail document**

```ts
// app/client/src/graphql/book.ts
import { graphql } from '~/gql';

/**
 * `Book.validation` is nullable — null means "never validated", which is what
 * REST's tri-state `valid?: boolean | null` expressed as `undefined`. The page's
 * `editingBlocked` therefore reads `validation?.valid !== true`, preserving
 * REST's `book.valid !== true` for all three states. VERIFY this mapping against
 * the resolver before relying on it (Task 7, Step 1).
 *
 * `counts` is Task 2's new field; `messages(first: 100)` is a literal page size
 * matching `CONNECTION_LIMITS.validationMessages.maxSize`. The modal has always
 * rendered every message it was handed, and `counts` is now authoritative for the
 * summary regardless of how many messages came back — which is the whole reason
 * the field exists.
 */
export const ValidationFragment = graphql(`
  fragment ValidationFragment on Validation {
    id
    valid
    threshold
    validatedAt
    counts {
      severity
      count
    }
    messages(first: 100) {
      edges {
        node {
          seq
          severity
          message
          code
          path
          line
          column
        }
      }
    }
  }
`);

/**
 * `oldId`/`newId` are RAW content hashes, exposed by the schema for display only
 * ("resolve `oldBook`/`newBook` to navigate" — the SDL says so on both fields).
 * The lineage modal renders them truncated and passes `oldId` to
 * `bookUnlinkDocument`'s `documentId`, which is itself a `String!` document id,
 * not an `ID!` — so this is a display/document id, not a book identifier, and it
 * does not violate "the client never holds a raw book id".
 */
export const LineageEntryFragment = graphql(`
  fragment LineageEntryFragment on LinkedDocument {
    oldId
    newId
    timestamp
    type
  }
`);

export const BookDetailDocument = graphql(`
  query BookDetail($libraryId: ID!, $bookId: ID!) {
    node(id: $libraryId) {
      id
      ... on Library {
        id
        book(id: $bookId) {
          id
          title
          author
          description
          publisher
          publishDate
          addedAt
          mtime
          size
          pageCount
          chapterCount
          chapterNames
          chapterSpineMap
          subjects
          seriesIndex
          hasCover
          coverUrl
          deviceEditionCount
          series {
            id
            name
          }
          progress {
            id
            percentage
            currentChapter
          }
          validation {
            id
            valid
          }
          lineage {
            ...LineageEntryFragment
          }
          pendingFix {
            id
          }
        }
      }
    }
  }
`);

/**
 * The validation modal's payload, fired LAZILY — only when the modal opens.
 *
 * AMENDED during execution (2026-08-13, human ruling). `ValidationFragment`
 * originally hung off `BookDetail`, which measured at breadth 69 (69.0%) against
 * a 70% gate — one point of headroom. Splitting the expensive part out takes
 * `BookDetail` to roughly 54% and restores real margin for steps 7-9. It is also
 * the better shape on its own terms: the page renders none of this until the user
 * opens the modal.
 *
 * `BookDetail` deliberately KEEPS `validation { id valid }` — those two fields are
 * read on page LOAD, not on modal open: `editingBlocked` gates the "Edit metadata"
 * action on `validation?.valid !== true`. Only `threshold`, `validatedAt`, `counts`
 * and `messages` move here.
 *
 * `Validation.id` is byte-identical to the owning `Book`'s global id (server-side:
 * `encodeGlobalID('Book', [userId, bookId])`), so this document's result normalizes
 * onto the SAME cache entity `BookDetail` already created — the eager `{ id valid }`
 * and this lazy payload merge into one `Validation` object rather than competing.
 * That is also why `bookValidate`'s mutation payload (Task 9) lands here for free:
 * after a validate run the modal's data is already in cache and this query need not
 * fire at all.
 */
export const BookValidationDocument = graphql(`
  query BookValidation($libraryId: ID!, $bookId: ID!) {
    node(id: $libraryId) {
      id
      ... on Library {
        id
        book(id: $bookId) {
          id
          validation {
            ...ValidationFragment
          }
        }
      }
    }
  }
`);
```

- [ ] **Step 3: Regenerate codegen and measure both**

```bash
npm run codegen -w app/client   # WRITES src/gql/ from the SDL + documents
npm run lint -w app/client      # freshness-CHECKS it (codegen:check) — fails until you have run codegen
npm run test:cost -w app/server
```

Then measure each explicitly with `costOf()` and **write the two measured numbers into each
document's doc comment**, matching the convention `graphql/library.ts` already sets ("Measured
(`test:cost -w app/server`): breadth 47 (47.0%), complexity 6007 (18.2%)").

- [ ] **Step 4: If `BookDetail` lands over 70% of either budget, trim in this order**

**CORRECTED during execution (2026-08-13).** The original ladder listed the page-size trim first.
That is wrong for the axis that is actually tight. `cost-limit.ts:598-666`: **breadth is 1 per
selection in the expanded tree, unweighted by any connection multiplier** — only *complexity* is
scaled by `pageSizeMultiplier`. So dropping `messages(first: 100)` to `first: 20` moves complexity
(already a harmless 4.2%) and does **nothing** to breadth. Correct order:

1. Split `validation` into its own lazily-fired query, issued only when the modal opens. This is
   the only lever that moves breadth: `validation`'s subtree is ~17-18 breadth points, taking
   `BookDetail` from 69% to roughly 51%.
2. Drop `messages(first: 100)` to `first: 20` — complexity only. Reach for this ONLY if complexity
   is what breached.
3. Only then consider a budget conversation.

Record which lever was pulled, and the before/after numbers, in the document's doc comment.
**Do not proceed to Task 5 with a document over the line.**

- [ ] **Step 5: Commit**

```bash
git add app/client/src/graphql app/client/src/gql
git commit -m "feat(client): add the series-detail and book-detail documents, measured under budget"
```

---

## Task 5: `useSeriesDetail`

**Files:**
- Create: `app/client/src/provider/library/hook/use-series-detail.ts`, `.../use-series-detail.test.tsx`
- Modify: `app/client/src/provider/library/index.ts` (export)

**Interfaces:**
- Consumes: `SeriesDetailDocument`, `useCurrentLibraryId()`.
- Produces:
  ```ts
  type SeriesDetail = {
    id: string; name: string; author: string; publisher: string;
    totalPages: number; totalSize: number; subjects: string[];
    progressPercentage: number | null | undefined;
    books: FragmentType<typeof SeriesBookRowFragment>[];
  };
  export const useSeriesDetail = (name: string) =>
    ({ series: SeriesDetail | undefined; loading: boolean; error: string | undefined });
  ```

**Hook shape (spec §4):** `useSeries` and `useSeriesBookList` have **one** non-test consumer
between them once the progress wrappers stop calling them (`page/series`), so this **reshapes**
into a named object rather than preserving either REST tuple. One consumer, one small diff.

- [ ] **Step 1: Write the failing test**

```tsx
// app/client/src/provider/library/hook/use-series-detail.test.tsx
import { waitFor } from '@testing-library/react';
import { describe, expect, it } from 'vitest';

import { SeriesDetailDocument } from '~/graphql/series';
import { renderHookWithApollo } from '~/test-utils';

import { useSeriesDetail } from './use-series-detail';

const LIBRARY_ID = 'TGlicmFyeTox';

const seriesResult = (name: string) => ({
  request: { query: SeriesDetailDocument, variables: { libraryId: LIBRARY_ID, name } },
  result: {
    data: {
      __typename: 'Query' as const,
      node: {
        __typename: 'Library' as const,
        id: LIBRARY_ID,
        seriesByName: {
          __typename: 'Series' as const,
          id: 'U2VyaWVzOjE=',
          name,
          author: 'Le Guin',
          publisher: 'Harper',
          totalPages: 900,
          totalSize: 3_000_000,
          subjects: ['Fantasy'],
          progressPercentage: 0.5,
          books: {
            __typename: 'SeriesBooksConnection' as const,
            edges: [
              {
                __typename: 'SeriesBooksConnectionEdge' as const,
                node: {
                  __typename: 'Book' as const,
                  id: 'Qm9vazox',
                  title: 'A Wizard of Earthsea',
                  seriesIndex: 1,
                  hasCover: true,
                  thumbnailUrl: '/api/books/1/cover?width=88',
                  progress: { __typename: 'Progress' as const, id: 'UHJvZ3Jlc3M6MQ==', percentage: 0.5 },
                },
              },
            ],
          },
        },
      },
    },
  },
});

describe('useSeriesDetail', () => {
  it('returns the series with its books', async () => {
    const { result } = renderHookWithApollo(() => useSeriesDetail('Earthsea'), [
      seriesResult('Earthsea'),
    ]);

    await waitFor(() => expect(result.current?.loading).toBe(false));
    expect(result.current?.series?.name).toBe('Earthsea');
    expect(result.current?.series?.books).toHaveLength(1);
    expect(result.current?.error).toBeUndefined();
  });

  it('returns undefined series (not an error) for a name the library does not have', async () => {
    const { result } = renderHookWithApollo(() => useSeriesDetail('Nope'), [
      {
        request: { query: SeriesDetailDocument, variables: { libraryId: LIBRARY_ID, name: 'Nope' } },
        result: {
          data: {
            __typename: 'Query' as const,
            node: { __typename: 'Library' as const, id: LIBRARY_ID, seriesByName: null },
          },
        },
      },
    ]);

    await waitFor(() => expect(result.current?.loading).toBe(false));
    expect(result.current?.series).toBeUndefined();
    expect(result.current?.error).toBeUndefined();
  });

  it('surfaces a transport failure as a message string', async () => {
    const { result } = renderHookWithApollo(() => useSeriesDetail('Earthsea'), [
      {
        request: { query: SeriesDetailDocument, variables: { libraryId: LIBRARY_ID, name: 'Earthsea' } },
        error: new Error('network down'),
      },
    ]);

    await waitFor(() => expect(result.current?.error).toBe('network down'));
    expect(result.current?.series).toBeUndefined();
  });

  it('returns MASKED book refs — it must not unmask centrally', async () => {
    const { result } = renderHookWithApollo(() => useSeriesDetail('Earthsea'), [
      seriesResult('Earthsea'),
    ]);

    await waitFor(() => expect(result.current?.loading).toBe(false));
    // A masked ref exposes no readable field; unmasking is each row's own job.
    expect(result.current?.series?.books[0]).not.toHaveProperty('title');
  });
});
```

The last test is the important one. `useLibraryEntries` set this precedent deliberately: returning
masked refs is what lets each row call `useFragment` exactly once in its own render context,
sidestepping the `react-hooks/rules-of-hooks` collision a shared unmask inside a `.map()` would hit.

- [ ] **Step 2: Run and confirm failure**

Run: `npm run test -w app/client -- use-series-detail`
Expected: FAIL — module not found.

- [ ] **Step 3: Implement**

Mirror `provider/library/hook/use-library-entries.ts` (read it first — it is the closest sibling
and settles error handling, the `node` narrowing, and the masked-ref stance). Key points:

```ts
export const useSeriesDetail = (name: string) => {
  const libraryId = useCurrentLibraryId();
  const { data, loading, error } = useQuery(SeriesDetailDocument, {
    variables: { libraryId: libraryId ?? '', name },
    skip: libraryId === undefined,
  });

  const node = data?.node;
  const series = node?.__typename === 'Library' ? node.seriesByName : undefined;

  return useMemo(
    () => ({
      series: series
        ? { ...series, books: series.books.edges.map((edge) => edge.node) }
        : undefined,
      loading: loading || libraryId === undefined,
      error: error?.message,
    }),
    [series, loading, libraryId, error]
  );
};
```

`edge.node` carries `id` plus the masked `SeriesBookRowFragment` ref — return it whole; do not
map it into a plain object, which would strip the fragment marker.

- [ ] **Step 4: Run and confirm pass**

Run: `npm run test -w app/client -- use-series-detail`
Expected: PASS, 4/4.

- [ ] **Step 5: Commit**

```bash
git add app/client/src/provider/library
git commit -m "feat(client): read series detail and its books over GraphQL"
```

---

## Task 6: `BookRowFromSeriesBook`, and `from-book.tsx` dies

**Files:**
- Create: `app/client/src/component/book-row/from-series-book.tsx`, `.../from-series-book.test.tsx`
- Delete: `app/client/src/component/book-row/from-book.tsx`, `.../from-book.test.tsx`
- Modify: `app/client/src/component/index.ts` (swap the export)

**Interfaces:**
- Consumes: `SeriesBookRowFragment`, the presentational `BookRow`.
- Produces: `BookRowFromSeriesBook({ asCard?, showAuthor?, book: FragmentType<typeof SeriesBookRowFragment> })`.

- [ ] **Step 1: Write the failing test**

```tsx
// app/client/src/component/book-row/from-series-book.test.tsx
import { screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';

import { renderWithApollo } from '~/test-utils';

import { BookRowFromSeriesBook } from './from-series-book';

const bookRef = {
  __typename: 'Book' as const,
  id: 'Qm9vazox',
  title: 'A Wizard of Earthsea',
  seriesIndex: 1,
  hasCover: true,
  thumbnailUrl: '/api/books/1/cover?width=88&user=le&v=1',
  progress: { __typename: 'Progress' as const, id: 'UHJvZ3Jlc3M6MQ==', percentage: 0.5 },
};

describe('BookRowFromSeriesBook', () => {
  it('renders title, series index and progress from the fragment', () => {
    renderWithApollo(<BookRowFromSeriesBook book={bookRef as never} showAuthor={false} />);

    expect(screen.getByText('A Wizard of Earthsea')).toBeInTheDocument();
    expect(screen.getByText(/Book 1/)).toBeInTheDocument();
    expect(screen.getByText(/50%/)).toBeInTheDocument();
  });

  it('shows no progress text when the book has none', () => {
    renderWithApollo(
      <BookRowFromSeriesBook book={{ ...bookRef, progress: null } as never} showAuthor={false} />
    );

    expect(screen.queryByText(/%/)).not.toBeInTheDocument();
    expect(screen.queryByText('Completed')).not.toBeInTheDocument();
  });

  it('navigates to the book by its GLOBAL id', async () => {
    const navigate = vi.fn();
    // mock react-router's useNavigate per this repo's existing convention —
    // copy it from from-entry.test.tsx rather than inventing one.
    renderWithApollo(<BookRowFromSeriesBook book={bookRef as never} />);
    await userEvent.click(screen.getByText('A Wizard of Earthsea'));

    expect(navigate).toHaveBeenCalledWith('/book/Qm9vazox');
  });
});
```

- [ ] **Step 2: Run and confirm failure**

Run: `npm run test -w app/client -- from-series-book`
Expected: FAIL — module not found.

- [ ] **Step 3: Implement**

```tsx
// app/client/src/component/book-row/from-series-book.tsx
import { useCallback } from 'react';
import { useNavigate } from 'react-router';

import { useFragment, type FragmentType } from '~/gql';
import { SeriesBookRowFragment } from '~/graphql/series';
import { useAuthorizedSrc } from '~/lib/use-authorized-src';
import { path } from '~/router';

import { BookRow } from './index';

interface BookRowFromSeriesBookProps {
  asCard?: boolean;
  showAuthor?: boolean;
  book: FragmentType<typeof SeriesBookRowFragment>;
}

/**
 * The series page's adapter — the GraphQL replacement for `from-book.tsx`,
 * the REST adapter whose own doc comment asked to be deleted "when series
 * migrates". Structurally identical to `BookRowFromEntry`: one unconditional
 * `useFragment` in its own render context (one component per row), so a shared
 * unmask inside a `.map()` never collides with `react-hooks/rules-of-hooks`.
 *
 * Calls no progress hook. `SeriesBookRowFragment` already carries
 * `progress { percentage }`, so `useMyProgress` here would re-fetch data the
 * parent's `SeriesDetail` query already holds — and, since `useMyProgress`'s map
 * is keyed by the RAW content hash while `unmasked.id` is a Relay global ID, it
 * would silently miss on every row besides.
 *
 * `thumbnailUrl` is server-built with the correct `?user=`/`v=` suffix, so no
 * `withTargetUser()` wrapping is needed — the same reason `BookRowFromEntry`
 * dropped it.
 */
export function BookRowFromSeriesBook({ asCard, showAuthor, book }: BookRowFromSeriesBookProps) {
  const navigate = useNavigate();
  const unmasked = useFragment(SeriesBookRowFragment, book);
  const coverSrc = useAuthorizedSrc(unmasked.hasCover ? unmasked.thumbnailUrl : null);
  const handleNavigate = useCallback(() => {
    navigate(path.book(unmasked.id));
  }, [navigate, unmasked.id]);

  return (
    <BookRow
      asCard={asCard}
      showAuthor={showAuthor}
      title={unmasked.title}
      author=""
      seriesIndex={unmasked.seriesIndex}
      hasCover={unmasked.hasCover}
      coverSrc={coverSrc}
      progressPercentage={unmasked.progress?.percentage}
      onClick={handleNavigate}
    />
  );
}
```

- [ ] **Step 4: Run and confirm pass, then update `BookRow`'s doc comment**

`component/book-row/index.tsx`'s doc comment names `BookRowFromBook` as "REST-backed, for
`page/series` until it migrates". Both adapters are fragment-backed now — rewrite that paragraph
so it stops asserting something false. (Three doc comments on this branch have already needed this
correction; do not add a fourth.)

- [ ] **Step 5: Commit**

```bash
git add app/client/src/component
git commit -m "feat(client): render series rows from a fragment, delete the REST adapter"
```

---

## Task 7: `SeriesPage` on GraphQL

**Files:**
- Modify: `app/client/src/page/series/index.tsx`, `.../index.test.tsx`

- [ ] **Step 1: Write the failing tests**

Rewrite `page/series/index.test.tsx` onto `renderWithApollo` with a `SeriesDetailDocument` mock.
Cases to keep from the existing file (read it and carry each one over — do not drop coverage):
loading state; "Series not found" for a null series; the metadata list; the subjects card; the
book list; author navigation. Add:

```tsx
it('shows the progress badge from Series.progressPercentage for a non-admin', async () => {
  renderWithApollo(<SeriesPage />, { mocks: [seriesMock({ progressPercentage: 0.5 })] });
  await screen.findByText('Earthsea');
  expect(screen.getByRole('progressbar')).toHaveAttribute('aria-valuenow', '50');
});

it('hides the progress metadata entirely for an admin', async () => {
  // Mock useIsAdmin to [true], per the convention page/library's test already uses.
  renderWithApollo(<SeriesPage />, { mocks: [seriesMock({ progressPercentage: 0.5 })] });

  await screen.findByText('Earthsea');
  expect(screen.queryByText('progress')).not.toBeInTheDocument();
});

it('renders no progress badge when progressPercentage is null', async () => {
  renderWithApollo(<SeriesPage />, { mocks: [seriesMock({ progressPercentage: null })] });

  await screen.findByText('Earthsea');
  // An unstarted series shows NO badge — not a "0%" one. This is the exact
  // distinction Series.progressPercentage's null-vs-0 semantics exist to carry
  // (parent spec §15), so it is the one worth pinning.
  expect(screen.queryByRole('progressbar')).not.toBeInTheDocument();
});
```

- [ ] **Step 2: Run and confirm failure**

Run: `npm run test -w app/client -- page/series`

- [ ] **Step 3: Rewrite the page**

Changes, all mechanical once the hook exists:
- `useSeriesBookList` + `useSeries` + `useMySeriesProgress` → one `useSeriesDetail(name!)`.
- `useWithTargetUser` and the `~/lib/cover-url` import go away.
- `CoverStack` takes `src` from each book's `thumbnailUrl`; unmask the first three refs with
  `useFragment(SeriesBookRowFragment, ref)`, which is legal in a `.map()` here only because it is
  an identity function — prefer a small `<SeriesCoverStack>` child component if the lint rule
  objects, matching how `BookRowFromEntry` solves the same problem.
- `BookRowFromBook` → `BookRowFromSeriesBook`.
- The not-found branch becomes `!loading && series === undefined`; keep `error` separate so a
  transport failure does not read as "Series not found".

Preserve `seriesProgressPercent ? seriesProgressPercent : 0` semantics exactly:
`progressPercentage` is `null` for an unstarted series and the old hook returned `undefined` — both
must render the same thing they render today.

- [ ] **Step 4: Run and confirm pass**

Run: `npm run test -w app/client -- page/series`

- [ ] **Step 5: Commit**

```bash
git add app/client/src/page/series
git commit -m "feat(client): drive /library/series/:name from GraphQL"
```

---

## Task 8: `useBookDetail`

**Files:**
- Create: `app/client/src/provider/book/hook/use-book-detail.ts`, `.../use-book-detail.test.tsx`
- Modify: `app/client/src/provider/book/index.ts`

**Interfaces:**
- Consumes: `BookDetailDocument`, `useCurrentLibraryId()`.
- **Validation is split (2026-08-13 ruling).** `BookDetail` carries only `validation { id valid }`
  for `editingBlocked`; the modal's payload comes from `BookValidationDocument`, fired lazily by
  `useBookValidation(bookId)` — a `useLazyQuery`, NOT part of this hook. Build that hook in this
  task alongside `useBookDetail`, in its own file `use-book-validation.ts`, and test that it issues
  NO operation until invoked.
- Produces: `useBookDetail(bookId: string) => { book: BookDetail | undefined; loading: boolean; error: string | undefined; refetch: () => void }`,
  where `BookDetail` is the generated `BookDetail` query's `book` shape (validation and lineage
  stay masked; the page unmasks them at the two sites that consume them).

**Hook shape (spec §4):** `useBook` has **four** non-test consumers, three of which (`page/book-edit`,
`my-progress-row`, `user-progress-row`) belong to later steps. So `useBook` is **preserved
untouched** and this is a **new, differently-named hook** used only by `page/book`. Reshaping
`useBook` would drag three later steps' screens into this one.

- [ ] **Step 1: Verify the `validation` null mapping against the resolver, then write the tests**

Before writing anything, read `app/server/graphql/schema/book/model.ts`'s `validation` field and
confirm: a book that has never been validated resolves `validation: null` (not a `Validation` row
with `valid: false`). Record what you find in the hook's doc comment. If it turns out otherwise,
the `editingBlocked` mapping in Task 9 changes and this plan is wrong — fix it here.

Build the file on Task 5's `use-series-detail.test.tsx` — same harness, same `LIBRARY_ID`, same
`renderHookWithApollo` shape — substituting `BookDetailDocument` and `{ libraryId, bookId }`
variables. The full mock payload must include `__typename` on every object (codegen's
`addTypenameSelectionDocumentTransform` makes typed mocks demand it).

```tsx
const BOOK_ID = 'Qm9vazox';

const bookMock = (overrides: Record<string, unknown> = {}) => ({
  request: { query: BookDetailDocument, variables: { libraryId: LIBRARY_ID, bookId: BOOK_ID } },
  result: {
    data: {
      __typename: 'Query' as const,
      node: {
        __typename: 'Library' as const,
        id: LIBRARY_ID,
        book: {
          __typename: 'Book' as const,
          id: BOOK_ID,
          title: 'A Wizard of Earthsea',
          author: 'Le Guin',
          description: 'A boy learns magic.',
          publisher: 'Harper',
          publishDate: '1968-01-01',
          addedAt: '2026-01-01T00:00:00.000Z',
          mtime: '2026-01-01T00:00:00.000Z',
          size: 1_000_000,
          pageCount: 200,
          chapterCount: 12,
          chapterNames: ['One'],
          chapterSpineMap: [0],
          subjects: ['Fantasy'],
          seriesIndex: 1,
          hasCover: true,
          coverUrl: '/api/books/1/cover?user=le&v=1',
          deviceEditionCount: 2,
          series: { __typename: 'Series' as const, id: 'U2VyaWVzOjE=', name: 'Earthsea' },
          progress: {
            __typename: 'Progress' as const,
            id: 'UHJvZ3Jlc3M6MQ==',
            percentage: 0.2,
            currentChapter: 3,
          },
          validation: {
            __typename: 'Validation' as const,
            id: BOOK_ID,
            valid: true,
            threshold: 'ERROR',
            validatedAt: '2026-01-01T00:00:00.000Z',
            counts: [{ __typename: 'ValidationSeverityCount' as const, severity: 'WARNING', count: 3 }],
            messages: { __typename: 'ValidationMessagesConnection' as const, edges: [] },
          },
          lineage: [],
          pendingFix: null,
          ...overrides,
        },
      },
    },
  },
});

describe('useBookDetail', () => {
  it('returns the book with masked validation and lineage refs', async () => {
    const { result } = renderHookWithApollo(() => useBookDetail(BOOK_ID), [bookMock()]);

    await waitFor(() => expect(result.current?.loading).toBe(false));
    expect(result.current?.book?.title).toBe('A Wizard of Earthsea');
    // `validation { id valid }` is selected DIRECTLY on BookDetail (not through a
    // fragment) since the 2026-08-13 lazy split, so it is plainly readable here —
    // `editingBlocked` depends on it at page load.
    expect(result.current?.book?.validation?.valid).toBe(true);
    // `lineage` DOES come through a fragment. Masking is compile-time only, so
    // prove it at the type level, not by asserting a missing runtime property.
    // @ts-expect-error — `timestamp` is masked behind LineageEntryFragment
    result.current?.book?.lineage?.[0]?.timestamp;
  });

  it('returns undefined book for an id the library does not have', async () => {
    const { result } = renderHookWithApollo(() => useBookDetail(BOOK_ID), [
      {
        request: { query: BookDetailDocument, variables: { libraryId: LIBRARY_ID, bookId: BOOK_ID } },
        result: {
          data: {
            __typename: 'Query' as const,
            node: { __typename: 'Library' as const, id: LIBRARY_ID, book: null },
          },
        },
      },
    ]);

    await waitFor(() => expect(result.current?.loading).toBe(false));
    expect(result.current?.book).toBeUndefined();
    expect(result.current?.error).toBeUndefined();
  });

  it('surfaces a transport failure as a message string', async () => {
    const { result } = renderHookWithApollo(() => useBookDetail(BOOK_ID), [
      {
        request: { query: BookDetailDocument, variables: { libraryId: LIBRARY_ID, bookId: BOOK_ID } },
        error: new Error('network down'),
      },
    ]);

    await waitFor(() => expect(result.current?.error).toBe('network down'));
    expect(result.current?.book).toBeUndefined();
  });

  it('issues no operation until the library id resolves', async () => {
    // Mock useCurrentLibraryId to undefined for this case, per the convention
    // use-library-entries.test.tsx already uses — copy it, do not invent one.
    const { result } = renderHookWithApollo(() => useBookDetail(BOOK_ID), []);

    expect(result.current?.loading).toBe(true);
    // An empty MockLink throws on any unmatched operation, so reaching here
    // without an error IS the assertion that nothing was sent.
  });

  it('refetch re-issues the query', async () => {
    const { result } = renderHookWithApollo(() => useBookDetail(BOOK_ID), [
      bookMock(),
      bookMock({ title: 'Renamed' }),
    ]);

    await waitFor(() => expect(result.current?.book?.title).toBe('A Wizard of Earthsea'));
    result.current?.refetch();
    await waitFor(() => expect(result.current?.book?.title).toBe('Renamed'));
  });
});
```

- [ ] **Step 2: Run and confirm failure**

Run: `npm run test -w app/client -- use-book-detail`

- [ ] **Step 3: Implement**

Same shape as `useSeriesDetail` (Task 5), plus `refetch` forwarded from `useQuery`. `refetch` is
not decoration — Task 12 uses it for the progress bridge.

- [ ] **Step 4: Run and confirm pass. Commit.**

```bash
git add app/client/src/provider/book/hook/use-book-detail.ts app/client/src/provider/book/hook/use-book-detail.test.tsx app/client/src/provider/book/index.ts
git commit -m "feat(client): read book detail over GraphQL"
```

---

## Task 9: The four book mutations

**Files:**
- Modify: `app/client/src/graphql/book.ts` (add the mutations),
  `provider/book/hook/use-delete-book.ts`, `use-validate-book.ts`, `use-regen-chapters.ts`,
  `use-clear-book-editions.ts`, and each hook's test.

**Interfaces:**
- Produces: `useDeleteBook`, `useValidateBook`, `useRegenChapters`, `useClearBookEditions` — each
  keeping its **existing tuple shape** (spec §4): all four have exactly one consumer, `page/book`,
  but the tuples are small and already destructured there, so preserving them keeps the diff to the
  hook bodies. `useValidateBook` is the exception — see Step 5.

- [ ] **Step 1: Add the mutation documents**

```ts
// append to app/client/src/graphql/book.ts

export const BookDeleteDocument = graphql(`
  mutation BookDelete($id: ID!) {
    bookDelete(input: { id: $id }) {
      __typename
      ... on BookDeletePayload {
        deletedId
        library { id }
      }
    }
  }
`);

export const BookValidateDocument = graphql(`
  mutation BookValidate($id: ID!) {
    bookValidate(input: { id: $id }) {
      __typename
      ... on BookValidatePayload {
        book { id }
        validation { ...ValidationFragment }
      }
    }
  }
`);

export const BookRegenChaptersDocument = graphql(`
  mutation BookRegenChapters($id: ID!) {
    bookRegenChapters(input: { id: $id }) {
      __typename
      ... on BookRegenChaptersPayload {
        book { id chapterCount chapterNames chapterSpineMap }
      }
      ... on BookHashCollisionError { message }
      ... on BookNotValidatedError { message }
    }
  }
`);

export const BookClearEditionsDocument = graphql(`
  mutation BookClearEditions($id: ID!) {
    bookClearEditions(input: { id: $id }) {
      __typename
      ... on BookClearEditionsPayload {
        clearedCount
        book { id deviceEditionCount }
      }
    }
  }
`);
```

Check each error member against the SDL before writing it — `BookDeleteResult` and
`BookValidateResult` are single-member unions today and must not gain speculative branches, while
`BookRegenChaptersResult` genuinely has two error members.

- [ ] **Step 2: Give the test seam access to its cache**

Every test in this task asserts on the **cache**, and `renderWithApollo` currently builds its
`ApolloClient` locally and returns only what `renderWithProviders` returns — there is no way to
reach `client.cache` from a test. Extend it (and, through it, `renderHookWithApollo`) to include
the client it built:

```ts
// app/client/src/test-utils.tsx
export function renderWithApollo(
  ui: ReactElement,
  { mocks = [], ...options }: RenderWithApolloOptions = {}
) {
  const client = new ApolloClient({
    link: new MockLink(mocks),
    cache: new InMemoryCache(cacheConfig),
  });
  return {
    client,
    ...renderWithProviders(<ApolloProvider client={client}>{ui}</ApolloProvider>, options),
  };
}
```

`renderHookWithApollo` already spreads `renderWithApollo`'s return, so it inherits `client` for
free. Add a case to `test-utils.test.tsx` asserting the returned client's cache is the one the
rendered tree actually writes to — otherwise a future refactor could hand back a different
instance and every cache assertion in this task would silently pass against an empty cache.

- [ ] **Step 3: Write the failing cache-update tests**

One per mutation, each asserting the **cache** result, not just the call:

```tsx
it('evicts the deleted book from the cache', async () => {
  // seed the cache with a BookDetail result, run deleteBook, assert
  // cache.extract() no longer holds the Book entity
});

it('writes the fresh validation onto the book', async () => {
  // seed with validation.valid=false, run validateBook returning valid=true,
  // assert the cached Book's validation reads valid=true WITHOUT a refetch
});

it('replaces the book entity when regen mints a new global id', async () => {
  // payload.book.id !== requested id — assert the old entity is gone and
  // nothing renders stale chapter data
});

it('zeroes deviceEditionCount in the cache with no hand-written update', async () => {
  // Seed a Book at deviceEditionCount 2, clear editions, and assert the cached
  // entity reads 0 — proving Apollo's own normalization did it, because the
  // payload re-selects `book { id deviceEditionCount }`.
  const { result, client } = renderHookWithApollo(() => useClearBookEditions(), [
    clearEditionsMock({ clearedCount: 2, deviceEditionCount: 0 }),
  ]);
  client.cache.writeQuery({ query: BookDetailDocument, variables, data: bookMock().result.data });

  await act(async () => {
    await result.current?.[0](BOOK_ID);
  });

  const entity = client.cache.extract()[`Book:${BOOK_ID}`] as { deviceEditionCount: number };
  expect(entity.deviceEditionCount).toBe(0);
});
```

- [ ] **Step 4: Run and confirm failure**

Run: `npm run test -w app/client -- use-delete-book use-validate-book use-regen-chapters use-clear-book-editions`

- [ ] **Step 5: Implement each hook**

- **`useDeleteBook`** — `[deleteBook, loading, error, errorMessage]` preserved. Cache update:
  `cache.evict({ id: cache.identify({ __typename: 'Book', id: deletedId }) })` then `cache.gc()`.
  The whole `bookList`/`bookListItems`/`isLastInSeries` optimistic dance goes away: `page/library`
  reads a GraphQL connection now, and eviction plus `gc` is what removes the row. **This deletes
  the `isLastInSeries` logic** — verify against `page/library` that an emptied series' row actually
  disappears from the grid, and if it does not, add an explicit `Library.entries` refetch rather
  than reconstructing the optimistic bookkeeping.
- **`useValidateBook`** — reshaped, the one exception to "preserve". It returns
  `[validateBook, loading]` where `validateBook` resolved a REST `ValidationReport`. The GraphQL
  payload's `validation` is a **masked fragment ref**, so returning it as a `ValidationReport` is a
  type lie. Return `[validateBook, loading]` where `validateBook` resolves
  `FragmentType<typeof ValidationFragment> | undefined`, and let `page/book` unmask it for the
  modal (Task 11). Apollo normalizes the payload onto the Book automatically because
  `Validation.id` is the owning Book's global id — assert that in the test rather than writing a
  manual update.
- **`useRegenChapters`** — `[regenChapters, loading, error, errorMessage]` preserved. The
  `renameProgressKey` call goes away with the REST progress map. Map `BookHashCollisionError` and
  `BookNotValidatedError` to `errorMessage`. When `payload.book.id` differs from the requested id,
  evict the old entity — the raw content hash changed, so the global id did too.
- **`useClearBookEditions`** — `[clearBookEditions, loading, error, errorMessage]` preserved,
  still resolving `number | undefined`. `deviceEditionCount` comes back in the payload, so Apollo
  normalizes it with no manual update; assert that.

Use `provider/apollo/unwrap-result.ts` for the union narrowing — it exists for exactly this.

- [ ] **Step 6: Run each test seen-to-fail without its update function**

For every hook whose correctness depends on a hand-written cache update (delete, and regen's
eviction), delete the update, watch the test fail, restore it. Record the failure mode in the
hook's doc comment. Where Apollo's automatic normalization does the work (validate, clear-editions),
say so explicitly in the doc comment instead of adding a redundant update — and prove it by
asserting the cache, so a future normalization change is caught.

- [ ] **Step 7: Run the client suite and commit**

```bash
npm run test -w app/client
git add app/client/src/graphql app/client/src/provider/book app/client/src/gql
git commit -m "feat(client): move the four book actions onto GraphQL mutations"
```

---

## Task 10: The lineage modal

**Files:**
- Modify: `control/book-lineage-modal/index.tsx`, `control/unlink-book-lineage-button/index.tsx`,
  `graphql/book.ts`, and both components' tests
- Delete: `provider/book/hook/use-book-lineage.ts`, `use-unlink-book-lineage.ts` (+ tests)

- [ ] **Step 1: Add the unlink mutation**

```ts
export const BookUnlinkDocumentDocument = graphql(`
  mutation BookUnlinkDocument($id: ID!, $documentId: String!) {
    bookUnlinkDocument(input: { id: $id, documentId: $documentId }) {
      __typename
      ... on BookUnlinkDocumentPayload {
        book { id lineage { ...LineageEntryFragment } }
      }
      ... on LineageEntryNotFoundError { message }
      ... on EditLineageEntryError { message }
      ... on InvalidInputError { message }
    }
  }
`);
```

The payload re-selects the full `lineage` list, so the modal's `refetch` disappears — Apollo
overwrites the array on the normalized Book.

- [ ] **Step 2: Write the failing tests**

```tsx
it('groups edit rows and nests merge rows under their parent', async () => { /* carried over */ });
it('removes an unlinked merge row without a refetch', async () => {
  // assert the row is gone after the mutation resolves, with only ONE mock in MockLink
});
it('surfaces EditLineageEntryError as an error message', async () => {
  renderWithApollo(<BookLineageModal isOpen bookId={BOOK_ID} bookTitle="A Wizard of Earthsea" lineage={[mergeEntry]} onClose={noop} />, {
    mocks: [
      {
        request: {
          query: BookUnlinkDocumentDocument,
          variables: { id: BOOK_ID, documentId: mergeEntry.oldId },
        },
        result: {
          data: {
            __typename: 'Mutation' as const,
            bookUnlinkDocument: {
              __typename: 'EditLineageEntryError' as const,
              message: 'Cannot unlink an edit-history entry',
            },
          },
        },
      },
    ],
  });

  await userEvent.click(screen.getByRole('button', { name: /unlink/i }));
  await userEvent.click(screen.getByRole('button', { name: /^unlink$/i }));

  expect(await screen.findByText(/cannot unlink an edit-history entry/i)).toBeInTheDocument();
  // The row survives a refused unlink.
  expect(screen.getByText(new RegExp(mergeEntry.oldId.slice(0, 4)))).toBeInTheDocument();
});

it('renders the book title from its prop, issuing no book query', async () => {
  // An EMPTY mock list: `useBook` would have fired a REST call and
  // `useBookDetail` a GraphQL one. Neither may happen — the title is a prop.
  renderWithApollo(
    <BookLineageModal isOpen bookId={BOOK_ID} bookTitle="A Wizard of Earthsea" lineage={[mergeEntry]} onClose={noop} />,
    { mocks: [] }
  );

  await userEvent.click(screen.getByRole('button', { name: /unlink/i }));
  expect(screen.getByText('A Wizard of Earthsea')).toBeInTheDocument();
});
```

- [ ] **Step 3: Run and confirm failure. Then implement.**

- `BookLineageModal` takes `lineage: FragmentType<typeof LineageEntryFragment>[]`, `bookId`,
  `bookTitle`, `addedAt` — it no longer fetches. `page/book` already has all four.
- `buildLineageRows` keeps its structure but reads unmasked entries. `lineage.currentId` becomes
  the page's `book.id`… **check this**: `currentId` was a RAW content hash and rows are keyed and
  displayed by document id. `LinkedDocument.newId`/`oldId` are raw and correct for display; the
  *current* row's document id is the one value the REST payload supplied separately. Derive it from
  the newest entry's `newId` when lineage is non-empty; when lineage is empty there is exactly one
  row and no document id to show — verify what REST rendered in that case and preserve it. Do not
  substitute the global id: it would render a different string in the UI.
- `UnlinkBookLineageButton` takes `bookTitle: string` instead of calling `useBook`, and uses the
  mutation directly.

- [ ] **Step 4: Run, confirm pass, delete the two dead hooks, commit**

```bash
git rm app/client/src/provider/book/hook/use-book-lineage.ts app/client/src/provider/book/hook/use-unlink-book-lineage.ts
# plus their tests, plus the exports in provider/book/index.ts
npm run test -w app/client
git commit -am "feat(client): move book lineage and unlink onto GraphQL"
```

---

## Task 10b: `Book.documentId` — a display-only raw content hash

*Added during execution (2026-08-16, human ruling). Task 10 discovered the gap; Task 11 is blocked
on it.*

**Files:**
- Modify: `app/server/graphql/schema/book/model.ts`, `app/server/graphql/schema.generated.graphql`
- Test: `app/server/graphql/schema/book/model.test.ts`
- Modify: `app/client/src/graphql/book.ts` (select it on `BookDetailDocument`), regenerate `src/gql/`

**Why:** the lineage modal's top row renders the CURRENT book's own document id as visible full
text (`component/book-lineage-row/index.tsx` renders `{documentId}` unmodified). REST supplied it
as `currentId`, which `book-store.ts` always set to the raw content hash. GraphQL's `Book.lineage`
list has no equivalent, and for a book with EMPTY lineage there is nothing to derive it from —
lineage entries only exist once a book has been edited or re-imported.

**Why this is not a reversal of the Book-Relay-ID decision.** That pass made the Relay global ID
the only *identifier* — the thing you address a book BY. This field is a display value, and the
schema already carries exactly this pattern: `LinkedDocument.oldId`/`newId` are documented "Raw
content-hash for display; resolve `oldBook`/`newBook` to navigate." `Book.documentId` is the same
contract on the owning type. Its description must say so explicitly, so no future reader mistakes
it for an address.

**Interfaces:**
- Produces: `Book.documentId: String!` — the raw content-hash, display-only.

- [ ] **Step 1: Write the failing test**

In `app/server/graphql/schema/book/model.test.ts`, following that file's existing harness:

```ts
it('exposes the raw content hash as documentId, distinct from the Relay id', async () => {
  const result = await execute(/* node(id: library) { ... book(id: $gid) { id documentId } } */);

  expect(result.errors).toBeUndefined();
  const book = result.data.node.book;
  expect(book.documentId).toBe(seededBook.id);       // the raw content hash
  expect(book.id).not.toBe(book.documentId);          // the global id is different
  expect(decodeGlobalID(book.id).id).toContain(book.documentId); // and encodes it
});
```

- [ ] **Step 2: Run and confirm failure**

Run: `npm run test -w app/server -- schema/book`
Expected: FAIL — `Cannot query field "documentId" on type "Book"`.

- [ ] **Step 3: Add the field**

```ts
    /**
     * The raw content-hash id, for DISPLAY ONLY — never to address this book.
     * `id` (the Relay global id) is the only identifier; every mutation and
     * every `node(id:)`/`Library.book(id:)` lookup takes that.
     *
     * Exists because the client's book-lineage modal renders a book's own
     * document id as visible text alongside its former ids, and those former
     * ids are raw hashes too (`LinkedDocument.oldId`/`newId`, which carry this
     * same display-only contract). Without this field a book with no lineage
     * entries — one never edited or re-imported — has no id to show in that
     * row at all, since the entry list it would otherwise be derived from is
     * empty.
     */
    documentId: t.exposeString('id'),
```

Verify the Prisma field name against `schema.prisma` before writing `t.exposeString('id')` — the
raw id is `Book.id` in the DB, but confirm rather than trust this line.

- [ ] **Step 4: Regenerate the SDL and run the gates**

```bash
npm run graphql:schema -w app/server   # WRITES the SDL
npm run test -w app/server
```

- [ ] **Step 5: Select it client-side and re-measure**

Add `documentId` to `BookDetailDocument`'s `book` selection in `app/client/src/graphql/book.ts`,
then `npm run codegen -w app/client` and `npm run test:cost -w app/server`. `BookDetail` was at
breadth 49 (49.0%); one scalar adds 1. Update the measured numbers in its doc comment.

- [ ] **Step 6: Commit**

```bash
git add app/server/graphql app/client/src/graphql app/client/src/gql
git commit -m "feat(server): expose Book.documentId, a display-only raw content hash"
```

---

## Task 11: `BookPage` on GraphQL

**Files:**
- Modify: `app/client/src/page/book/index.tsx`, `.../index.test.tsx`

- [ ] **Step 1: Write the failing tests**

Carry over every case in the existing `page/book/index.test.tsx` (read it; it is the largest test
file in this task's surface) onto `renderWithApollo`. Then add:

Lift Task 8's `bookMock` helper into this file (or a shared fixture module) — these cases all vary
one field of it.

```tsx
it('renders the cover from Book.coverUrl, not a hand-built URL', async () => {
  renderWithApollo(<BookPage />, { mocks: [bookMock()] });

  const img = await screen.findByAltText('A Wizard of Earthsea');
  // `useAuthorizedSrc` turns it into a blob: URL, so assert on what it was
  // ASKED to authorize — spy on it per the convention from-entry.test.tsx uses.
  expect(authorizedSrcSpy).toHaveBeenCalledWith('/api/books/1/cover?user=le&v=1');
  expect(img).toBeInTheDocument();
});

it('blocks editing when the book has never been validated (validation: null)', async () => {
  renderWithApollo(<BookPage />, { mocks: [bookMock({ validation: null })] });

  await screen.findByText('A Wizard of Earthsea');
  expect(screen.getByRole('button', { name: /edit metadata/i })).toBeDisabled();
});

it('blocks editing when validation.valid is false', async () => {
  renderWithApollo(<BookPage />, {
    mocks: [bookMock({ validation: { ...validationFixture, valid: false } })],
  });

  await screen.findByText('A Wizard of Earthsea');
  expect(screen.getByRole('button', { name: /edit metadata/i })).toBeDisabled();
});

it('allows editing when validation.valid is true', async () => {
  renderWithApollo(<BookPage />, { mocks: [bookMock()] });

  await screen.findByText('A Wizard of Earthsea');
  expect(screen.getByRole('button', { name: /edit metadata/i })).toBeEnabled();
});

it('navigates back to the series using Book.series.name', async () => {
  renderWithApollo(<BookPage />, { mocks: [bookMock()] });

  await userEvent.click(await screen.findByText(/Earthsea/));
  expect(navigate).toHaveBeenCalledWith('/library/series/Earthsea');
});

it('falls back to the library when the book has no series', async () => {
  renderWithApollo(<BookPage />, { mocks: [bookMock({ series: null })] });

  await screen.findByText('A Wizard of Earthsea');
  expect(screen.queryByText(/\(Earthsea/)).not.toBeInTheDocument();
});

it('passes the book GLOBAL id to the replace modal', async () => {
  renderWithApollo(<BookPage />, { mocks: [bookMock()] });

  await screen.findByText('A Wizard of Earthsea');
  await userEvent.click(screen.getByRole('button', { name: /upload replacement/i }));

  expect(replaceModalSpy).toHaveBeenCalledWith(
    expect.objectContaining({ bookId: 'Qm9vazox' }),
    undefined
  );
});

it('opens the validation modal with counts converted from the list shape', async () => {
  renderWithApollo(<BookPage />, { mocks: [bookMock(), validateMutationMock()] });

  await screen.findByText('A Wizard of Earthsea');
  await userEvent.click(screen.getByRole('button', { name: /^validate$/i }));

  // The modal takes Record<Severity, number>; the fragment gives a list.
  await waitFor(() => expect(screen.getByText(/3 warning/i)).toBeInTheDocument());
});
```

Check the real overflow-menu labels in `page/book/actions.ts` before writing the `getByRole`
queries — "Upload replacement" and "Validate" are guesses from the handler names, not verified
copy. Check too whether "Edit metadata" renders `disabled` or is simply omitted when
`editingBlocked` is true; assert whichever the component actually does.

- [ ] **Step 2: Run and confirm failure. Then rewrite the page.**

The substantive changes:
- `useBook(id!, true)` + `useMyProgress(book?.id)` → one `useBookDetail(id!)`. The long doc comment
  at lines 44–54 explaining the raw-id progress lookup **goes away with the code it explains** —
  do not carry it forward; it will be false.
- `book.series` is now `Series | null`, not a string: `book.series.length > 0` →
  `book.series !== null`, and `path.series(book.series.name)`.
- `coverSrc` = `useAuthorizedSrc(book.hasCover ? book.coverUrl : null)`. `withTargetUser` and
  `~/lib/cover-url` imports go.
- `editingBlocked: book.validation?.valid !== true` (per Task 8, Step 1's verification).
- `progress` comes from `book.progress`.
- `handleDeleteConfirm`/`handleValidate`/etc. pass `book.id` (the global id) rather than the `id`
  URL param — the param may be either form and the mutations take `ID!`.
- **`BookLineageModal`'s `bookId` prop** must now receive `book.documentId` (Task 10b), NOT
  `book.id`. Task 10 left a provisional `bookId` fallback for the empty-lineage row that was
  correct only while this page still held a raw id; passing the global id would render a base64
  string where users see a content hash, in the same column as the raw-hash rows beneath it.
  Note the modal's `bookId` is ALSO passed to `bookUnlinkDocument` as the mutation's `id` — that
  one needs the GLOBAL id. Check whether one prop is now serving two purposes and split it if so.
- `ValidationDetailModal`'s data now comes from `useBookValidation` (lazy), fired when the user
  clicks Validate or opens the modal — not from the page's own query. After a `bookValidate`
  mutation the payload has already normalized onto the same `Validation` entity, so the lazy query
  is a cache hit and no round trip occurs; assert that.
- `ValidationDetailModal` gets `counts` built from the unmasked validation fragment. It expects
  `Record<Severity, number>`; the fragment gives a list. Convert at the call site:
  `Object.fromEntries(counts.map((c) => [c.severity, c.count]))`. **Do not change the modal's
  prop type** — `page/upload` and the replace flow still pass the REST-shaped record, and both
  belong to step 9.
- `SetProgressModal`, `UploadReplaceModal` and `useDownloadBook` all receive `book.id`, the global
  id, which Task 3 made every one of their routes accept.

- [ ] **Step 3: Run, confirm pass, commit**

```bash
npm run test -w app/client
git add app/client/src/page/book
git commit -m "feat(client): drive the book detail page from GraphQL"
```

---

## Task 12: The progress bridge

**Files:**
- Modify: `app/client/src/page/book/index.tsx`, `.../index.test.tsx`

**Why:** `page/book` now reads progress from the Apollo cache, but `SetProgressModal` still writes
through `ProgressProvider` over REST until step 8. Without a bridge, setting progress leaves the
displayed percentage stale until a reload — a real, user-visible regression this step would
otherwise introduce silently.

- [ ] **Step 1: Write the failing test**

```tsx
// Reuses page/book/index.test.tsx's `bookMock` helper (Task 11) — the second
// mock is the SAME request, so MockLink serves it to the refetch.
const at = (percentage: number) =>
  bookMock({ progress: { __typename: 'Progress', id: 'UHJvZ3Jlc3M6MQ==', percentage, currentChapter: 3 } });

it('refreshes the displayed progress after the set-progress modal saves', async () => {
  renderWithApollo(<BookPage />, { mocks: [at(0.2), at(0.6)] });

  await screen.findByText('A Wizard of Earthsea');
  expect(screen.getByRole('progressbar')).toHaveAttribute('aria-valuenow', '20');

  await userEvent.click(screen.getByRole('button', { name: /set progress/i }));
  await userEvent.click(screen.getByRole('button', { name: /save/i }));

  await waitFor(() =>
    expect(screen.getByRole('progressbar')).toHaveAttribute('aria-valuenow', '60')
  );
});

it('does not refetch when the modal is dismissed without saving', async () => {
  // Only ONE mock: a second BookDetail operation would throw "No more mocked
  // responses", which is exactly the failure this asserts against.
  renderWithApollo(<BookPage />, { mocks: [at(0.2)] });

  await screen.findByText('A Wizard of Earthsea');
  await userEvent.click(screen.getByRole('button', { name: /set progress/i }));
  await userEvent.click(screen.getByRole('button', { name: /cancel/i }));

  await waitFor(() =>
    expect(screen.getByRole('progressbar')).toHaveAttribute('aria-valuenow', '20')
  );
  expect(screen.queryByText(/no more mocked responses/i)).not.toBeInTheDocument();
});
```

Check the modal's actual button labels and the progress indicator's accessible role/attributes
before writing these — `ProgressIndicator` may not expose `progressbar`/`aria-valuenow`. If it
does not, assert on the rendered text instead and note the substitution.

- [ ] **Step 2: Run and confirm failure. Then implement.**

Give `SetProgressModal` an `onSaved?: () => void` prop fired on the same successful-close path its
existing effect already detects, and have `page/book` pass `onSaved={refetch}`.

```tsx
/**
 * STEP-8 BRIDGE — delete this when the progress hooks move to GraphQL.
 * `SetProgressModal` writes through `ProgressProvider` (REST); this page reads
 * `Book.progress` from the Apollo cache. Nothing connects the two, so without
 * this refetch a save leaves the displayed percentage stale until a reload.
 * Once `progressSet` is a GraphQL mutation its payload normalizes onto the same
 * `Progress` entity and this prop, and the refetch, become dead weight.
 */
```

- [ ] **Step 3: Run, confirm pass, commit**

```bash
git add app/client/src/page/book app/client/src/control/set-progress-modal
git commit -m "fix(client): refetch book detail after a REST progress write (step-8 bridge)"
```

---

## Task 12b: `ValidationMessage.segments` — restore subject monospacing

*Added during execution (2026-08-16, human ruling). Task 11 discovered the narrowing.*

**Files:**
- Create: `app/server/graphql/schema/message-segment/model.ts` (+ its `index.ts`)
- Modify: `app/server/graphql/schema/validation-message/model.ts`, `schema/index.ts`,
  `schema.generated.graphql`
- Test: `app/server/graphql/schema/validation-message/model.test.ts`
- Modify: `app/client/src/graphql/book.ts` (select it on `ValidationFragment`), regenerate `src/gql/`
- Modify: `app/client/src/control/validation-detail-modal/` consumer wiring + test

**Why:** REST's `ValidationMessage` carried `segments` — the message split into display runs, where a
run with `subject: true` was a double-quoted span (quotes stripped) rendered monospaced. GraphQL
never exposed it, so the migrated modal falls back to `m.segments ?? [{ text: m.message }]` and
renders everything in one weight. The full text is never lost, but the subject emphasis is.

The value already exists server-side: `splitSubjects(m.message)` in
`app/server/services/validation-store.ts`. It is a store-only helper, so this is NEW API surface,
not restoring a removed field — say so in the field's description.

**Interfaces:**
- Produces: `type MessageSegment { text: String!, subject: Boolean! }` and
  `ValidationMessage.segments: [MessageSegment!]!`.

**Verify before writing:** the client's mirror type (`app/client/src/lib/severity.ts`) declares
`subject?: boolean` — OPTIONAL. Check what `splitSubjects` actually returns before deciding whether
the GraphQL field is `Boolean!` or `Boolean`. A non-null field over a sometimes-absent value is a
runtime error. Report which it is and why.

- [ ] **Step 1: Write the failing test**

In `app/server/graphql/schema/validation-message/model.test.ts`, following that file's harness:

```ts
it('splits a message into prose and subject runs', async () => {
  // seed a validation message whose text contains a double-quoted span
  const result = await execute(/* … validation { messages { edges { node { message segments { text subject } } } } } */);

  expect(result.errors).toBeUndefined();
  const segments = /* the node's segments */;
  expect(segments.some((s) => s.subject === true)).toBe(true);
  expect(segments.map((s) => s.text).join('')).not.toContain('"');   // quotes stripped
});

it('returns a single non-subject run for a message with no quoted span', async () => {
  expect(segments).toEqual([{ text: 'plain message', subject: false }]);
});
```

- [ ] **Step 2: Run and confirm failure**

Run: `npm run test -w app/server -- validation-message`
Expected: FAIL — `Cannot query field "segments" on type "ValidationMessage"`.

- [ ] **Step 3: Add the object type and the field**

Mirror the `validation-severity-count/` directory's structure (an `objectRef` + `implement`), which
was added earlier in this plan for the same reason — a small display-shaped type with no identity.
Resolve `segments` through the existing `splitSubjects` helper; do NOT reimplement the splitting.

- [ ] **Step 4: Regenerate the SDL and run the server gates**

```bash
npm run graphql:schema -w app/server
npm run test -w app/server
```

- [ ] **Step 5: Select it client-side, re-measure, and wire the modal**

Add `segments { text subject }` to `ValidationFragment` in `app/client/src/graphql/book.ts`, then
`npm run codegen -w app/client`. `segments` is a nested list inside `messages`, so it costs more
breadth than a scalar — `BookValidation` was breadth 33 (33.0%); **re-measure and update the doc
comment**, and confirm it is still under the 70% gate. Then wire the real segments through to
`ValidationDetailModal` so the fallback stops being the live path, and update its test.

- [ ] **Step 6: Commit**

```bash
git add app/server/graphql app/client/src
git commit -m "feat(server): expose ValidationMessage.segments, restoring subject monospacing"
```

---

## Task 13: Sweep, re-verify, and correct the documents

**Files:** the surface map, the parent spec, the step-6 spec, and whatever the sweep turns up.

- [ ] **Step 1: Count `useWithTargetUser` and reconcile against spec §5**

```bash
grep -rn 'useWithTargetUser(' app/client/src --include='*.ts' --include='*.tsx' | grep -v '\.test\.' | wc -l
```

Expected: **8**, and each one on the surface map's survivor list by name. More means something was
left behind; fewer means this plan took a later step's work. Either is a finding — investigate
before proceeding, do not adjust the expectation to match the count.

- [ ] **Step 2: Decide `use-series-book-list.ts`'s fate with a transitive trace**

Its only remaining callers are `use-my-series-progress.ts` and `use-user-series-progress.ts`.
`useUserSeriesProgress` appears to have zero non-test consumers. **Do not delete on that basis
alone** — per this project's standing rule, "hook X is dead" has been wrong twice when checked only
for direct importers, because wrapper hooks hide live callers. Trace each transitively (barrel
re-exports in `provider/*/index.ts` included) and record the trace in the commit message. If the
trace is clean, delete; if not, leave them and say why.

- [ ] **Step 3: Re-run every seen-to-fail at the branch tip**

Every property-protecting test written in Tasks 1, 9, 10 and 12 gets its guard removed once more
and re-run **at the tip**, not at the commit that introduced it. A seen-to-fail can go stale when a
later fix subsumes its effect — that happened in the devices/users plan, which is why this step
exists. Any test that no longer fails is either redundant or was protecting the wrong thing; fix or
delete it, and say which.

- [ ] **Step 4: Run every gate**

```bash
npm run test -w app/server        # expect > 1977
npm run test -w app/client        # expect > 1107
npm run test:cost -w app/server   # expect every document under 70% of both budgets
npm run lint                      # root
npm run lint -w app/client        # includes codegen freshness
```

- [ ] **Step 5: Correct the documents**

- **Step-6 spec §2**: `seriesByName` is `Library.seriesByName`, not a `Query` root field.
- **Parent spec §9**: mark row 6 ✅ Complete with the real counts.
- **Parent spec §14.8**: strike the `Progress.id` description residual (folded in at Task 2).
- **Parent spec §15**: record every user-visible divergence this step introduced. Candidates,
  each to be confirmed or dropped by what actually shipped: a >100-book series still truncates
  (carried, not new); `page/library`'s grid row for an emptied series (Task 9, Step 4); anything
  the validation-counts modal renders differently.
- **The surface map**: update the survivor table to what the sweep actually found.

- [ ] **Step 6: Commit**

```bash
git add docs app/client app/server
git commit -m "docs: record step 6's outcome and correct the specs it contradicted"
```

---

## Definition of done

- `/library/series/:name` and book detail both entirely on GraphQL; `from-book.tsx` deleted.
- `Validation.counts` shipped with a batching loader whose reject path is proven load-bearing.
- Six surviving REST routes accept a Relay global ID; the client holds no raw book id.
- `useWithTargetUser` is down to **8** consumers, each accounted for by name.
- Both suites green, `test:cost` green with no document over 70% of either budget, lint + codegen clean.
- Every user-visible divergence recorded in the parent spec's §15.

## What this plan does NOT do

- Book edit (step 7), progress screens (step 8), upload/replace (step 9), the final sweep (step 10).
- Delete `BookProvider` or `ProgressProvider` — both still serve later steps' screens.
- Delete `useBook`, `useFetchBook`, or `useMyProgress` — all three keep consumers in steps 7–8.
  `useFetchBook` stops being reached from `page/book`, but `page/book-edit` still drives it.
- Touch `progressDelete`'s `owner === null` guard (parent spec §14.8's second residual) — it
  belongs to whoever next works in that area.
