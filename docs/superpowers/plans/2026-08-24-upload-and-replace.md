# Step 9 — `/upload` and Replace onto GraphQL: Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Move the upload queue and the Replace-file modal entirely onto GraphQL, leaving only the two sanctioned binary REST seams, and fix the library grid's post-upload staleness.

**Architecture:** The server takes ownership of pending-fix state. `bookResolvePendingFix` grows a fix-subset argument and two more actions, so the client's per-fix apply logic — subject-split folding, snapshot GETs, the PUT/DELETE sync effect — is deleted rather than ported. What remains of the 572-line queue engine splits into a REST transport (XHR + concurrency), a GraphQL read, and a GraphQL action set.

**Tech Stack:** graphql-yoga + Pothos v4 + Prisma (server); Apollo Client v4 + `client-preset` codegen (client); vitest both sides.

**Spec:** `docs/superpowers/specs/2026-08-24-step9-upload-design.md`

## Global Constraints

- `BREADTH_BUDGET = 100`, `COMPLEXITY_BUDGET = 33_000`, CI headroom `0.7` (`app/server/graphql/cost-limit.ts:811,1108`). Every shipped client document must sit under 70% of BOTH.
- **Breadth is 1 per selection, UNWEIGHTED by connection page size.** Only complexity scales with page size. Raising a `first` is cheap on breadth; adding fields is not.
- **Use LITERAL page sizes in client documents.** A variable-valued `first`/`last` is priced at that field's `maxSize`, not its default (`cost-limit.ts`, `multiplierFor`).
- **SDL:** `npm run graphql:schema -w app/server` **writes** `graphql/schema.generated.graphql`. `npm run lint -w app/server` only **checks** it. Regenerating is a separate, explicit step.
- **Client codegen:** `npm run codegen -w app/client` **writes** `src/gql/`. `npm run lint -w app/client` only **checks** it (`codegen:check`). Same trap.
- Binary transfer stays REST: `POST /api/books/upload` (multipart + XHR, for progress) and `POST /api/books/replace-staging` (via `lib/staged-upload.ts`). Nothing else may use `apiFetch` in files this plan touches.
- The upload queue keys on **Relay global ids only**. No raw content hashes anywhere in `provider/upload/`.
- **Do NOT delete `BookProvider`, `use-fetch-book-list.ts`, `use-fetch-book.ts`, `use-book.ts`, `use-book-list.ts`, `use-standalone-book-list.ts`, `use-book-list-items.ts`, or `use-upload-book-list.ts`.** They are dead, and step 10 owns removing them. Half-dismantling a provider across two steps is how steps 6 and 7 both miscounted survivors.
- Fragment masking is **compile-time only** in this codebase: `FragmentType` is a type-only marker and `useFragment` is an identity cast. Never assert a field is absent at runtime because it is masked.
- Run test suites in the **FOREGROUND** and wait for them. Do not background a suite and report before it finishes.

---

## File Structure

**Server — modified**

| File | Responsibility after this plan |
|---|---|
| `graphql/schema/undo-snapshot/model.ts` | adds `originalMetadata: JSON` |
| `graphql/schema/pending-fix-resolution/index.ts` | enum grows `UNDO`, `CLEAR` |
| `graphql/schema/metadata-fix-key/index.ts` *(new)* | `MetadataFixKeyInput` |
| `graphql/schema/book/mutation/resolve-pending-fix.ts` | subset filtering + four actions + `originalMetadata` capture |
| `graphql/schema.generated.graphql` | regenerated |
| `graphql/cost-calibration.test.ts` | gains the `Library.pendingFixes` worst-case fixture |

**Client — created**

| File | Responsibility |
|---|---|
| `src/graphql/upload.ts` | every document this step ships |
| `src/provider/upload/hook/use-upload-transport.ts` | XHR, concurrency, progress, `addFiles`. The only REST left. |
| `src/provider/upload/hook/use-pending-fixes.ts` | reads `Library.pendingFixes` |
| `src/provider/upload/hook/use-fix-actions.ts` | the four `bookResolvePendingFix` calls + their cache updates |

**Client — rewritten**

| File | Change |
|---|---|
| `src/provider/upload/hook/use-upload-queue.ts` | becomes the merge of transport + server rows, exposing today's `UseUploadQueue` |
| `src/provider/upload/hook/use-upload-badge.ts` | counts server rows |
| `src/provider/upload/hook/use-pending-fixes-for-book.ts` | reads `Book.pendingFix` |
| `src/provider/book/hook/use-replace-book.ts` | staged upload + `bookAnalyzeReplace`/`bookReplace` |
| `src/provider/book/hook/use-scan-library.ts` | evicts `Library.entries` on completion |

**Client — deleted**

`src/provider/upload/api.ts`, `src/provider/book/hook/use-upload-queue.ts` (+ its two test files), `src/provider/book/hook/use-patch-book-metadata.ts` (+ test).

---

## Task 1: Server — `ACCEPT` captures `originalMetadata`

**Files:**
- Modify: `app/server/graphql/schema/book/mutation/resolve-pending-fix.ts` (the `upsertPendingFix` call at the end of the ACCEPT branch)
- Modify: `app/server/graphql/schema/undo-snapshot/model.ts` (comment only)
- Test: `app/server/graphql/schema/book/mutation/resolve-pending-fix.test.ts`

**Interfaces:**
- Consumes: nothing from earlier tasks.
- Produces: a persisted `undo.originalMetadata` on every successful `ACCEPT`. Task 3's `UNDO` reads it. It is **server-internal** — do NOT add it to the GraphQL `UndoSnapshot` type.

**Context:** `ACCEPT` applies proposals and arms an undo snapshot, but the snapshot has no
record of what the metadata was *before*, so nothing can revert it. The domain type
already has the field; the resolver simply never writes it.

- [ ] **Step 1: Write the failing test**

Add to `resolve-pending-fix.test.ts`, in the ACCEPT describe block:

```ts
it('arms the undo snapshot with the pre-accept metadata so UNDO has something to revert to', async () => {
  await seedEditableBook(harness, harness.aliceOwner, BOOK_ID, 'Old Title');
  await seedPendingFix(BOOK_ID, { proposals: [TITLE_PROPOSAL] });

  const result = await harness.execute(MUTATION, {
    viewer: harness.aliceViewer,
    variables: {
      input: { id: bookGlobalId(harness.aliceOwner.userId, BOOK_ID), action: 'ACCEPT' },
    },
  });
  expect(result.errors).toBeUndefined();

  // The row FK-cascades onto the new content-hash id, so read it back by
  // whatever id the mutation reports rather than the pre-accept BOOK_ID.
  const newId = rawBookId(
    (result.data?.bookResolvePendingFix as { book: { id: string } }).book.id
  );
  const row = await pendingFixRowFor(newId);
  expect(row).not.toBeNull();

  const state = JSON.parse(String(row!.state)) as {
    undo: { originalMetadata?: Record<string, unknown> };
  };
  expect(state.undo.originalMetadata).toEqual({
    title: 'Old Title',
    titleSort: '',
    author: '',
    authorSort: '',
    subjects: [],
  });
});
```

Adjust the expected `titleSort`/`author`/`authorSort`/`subjects` values to whatever
`seedEditableBook` actually seeds — read that helper in `./test-helpers` first and use
its real values. The assertion must be an exact `toEqual` on all five keys, not a
`toHaveProperty` on one: a partial assertion would pass against a snapshot that captured
only `title`.

- [ ] **Step 2: Run it and watch it fail**

```bash
npx vitest run graphql/schema/book/mutation/resolve-pending-fix.test.ts -t 'arms the undo snapshot'
```
Run from `app/server`. Expected: FAIL — `state.undo.originalMetadata` is `undefined`.

- [ ] **Step 3: Capture the metadata**

In `resolve-pending-fix.ts`, the ACCEPT branch's `upsertPendingFix` call currently arms:

```ts
undo: { kind: 'apply', proposals: state.proposals, appliedFixes: state.appliedFixes },
```

Replace with:

```ts
undo: {
  kind: 'apply',
  proposals: state.proposals,
  appliedFixes: state.appliedFixes,
  // Captured from the PRE-edit book, which this resolver already holds — no
  // extra read. These are the same five editable fields REST's client
  // snapshotted for itself before patching (`fetchBookSnapshot`,
  // `use-upload-queue.ts`); `UNDO` (this mutation's own action) is the only
  // reader, so it is persisted but deliberately NOT exposed on the GraphQL
  // `UndoSnapshot` type — see the step-9 spec §3.1.
  originalMetadata: {
    title: targetBook.title,
    titleSort: targetBook.titleSort,
    author: targetBook.author,
    authorSort: targetBook.authorSort,
    subjects: targetBook.subjects,
  },
},
```

`targetBook` is the pre-edit book read near the top of the resolver — it must be read
*before* `applyEpubChanges` runs, which it already is. Do not re-read it after.

- [ ] **Step 4: Update the model comment**

In `undo-snapshot/model.ts`, extend the existing doc comment so the omission stays
justified rather than looking like an oversight:

```
 * Mirrors `UndoSnapshot` in `types.ts`. `originalMetadata` is deliberately
 * left off — it is not part of the cleanup spec's SDL for this type and no
 * field here reads it. Still true after step 9, which makes `ACCEPT` persist
 * that field: its only reader is the `UNDO` action inside
 * `book/mutation/resolve-pending-fix.ts`, server-side. The client reads a
 * snapshot's existence and `kind` and nothing else.
```

- [ ] **Step 5: Run the test and the file's whole suite**

```bash
npx vitest run graphql/schema/book/mutation/resolve-pending-fix.test.ts
```
Expected: PASS, including every pre-existing test in the file.

- [ ] **Step 6: Commit**

```bash
git add app/server/graphql/schema/book/mutation/resolve-pending-fix.ts \
        app/server/graphql/schema/undo-snapshot/model.ts \
        app/server/graphql/schema/book/mutation/resolve-pending-fix.test.ts
git commit -m "feat(server): capture pre-accept metadata in the pending-fix undo snapshot"
```

No SDL regeneration — this task changes no schema types.

---

## Task 2: Server — `DISMISS` stops deleting, `CLEAR` takes over

**Files:**
- Modify: `app/server/graphql/schema/pending-fix-resolution/model.ts`
- Modify: `app/server/graphql/schema/book/mutation/resolve-pending-fix.ts`
- Modify: `app/server/graphql/schema.generated.graphql` (regenerated, not hand-edited)
- Test: `app/server/graphql/schema/book/mutation/resolve-pending-fix.test.ts`

**Interfaces:**
- Consumes: nothing from Task 1.
- Produces: `PendingFixResolution` = `ACCEPT | DISMISS | CLEAR` where `DISMISS` clears proposals and arms `undo{dismiss}`, and `CLEAR` deletes the row. Task 3 adds `UNDO` to the same enum. Task 5's client documents call all four.

**Context:** The client needs four operations; the shipped enum has two, and its `DISMISS`
does what the client calls "clear this row from the queue" rather than what it calls
"reject these proposals". Reshaping is safe: `bookResolvePendingFix` has **zero client
consumers** — the client is still on REST for pending fixes — so only server tests break.

- [ ] **Step 1: Write the failing tests**

```ts
it('DISMISS clears proposals and arms a dismiss undo, leaving the row in place', async () => {
  await seedEditableBook(harness, harness.aliceOwner, BOOK_ID, 'Untouched');
  await seedPendingFix(BOOK_ID, { proposals: [TITLE_PROPOSAL] });

  const result = await harness.execute(MUTATION, {
    viewer: harness.aliceViewer,
    variables: {
      input: { id: bookGlobalId(harness.aliceOwner.userId, BOOK_ID), action: 'DISMISS' },
    },
  });

  expect(result.errors).toBeUndefined();
  // The EPUB is never touched by a dismiss.
  expect(await titleOf(harness.aliceOwner.userId, BOOK_ID)).toBe('Untouched');

  const row = await pendingFixRowFor(BOOK_ID);
  expect(row).not.toBeNull(); // the OLD behaviour deleted it — this is the change
  const state = JSON.parse(String(row!.state)) as {
    proposals: unknown[];
    undo: { kind: string; proposals: unknown[] };
  };
  expect(state.proposals).toEqual([]);
  expect(state.undo.kind).toBe('dismiss');
  expect(state.undo.proposals).toHaveLength(1); // the dismissed proposal is recoverable
});

it('CLEAR deletes the row outright', async () => {
  await seedEditableBook(harness, harness.aliceOwner, BOOK_ID, 'Untouched');
  await seedPendingFix(BOOK_ID, { proposals: [TITLE_PROPOSAL] });

  const result = await harness.execute(MUTATION, {
    viewer: harness.aliceViewer,
    variables: {
      input: { id: bookGlobalId(harness.aliceOwner.userId, BOOK_ID), action: 'CLEAR' },
    },
  });

  expect(result.errors).toBeUndefined();
  expect(await titleOf(harness.aliceOwner.userId, BOOK_ID)).toBe('Untouched');
  expect(await pendingFixRowFor(BOOK_ID)).toBeNull();
});

it('CLEAR on a book with no pending-fix row succeeds as a no-op', async () => {
  await seedEditableBook(harness, harness.aliceOwner, BOOK_ID, 'Untouched');

  const result = await harness.execute(MUTATION, {
    viewer: harness.aliceViewer,
    variables: {
      input: { id: bookGlobalId(harness.aliceOwner.userId, BOOK_ID), action: 'CLEAR' },
    },
  });

  expect(result.errors).toBeUndefined();
  expect(result.data?.bookResolvePendingFix).not.toBeNull();
});

it('DISMISS on a row with no proposals leaves it untouched rather than arming an empty undo', async () => {
  await seedEditableBook(harness, harness.aliceOwner, BOOK_ID, 'Untouched');
  await seedPendingFix(BOOK_ID, { proposals: [], appliedFixes: [TITLE_PROPOSAL] });

  const result = await harness.execute(MUTATION, {
    viewer: harness.aliceViewer,
    variables: {
      input: { id: bookGlobalId(harness.aliceOwner.userId, BOOK_ID), action: 'DISMISS' },
    },
  });

  expect(result.errors).toBeUndefined();
  const row = await pendingFixRowFor(BOOK_ID);
  const state = JSON.parse(String(row!.state)) as { undo: unknown };
  expect(state.undo).toBeNull();
});
```

Then find every **existing** test that asserts `DISMISS` deletes the row and change it
to use `CLEAR`. Do not delete those tests — the behaviour still exists, under a new name.

- [ ] **Step 2: Run and watch them fail**

```bash
npx vitest run graphql/schema/book/mutation/resolve-pending-fix.test.ts
```
Expected: the two new DISMISS tests fail (the row is gone / no undo armed); `CLEAR` tests
fail on enum coercion — `Value "CLEAR" does not exist in "PendingFixResolution" enum`.

- [ ] **Step 3: Extend the enum**

In `pending-fix-resolution/model.ts`:

```ts
type PendingFixResolutionValue = 'accept' | 'dismiss' | 'clear';
```

and add to `values`:

```ts
    CLEAR: { value: 'clear' },
```

Keep the `as const satisfies Record<Uppercase<PendingFixResolutionValue>, …>` constraint
— it is what makes a missing case a compile error rather than a runtime surprise.

Update the type's doc comment: it currently says the mutation "covers both of REST's
pending-fix write routes via this discriminator". That is no longer the frame — the
actions are now the client's four queue operations, and `DISMISS` no longer corresponds
to REST's `DELETE`.

- [ ] **Step 4: Rewrite the DISMISS branch and add CLEAR**

Replace the existing early `if (args.input.action === 'dismiss')` block with:

```ts
      if (args.input.action === 'clear') {
        // The literal successor to REST's unconditional
        // `DELETE /api/books/:id/pending-fixes` — no row-existence check, no
        // EPUB access, always succeeds once the book itself resolves.
        await context.stores.book.deletePendingFix(owner, targetBook.id);
        return {
          __typename: 'BookResolvePendingFixPayload' as const,
          owner,
          bookId: targetBook.id,
        };
      }
```

Then, after the `row === null` / `state` parse that the ACCEPT path already performs
(hoist that read above the action switch so both branches share it):

```ts
      if (args.input.action === 'dismiss') {
        // Client-side-only in REST (`dismissAllProposals`); server-side now.
        // Never touches the EPUB, so no `valid` gate.
        if (state.proposals.length === 0) {
          return {
            __typename: 'BookResolvePendingFixPayload' as const,
            owner,
            bookId: targetBook.id,
          };
        }
        await context.stores.book.upsertPendingFix(
          owner,
          targetBook.id,
          row.fileName,
          row.fileSize,
          {
            autoFixes: state.autoFixes,
            appliedFixes: state.appliedFixes,
            proposals: [],
            undo: { kind: 'dismiss', proposals: state.proposals, appliedFixes: state.appliedFixes },
          }
        );
        return {
          __typename: 'BookResolvePendingFixPayload' as const,
          owner,
          bookId: targetBook.id,
        };
      }
```

Note the hoist: `row` and `state` must now be read before the action switch, and the
`row === null` early return applies to `DISMISS` as well as `ACCEPT` (no row means
nothing to dismiss). `CLEAR` must stay **above** that read, since it is valid with no row.

- [ ] **Step 5: Run the file's suite**

```bash
npx vitest run graphql/schema/book/mutation/resolve-pending-fix.test.ts
```
Expected: PASS, all tests.

- [ ] **Step 6: Regenerate the SDL and run the full server suite**

```bash
npm run graphql:schema -w app/server
npm test -w app/server
```

`npm run lint` only CHECKS the SDL; `graphql:schema` is what writes it. Run in the
foreground and wait. Expected: SDL diff shows `CLEAR` added to the enum; suite green.

- [ ] **Step 7: Commit**

```bash
git add app/server/graphql/schema/pending-fix-resolution/model.ts \
        app/server/graphql/schema/book/mutation/resolve-pending-fix.ts \
        app/server/graphql/schema/book/mutation/resolve-pending-fix.test.ts \
        app/server/graphql/schema.generated.graphql
git commit -m "feat(server): DISMISS clears proposals with an undo; CLEAR deletes the row"
```

---

## Task 3: Server — the `UNDO` action

**Files:**
- Modify: `app/server/graphql/schema/pending-fix-resolution/model.ts`
- Modify: `app/server/graphql/schema/book/mutation/resolve-pending-fix.ts`
- Modify: `app/server/graphql/schema.generated.graphql` (regenerated)
- Test: `app/server/graphql/schema/book/mutation/resolve-pending-fix.test.ts`

**Interfaces:**
- Consumes: Task 1's persisted `undo.originalMetadata`; Task 2's `undo{dismiss}` snapshots and the hoisted `row`/`state` read.
- Produces: `PendingFixResolution` = `ACCEPT | DISMISS | UNDO | CLEAR`, complete. Task 5's client documents call all four.

**Context:** REST's client did undo itself: re-PATCH the original metadata, `DELETE` the
book's lineage, restore the proposal list locally. With the server owning fix state,
none of those three halves can be done client-side any more — there is no state-write
mutation and the client no longer holds `originalMetadata`.

A `dismiss` undo is pure state restoration. An `apply` undo additionally reverts metadata
through the same `applyEpubChanges` path `ACCEPT` uses, so it inherits the same typed
failures and the same `valid` gate.

- [ ] **Step 1: Write the failing tests**

```ts
it('UNDO after a dismiss restores the proposals and clears the snapshot', async () => {
  await seedEditableBook(harness, harness.aliceOwner, BOOK_ID, 'Untouched');
  await seedPendingFix(BOOK_ID, {
    proposals: [],
    undo: { kind: 'dismiss', proposals: [TITLE_PROPOSAL], appliedFixes: [] },
  });

  const result = await harness.execute(MUTATION, {
    viewer: harness.aliceViewer,
    variables: {
      input: { id: bookGlobalId(harness.aliceOwner.userId, BOOK_ID), action: 'UNDO' },
    },
  });

  expect(result.errors).toBeUndefined();
  expect(await titleOf(harness.aliceOwner.userId, BOOK_ID)).toBe('Untouched');

  const state = JSON.parse(String((await pendingFixRowFor(BOOK_ID))!.state)) as {
    proposals: unknown[];
    undo: unknown;
  };
  expect(state.proposals).toHaveLength(1);
  expect(state.undo).toBeNull();
});

it('UNDO after an accept reverts the metadata to the captured original', async () => {
  await seedEditableBook(harness, harness.aliceOwner, BOOK_ID, 'Old Title');
  await seedPendingFix(BOOK_ID, { proposals: [TITLE_PROPOSAL] });

  const accepted = await harness.execute(MUTATION, {
    viewer: harness.aliceViewer,
    variables: {
      input: { id: bookGlobalId(harness.aliceOwner.userId, BOOK_ID), action: 'ACCEPT' },
    },
  });
  const acceptedId = rawBookId(
    (accepted.data?.bookResolvePendingFix as { book: { id: string } }).book.id
  );
  // Guard the premise: the accept really did change the title, so the revert
  // below is proving something.
  expect(await titleOf(harness.aliceOwner.userId, acceptedId)).toBe('New Title');

  const undone = await harness.execute(MUTATION, {
    viewer: harness.aliceViewer,
    variables: {
      input: { id: bookGlobalId(harness.aliceOwner.userId, acceptedId), action: 'UNDO' },
    },
  });

  expect(undone.errors).toBeUndefined();
  const revertedId = rawBookId(
    (undone.data?.bookResolvePendingFix as { book: { id: string } }).book.id
  );
  expect(await titleOf(harness.aliceOwner.userId, revertedId)).toBe('Old Title');

  const state = JSON.parse(String((await pendingFixRowFor(revertedId))!.state)) as {
    proposals: unknown[];
    appliedFixes: unknown[];
    undo: unknown;
  };
  expect(state.proposals).toHaveLength(1); // the proposal is back on offer
  expect(state.appliedFixes).toEqual([]);
  expect(state.undo).toBeNull();
});

it('UNDO with no armed snapshot is a no-op, not an error', async () => {
  await seedEditableBook(harness, harness.aliceOwner, BOOK_ID, 'Untouched');
  await seedPendingFix(BOOK_ID, { proposals: [TITLE_PROPOSAL] });

  const result = await harness.execute(MUTATION, {
    viewer: harness.aliceViewer,
    variables: {
      input: { id: bookGlobalId(harness.aliceOwner.userId, BOOK_ID), action: 'UNDO' },
    },
  });

  expect(result.errors).toBeUndefined();
  const state = JSON.parse(String((await pendingFixRowFor(BOOK_ID))!.state)) as {
    proposals: unknown[];
  };
  expect(state.proposals).toHaveLength(1); // untouched
});

it('a failed UNDO leaves the snapshot armed so the user can retry', async () => {
  // Spec §9.3: UNDO routes through applyEpubChanges, so it can fail the same
  // two ways ACCEPT can. A failure that consumed the snapshot would strand the
  // book in the applied state with no way back.
  await seedEditableBook(harness, harness.aliceOwner, BOOK_ID, 'Applied Title');
  await seedPendingFix(BOOK_ID, {
    proposals: [],
    appliedFixes: [TITLE_PROPOSAL],
    undo: {
      kind: 'apply',
      proposals: [TITLE_PROPOSAL],
      appliedFixes: [],
      originalMetadata: { title: 'Old Title', titleSort: '', author: '', authorSort: '', subjects: [] },
    },
  });
  vi.mocked(assertValidEpub).mockRejectedValueOnce(
    new EpubValidationError({ valid: false, messages: [], counts: EMPTY_COUNTS })
  );

  const result = await harness.execute(MUTATION, {
    viewer: harness.aliceViewer,
    variables: {
      input: { id: bookGlobalId(harness.aliceOwner.userId, BOOK_ID), action: 'UNDO' },
    },
  });

  expect(
    (result.data?.bookResolvePendingFix as { __typename: string }).__typename
  ).toBe('EpubValidationError');
  // The row is untouched: the snapshot survives for a second attempt.
  const state = JSON.parse(String((await pendingFixRowFor(BOOK_ID))!.state)) as {
    undo: { kind: string } | null;
  };
  expect(state.undo?.kind).toBe('apply');
});

it('UNDO clears the book’s organic edit lineage', async () => {
  await seedEditableBook(harness, harness.aliceOwner, BOOK_ID, 'Old Title');
  await seedPendingFix(BOOK_ID, { proposals: [TITLE_PROPOSAL] });

  const accepted = await harness.execute(MUTATION, {
    viewer: harness.aliceViewer,
    variables: {
      input: { id: bookGlobalId(harness.aliceOwner.userId, BOOK_ID), action: 'ACCEPT' },
    },
  });
  const acceptedId = rawBookId(
    (accepted.data?.bookResolvePendingFix as { book: { id: string } }).book.id
  );
  // The accept rotated the id, which is exactly what writes an organic
  // lineage row — assert the premise before asserting the clear.
  expect(
    await harness.prisma.bookLineage.count({
      where: { userId: harness.aliceOwner.userId, bookId: acceptedId },
    })
  ).toBeGreaterThan(0);

  await harness.execute(MUTATION, {
    viewer: harness.aliceViewer,
    variables: {
      input: { id: bookGlobalId(harness.aliceOwner.userId, acceptedId), action: 'UNDO' },
    },
  });

  const revertedRows = await harness.prisma.bookLineage.count({
    where: { userId: harness.aliceOwner.userId, type: 'edit' },
  });
  expect(revertedRows).toBe(0);
});
```

Before writing the lineage test, read the actual Prisma model name and the organic-vs-merge
discriminator in `prisma/schema.prisma` and in `BookStore.clearEditLineage`
(`services/book-store.ts:646`) — use the real model, field, and type value rather than the
`bookLineage` / `type: 'edit'` shown above if they differ.

- [ ] **Step 2: Run and watch them fail**

```bash
npx vitest run graphql/schema/book/mutation/resolve-pending-fix.test.ts -t UNDO
```
Expected: FAIL — `Value "UNDO" does not exist in "PendingFixResolution" enum`.

- [ ] **Step 3: Extend the enum**

```ts
type PendingFixResolutionValue = 'accept' | 'dismiss' | 'undo' | 'clear';
```

and add `UNDO: { value: 'undo' },` to `values`.

- [ ] **Step 4: Implement the branch**

After the hoisted `row`/`state` read (Task 2) and before the ACCEPT logic:

```ts
      if (args.input.action === 'undo') {
        const snapshot = state.undo;
        if (snapshot === null) {
          // Nothing armed — a double-undo or an expired row. REST's client
          // returned `true` here without a request; mirror that as a no-op
          // rather than fabricating an error.
          return {
            __typename: 'BookResolvePendingFixPayload' as const,
            owner,
            bookId: targetBook.id,
          };
        }

        let revertedId = targetBook.id;

        if (snapshot.kind === 'apply' && snapshot.originalMetadata !== undefined) {
          if (targetBook.valid !== true) {
            return bookNotValidatedError(owner, targetBook.id);
          }
          const outcome = await toResult<Book, BookHashCollisionError | EpubValidationError>(
            () => applyEpubChanges(deps, owner, targetBook, snapshot.originalMetadata as EpubChanges),
            [BookHashCollisionError, EpubValidationError]
          );
          if ('err' in outcome) {
            if (outcome.err instanceof BookHashCollisionError) {
              return bookHashCollisionError(outcome.err, owner);
            }
            if (outcome.err instanceof EpubValidationError) {
              return epubValidationError(outcome.err);
            }
            return assertUnreachableStoreError(outcome.err);
          }
          revertedId = outcome.ok.id;

          // Best-effort, exactly like REST's client: the revert stands even if
          // lineage cleanup fails, because the metadata is already back.
          try {
            await context.stores.book.clearEditLineage(owner, revertedId);
          } catch {
            // intentionally swallowed — see above
          }
        }

        await context.stores.book.upsertPendingFix(
          owner,
          revertedId,
          row.fileName,
          row.fileSize,
          {
            autoFixes: state.autoFixes,
            appliedFixes: snapshot.appliedFixes,
            proposals: snapshot.proposals,
            undo: null,
          }
        );

        return {
          __typename: 'BookResolvePendingFixPayload' as const,
          owner,
          bookId: revertedId,
        };
      }
```

`deps` is the `ApplyEpubChangesDeps` object the ACCEPT branch builds — hoist its
construction above the action switch so both branches share one instance.

**The typed-failure branches must return BEFORE `upsertPendingFix`** — this is what the
"leaves the snapshot armed" test above pins down. Match `EpubValidationError`'s real
constructor signature from `services/epub-validator.ts` when writing that test; the shape
shown is the one `update-metadata.test.ts` already uses.

**Watch the resolved⟹delete rule:** `upsertPendingFix` deletes the row when
`proposals.length === 0 && !undo` (`book-store.ts:662`). A `dismiss` undo whose snapshot
held zero proposals therefore deletes the row here rather than writing an empty one.
That is correct — a row with nothing pending and nothing armed has no reason to exist —
but the first UNDO test above must keep at least one proposal in its snapshot for
`pendingFixRowFor` to find anything.

- [ ] **Step 5: Run the file's suite**

```bash
npx vitest run graphql/schema/book/mutation/resolve-pending-fix.test.ts
```
Expected: PASS.

- [ ] **Step 6: Regenerate the SDL, full suite, lint**

```bash
npm run graphql:schema -w app/server
npm test -w app/server
npm run lint -w app/server
```
Foreground, wait for each. Expected: `UNDO` in the SDL enum; suite green; lint green
(lint includes `graphql:schema:check`, which will fail if step 6's regeneration was
skipped).

- [ ] **Step 7: Commit**

```bash
git add app/server/graphql/schema/pending-fix-resolution/model.ts \
        app/server/graphql/schema/book/mutation/resolve-pending-fix.ts \
        app/server/graphql/schema/book/mutation/resolve-pending-fix.test.ts \
        app/server/graphql/schema.generated.graphql
git commit -m "feat(server): add the UNDO action to bookResolvePendingFix"
```

---

## Task 4: Server — resolve a named subset of fixes

**Files:**
- Create: `app/server/graphql/schema/metadata-fix-key/model.ts`, `app/server/graphql/schema/metadata-fix-key/index.ts`
- Modify: `app/server/graphql/schema/book/mutation/resolve-pending-fix.ts`
- Modify: `app/server/graphql/schema.generated.graphql` (regenerated)
- Test: `app/server/graphql/schema/book/mutation/resolve-pending-fix.test.ts`

**Interfaces:**
- Consumes: Tasks 2 and 3's action branches.
- Produces: `BookResolvePendingFixInput.fixes: [MetadataFixKeyInput!]` — optional; omitting it means "every proposal", which is exactly today's behaviour. Task 5's client documents pass a one-element array for per-fix Accept/Reject and omit it for the bulk actions.

**Context:** `FixReview` renders Accept and Reject on each individual fix
(`fix-review/index.tsx:236-240`), from both `/upload` and the Replace modal. The
mutation is currently all-or-nothing, so without this the client would have to keep
applying fixes itself — which is the whole thing this step removes.

Fixes carry no server id. The client already identifies them by the triple
`field:kind:from` (`fixKey`, `use-upload-queue.ts`), which exists precisely because
several compound-subject splits share a field and kind. Positional addressing is
rejected: a stale index silently resolves the wrong fix.

- [ ] **Step 1: Write the failing tests**

```ts
const AUTHOR_PROPOSAL = {
  field: 'author',
  kind: 'replace',
  from: 'old author',
  to: 'Old Author',
  changes: { author: 'Old Author' },
};

it('ACCEPT with a fix subset applies only the named fix and leaves the rest on offer', async () => {
  await seedEditableBook(harness, harness.aliceOwner, BOOK_ID, 'Old Title');
  await seedPendingFix(BOOK_ID, { proposals: [TITLE_PROPOSAL, AUTHOR_PROPOSAL] });

  const result = await harness.execute(MUTATION, {
    viewer: harness.aliceViewer,
    variables: {
      input: {
        id: bookGlobalId(harness.aliceOwner.userId, BOOK_ID),
        action: 'ACCEPT',
        fixes: [{ field: 'title', kind: 'replace', from: 'Old Title' }],
      },
    },
  });

  expect(result.errors).toBeUndefined();
  const newId = rawBookId(
    (result.data?.bookResolvePendingFix as { book: { id: string } }).book.id
  );
  expect(await titleOf(harness.aliceOwner.userId, newId)).toBe('New Title');

  const state = JSON.parse(String((await pendingFixRowFor(newId))!.state)) as {
    proposals: { field: string }[];
    appliedFixes: { field: string }[];
  };
  expect(state.appliedFixes.map((f) => f.field)).toEqual(['title']);
  expect(state.proposals.map((f) => f.field)).toEqual(['author']);
});

it('DISMISS with a fix subset drops only the named fix', async () => {
  await seedEditableBook(harness, harness.aliceOwner, BOOK_ID, 'Old Title');
  await seedPendingFix(BOOK_ID, { proposals: [TITLE_PROPOSAL, AUTHOR_PROPOSAL] });

  const result = await harness.execute(MUTATION, {
    viewer: harness.aliceViewer,
    variables: {
      input: {
        id: bookGlobalId(harness.aliceOwner.userId, BOOK_ID),
        action: 'DISMISS',
        fixes: [{ field: 'title', kind: 'replace', from: 'Old Title' }],
      },
    },
  });

  expect(result.errors).toBeUndefined();
  expect(await titleOf(harness.aliceOwner.userId, BOOK_ID)).toBe('Old Title');
  const state = JSON.parse(String((await pendingFixRowFor(BOOK_ID))!.state)) as {
    proposals: { field: string }[];
    undo: { proposals: { field: string }[] };
  };
  expect(state.proposals.map((f) => f.field)).toEqual(['author']);
  // The undo snapshot restores the FULL pre-dismiss list, not just the dropped one.
  expect(state.undo.proposals.map((f) => f.field)).toEqual(['title', 'author']);
});

it('a fix key matching nothing is ignored rather than erroring', async () => {
  await seedEditableBook(harness, harness.aliceOwner, BOOK_ID, 'Old Title');
  await seedPendingFix(BOOK_ID, { proposals: [TITLE_PROPOSAL] });

  const result = await harness.execute(MUTATION, {
    viewer: harness.aliceViewer,
    variables: {
      input: {
        id: bookGlobalId(harness.aliceOwner.userId, BOOK_ID),
        action: 'ACCEPT',
        fixes: [{ field: 'title', kind: 'replace', from: 'Something Else Entirely' }],
      },
    },
  });

  expect(result.errors).toBeUndefined();
  // Nothing matched, so nothing was actionable, so this is the existing no-op
  // branch: the EPUB is untouched and the row still offers its proposal.
  expect(await titleOf(harness.aliceOwner.userId, BOOK_ID)).toBe('Old Title');
  const state = JSON.parse(String((await pendingFixRowFor(BOOK_ID))!.state)) as {
    proposals: unknown[];
  };
  expect(state.proposals).toHaveLength(1);
});

it('omitting fixes still resolves every proposal', async () => {
  await seedEditableBook(harness, harness.aliceOwner, BOOK_ID, 'Old Title');
  await seedPendingFix(BOOK_ID, { proposals: [TITLE_PROPOSAL, AUTHOR_PROPOSAL] });

  const result = await harness.execute(MUTATION, {
    viewer: harness.aliceViewer,
    variables: {
      input: { id: bookGlobalId(harness.aliceOwner.userId, BOOK_ID), action: 'ACCEPT' },
    },
  });

  expect(result.errors).toBeUndefined();
  const newId = rawBookId(
    (result.data?.bookResolvePendingFix as { book: { id: string } }).book.id
  );
  const state = JSON.parse(String((await pendingFixRowFor(newId))!.state)) as {
    proposals: unknown[];
    appliedFixes: unknown[];
  };
  expect(state.appliedFixes).toHaveLength(2);
  expect(state.proposals).toHaveLength(0);
});
```

- [ ] **Step 2: Run and watch them fail**

```bash
npx vitest run graphql/schema/book/mutation/resolve-pending-fix.test.ts
```
Expected: the subset tests fail — `Field "fixes" is not defined by type "BookResolvePendingFixInput"`.

- [ ] **Step 3: Create the input type**

`app/server/graphql/schema/metadata-fix-key/model.ts`:

```ts
import { builder } from '../builder';

/**
 * Addresses one `MetadataFix` inside a `PendingFix` row's `proposals`.
 *
 * `MetadataFix` has no id — it is a detected issue, regenerated per import,
 * not a stored entity. The client already identifies fixes by this exact
 * triple (`fixKey`, `provider/upload/`), which is field+kind+**from** rather
 * than field+kind because several `subjects-split` fixes on one book share a
 * field and a kind and differ only in which compound subject they split.
 *
 * Positional addressing was rejected: an index that goes stale between the
 * read and the mutation silently resolves a DIFFERENT fix, which is worse
 * than not matching at all.
 */
export const model = builder.inputType('MetadataFixKeyInput', {
  fields: (t) => ({
    field: t.string({ required: true }),
    kind: t.string({ required: true }),
    from: t.string({ required: true }),
  }),
});
```

`app/server/graphql/schema/metadata-fix-key/index.ts`:

```ts
export { model } from './model';
```

- [ ] **Step 4: Add the argument and filter with it**

In `resolve-pending-fix.ts`, import the input and add the field:

```ts
import { model as metadataFixKey } from '../../metadata-fix-key';
```

```ts
const input = builder.inputType('BookResolvePendingFixInput', {
  fields: (t) => ({
    id: t.globalID({ required: true, for: bookType }),
    action: t.field({ type: resolution, required: true }),
    // Omitted means every proposal — the shape this mutation shipped with.
    fixes: t.field({ type: [metadataFixKey], required: false }),
  }),
});
```

Add the key helper near `foldProposalsIntoChanges`:

```ts
/** The client's `fixKey` (`field:kind:from`), server-side. */
const keyOf = (fix: { field: string; kind: string; from: string }): string =>
  `${fix.field}:${fix.kind}:${fix.from}`;

/**
 * The proposals an action addresses. `null`/absent `fixes` means all of them,
 * preserving the mutation's original all-or-nothing contract. Keys that match
 * nothing are simply absent from the result — a no-longer-present fix is a
 * benign race (someone else resolved it first), not an error worth failing a
 * whole mutation over.
 */
const selectProposals = (
  proposals: readonly MetadataFix[],
  fixes: readonly { field: string; kind: string; from: string }[] | null | undefined
): MetadataFix[] => {
  if (fixes === null || fixes === undefined) return [...proposals];
  const wanted = new Set(fixes.map(keyOf));
  return proposals.filter((p) => wanted.has(keyOf(p)));
};
```

**ACCEPT** — apply the filter *before* the existing actionable filter, and keep the
non-selected proposals:

```ts
      const selected = selectProposals(state.proposals, args.input.fixes);
      const actionable = selected.filter((fix) => fix.to !== null);

      if (actionable.length === 0) { /* existing strict no-op branch, unchanged */ }
```

and in the post-success `upsertPendingFix`, the surviving proposals become "everything
not applied" rather than "everything advisory":

```ts
        const appliedKeys = new Set(actionable.map(keyOf));
        // …
        appliedFixes: [...state.appliedFixes, ...actionable],
        proposals: state.proposals.filter((fix) => !appliedKeys.has(keyOf(fix))),
```

This is behaviour-preserving when `fixes` is omitted: with everything selected, the
surviving set is exactly the advisory-only proposals the old
`state.proposals.filter(fix => fix.to === null)` produced.

**DISMISS** — drop only the selected keys; arm the undo with the FULL pre-dismiss list:

```ts
        const dismissed = selectProposals(state.proposals, args.input.fixes);
        if (dismissed.length === 0) { /* the existing no-op early return */ }
        const dismissedKeys = new Set(dismissed.map(keyOf));
        // …
        proposals: state.proposals.filter((fix) => !dismissedKeys.has(keyOf(fix))),
        undo: { kind: 'dismiss', proposals: state.proposals, appliedFixes: state.appliedFixes },
```

`UNDO` and `CLEAR` ignore `fixes` — they act on the whole row by definition.

- [ ] **Step 5: Run the file's suite**

```bash
npx vitest run graphql/schema/book/mutation/resolve-pending-fix.test.ts
```
Expected: PASS, including every pre-existing all-or-nothing test — those are the
regression guard for the "omitted means all" contract.

- [ ] **Step 6: Regenerate the SDL, full suite, lint, cost**

```bash
npm run graphql:schema -w app/server
npm test -w app/server
npm run lint -w app/server
npm run test:cost -w app/server
```
Foreground, wait for each. Expected: all green.

- [ ] **Step 7: Commit**

```bash
git add app/server/graphql/schema/metadata-fix-key/ \
        app/server/graphql/schema/book/mutation/resolve-pending-fix.ts \
        app/server/graphql/schema/book/mutation/resolve-pending-fix.test.ts \
        app/server/graphql/schema.generated.graphql
git commit -m "feat(server): resolve a named subset of a book's pending fixes"
```

---

## Task 5: Client — the documents

**Files:**
- Create: `app/client/src/graphql/upload.ts`
- Modify: `app/server/graphql/cost-calibration.test.ts` (replace the stale thin `pending-fixes list` fixture)
- Test: measured by `npm run test:cost -w app/server`, which reads the generated manifest

**Interfaces:**
- Consumes: Tasks 1–4's server schema.
- Produces: `PendingFixRowFragment`, `LibraryPendingFixesDocument`, `BookResolvePendingFixDocument`, `UploadConfigDocument`, `BookAnalyzeReplaceDocument`, `BookReplaceDocument`. Tasks 6–11 import these from `~/graphql/upload`.

**Context:** Costs were measured against the real schema before this plan was written, so
the shape below is known to fit: `undo { kind }` only, no nested snapshot arrays. Selecting
`undo { proposals { … } appliedFixes { … } }` doubles breadth (60 vs 30) and buys nothing
— `fix-review/index.tsx` reads a snapshot's existence and its `kind`, nothing else.

- [ ] **Step 1: Write the documents**

```ts
import { graphql } from '~/gql';

/**
 * One `MetadataFix`. `changes` is a `JSON` scalar leaf — a heterogeneous
 * per-field patch payload with no natural GraphQL representation.
 */
export const MetadataFixFragment = graphql(`
  fragment MetadataFixFragment on MetadataFix {
    field
    kind
    from
    to
    reason
    fromChips
    toChips
    changes
  }
`);

/**
 * One pending-fix row.
 *
 * `undo { kind }` and NOTHING else is deliberate. The snapshot's own
 * `proposals`/`appliedFixes` are what the server restores on an `UNDO`, and
 * `originalMetadata` is not exposed at all — the client renders only whether
 * an undo is armed and its kind, for the button label
 * (`fix-review/index.tsx`). Selecting the nested arrays doubles this
 * document's breadth (measured: 60 vs 30) for fields nothing reads.
 *
 * `book` is non-null on this type (`PendingFix.book: Book!`), unlike
 * `Progress.book`.
 */
export const PendingFixRowFragment = graphql(`
  fragment PendingFixRowFragment on PendingFix {
    id
    fileName
    fileSize
    book {
      id
      title
      author
    }
    state {
      autoFixes {
        ...MetadataFixFragment
      }
      appliedFixes {
        ...MetadataFixFragment
      }
      proposals {
        ...MetadataFixFragment
      }
      undo {
        kind
      }
    }
  }
`);

/**
 * Every pending-fix row in the current library. `Library.pendingFixes` is an
 * unpaginated `[PendingFix!]!` — measured and admitted (see this document's
 * recorded numbers below), so no `first` argument is needed.
 *
 * Rooted at `node(id:)` because a `Library` global ID is what
 * `useCurrentLibraryId()` hands out, and that id serves admins (viewing
 * another user's library) and non-admins alike.
 */
export const LibraryPendingFixesDocument = graphql(`
  query LibraryPendingFixes($libraryId: ID!) {
    node(id: $libraryId) {
      __typename
      ... on Library {
        id
        pendingFixes {
          ...PendingFixRowFragment
        }
      }
    }
  }
`);

/**
 * Accept / dismiss / undo / clear, all four through one mutation.
 *
 * `library { id pendingFixes }` is selected so the row list reconciles IN
 * PLACE — the payload carries `library` for exactly this purpose (see the
 * resolver's own field comment). Without it, every action would need a
 * follow-up refetch.
 *
 * `book { id }` is selected because an `ACCEPT` (or an `UNDO` of one) rewrites
 * the EPUB and mints a NEW content-hash id; callers need the new id to keep
 * pointing at the right book.
 */
export const BookResolvePendingFixDocument = graphql(`
  mutation BookResolvePendingFix(
    $id: ID!
    $action: PendingFixResolution!
    $fixes: [MetadataFixKeyInput!]
  ) {
    bookResolvePendingFix(input: { id: $id, action: $action, fixes: $fixes }) {
      __typename
      ... on BookResolvePendingFixPayload {
        book {
          id
          title
          author
        }
        library {
          id
          pendingFixes {
            ...PendingFixRowFragment
          }
        }
      }
      ... on BookHashCollisionError {
        message
      }
      ... on BookNotValidatedError {
        message
      }
      ... on EpubValidationError {
        message
      }
    }
  }
`);

/** Replaces `GET /api/config`. The upload queue reads only the concurrency cap. */
export const UploadConfigDocument = graphql(`
  query UploadConfig {
    config {
      maxConcurrentUploads
    }
  }
`);

/**
 * Read-only analysis of a staged EPUB as a replacement candidate. The staged
 * upload is NOT consumed, so a user can analyze, review the proposed fixes,
 * and then commit the same `stagedUploadId` via `BookReplace`.
 */
export const BookAnalyzeReplaceDocument = graphql(`
  mutation BookAnalyzeReplace($id: ID!, $stagedUploadId: String!) {
    bookAnalyzeReplace(input: { id: $id, stagedUploadId: $stagedUploadId }) {
      __typename
      ... on BookAnalyzeReplacePayload {
        valid
        autoFixes {
          ...MetadataFixFragment
        }
        proposals {
          ...MetadataFixFragment
        }
      }
      ... on InvalidInputError {
        message
      }
      ... on StagedUploadNotFoundError {
        message
      }
    }
  }
`);

/** Commits the staged replacement. Returns the post-replace book, whose id may have rotated. */
export const BookReplaceDocument = graphql(`
  mutation BookReplace($id: ID!, $stagedUploadId: String!, $acceptedFixes: [MetadataFixKeyInput!]) {
    bookReplace(
      input: { id: $id, stagedUploadId: $stagedUploadId, acceptedFixes: $acceptedFixes }
    ) {
      __typename
      ... on BookReplacePayload {
        book {
          id
          title
          author
        }
      }
      ... on BookHashCollisionError {
        message
      }
      ... on EpubValidationError {
        message
      }
      ... on InvalidInputError {
        message
      }
      ... on StagedUploadNotFoundError {
        message
      }
    }
  }
`);
```

**Before writing `BookAnalyzeReplaceDocument` and `BookReplaceDocument`, read the real
input and payload shapes** in `app/server/graphql/schema.generated.graphql`
(`BookAnalyzeReplaceInput`, `BookAnalyzeReplacePayload`, `BookReplaceInput`,
`BookReplacePayload`) and their union members. The selections above are written from the
union lists in the SDL, but the payload FIELD names must be taken from the file — do not
guess `valid`/`autoFixes`/`proposals` if the payload names them differently. If
`BookReplaceInput` has no `acceptedFixes` field, drop that variable and note it for
Task 10, which is the task that needs it.

- [ ] **Step 2: Generate types and measure**

```bash
npm run codegen -w app/client
npm run test:cost -w app/server
```

`npm run lint -w app/client` only CHECKS codegen output; `codegen` is what writes it.

- [ ] **Step 3: Record the measured numbers**

`test:cost` prints one row per shipped operation. Copy the real breadth/complexity
figures for `LibraryPendingFixes`, `BookResolvePendingFix`, `UploadConfig`,
`BookAnalyzeReplace` and `BookReplace` into each document's doc comment, in the house
format used throughout `src/graphql/`:

```
 * Measured (`npm run test:cost -w app/server`): breadth NN (NN.N%), complexity
 * NNNN (N.N%) of budget.
```

**Both figures must be under 70%.** If `LibraryPendingFixes` exceeds it, stop and
escalate — the remedy is a `first` argument on `Library.pendingFixes`, which is a schema
change and belongs in a server task, not here.

- [ ] **Step 4: Refresh the stale calibration fixture**

`app/server/graphql/cost-calibration.test.ts` carries a `pending-fixes list (repo-corpus
legit screen)` fixture selecting only `{ id fileName createdAt book { id title } }`. That
is no longer what ships. Replace its `source` with the real shipped shape (the fragment
inlined) and rename it to say so, so the calibration corpus keeps describing reality.

- [ ] **Step 5: Verify**

```bash
npm run test:cost -w app/server
npm run lint -w app/client
```
Foreground. Expected: both green; the calibration row reflects the new shape.

- [ ] **Step 6: Commit**

```bash
git add app/client/src/graphql/upload.ts app/client/src/gql/ \
        app/server/graphql/cost-calibration.test.ts
git commit -m "feat(client): add the upload and replace GraphQL documents"
```

---

## Task 6: Client — the REST transport, extracted

**Files:**
- Create: `app/client/src/provider/upload/hook/use-upload-transport.ts`
- Create: `app/client/src/provider/upload/hook/use-upload-transport.test.tsx`

**Interfaces:**
- Consumes: `UploadConfigDocument` from `~/graphql/upload`.
- Produces:
  ```ts
  export type TransportStatus = 'queued' | 'uploading' | 'done' | 'error';
  export type TransportItem = {
    id: string;              // session counter, never a book id
    fileName: string;
    fileSize: number;
    status: TransportStatus;
    bytesUploaded: number;
    errorMessage?: string;
    validation?: ValidationFailure;
    bookGlobalId?: string;   // from the upload response's `globalId`
    autoFixes?: MetadataFix[];
    proposals?: MetadataFix[];
  };
  export type UseUploadTransport = {
    items: TransportItem[];
    addFiles: (files: FileList) => void;
    dropItem: (id: string) => void;
  };
  // `onUploaded` fires once per SUCCESSFUL upload. It takes no arguments:
  // Task 9's implementation evicts a library-wide cache field and refetches,
  // neither of which needs to know which book arrived.
  export const useUploadTransport = (onUploaded: () => void): UseUploadTransport => { … };
  ```
  Task 8 merges these items with server rows.

**Context:** This is the XHR half of today's `provider/book/hook/use-upload-queue.ts`,
lifted out unchanged in behaviour. It is the ONLY part of the queue that stays REST —
`POST /api/books/upload` is sanctioned seam 3, because multipart + XHR is the only way to
get upload progress.

**Do not port** `serializeState`, `stateOf`, `syncedRef`, the sync effect, `applyPatch`,
`applySplit`, `changesToPatch`, `fetchBookSnapshot`, or `isSubjectSplit`. The server owns
all of that now.

- [ ] **Step 1: Write the failing test**

```tsx
import { MockedResponse } from '@apollo/client/testing';
import { UploadConfigDocument } from '~/graphql/upload';
import { renderHookWithApollo } from '~/test-utils';
import { useUploadTransport } from './use-upload-transport';

const configMock: MockedResponse = {
  request: { query: UploadConfigDocument },
  result: { data: { config: { __typename: 'Config', maxConcurrentUploads: 2 } } },
};

it('reads the concurrency cap from GraphQL, not GET /api/config', async () => {
  const apiFetchSpy = vi.spyOn(globalThis, 'fetch');
  const { result } = renderHookWithApollo(() => useUploadTransport(() => {}), {
    mocks: [configMock],
  });

  await waitFor(() => expect(result.current).toBeDefined());
  // The old implementation fetched /api/config on mount. Nothing may.
  const configCalls = apiFetchSpy.mock.calls.filter(([url]) =>
    String(url).includes('/api/config')
  );
  expect(configCalls).toEqual([]);
});

it('starts at most maxConcurrentUploads XHRs at once', async () => {
  const opened: string[] = [];
  stubXhr({ onOpen: (_method, url) => opened.push(url) });

  const { result } = renderHookWithApollo(() => useUploadTransport(() => {}), {
    mocks: [configMock], // maxConcurrentUploads: 2
  });
  await waitFor(() => expect(result.current).toBeDefined());

  act(() =>
    result.current.addFiles(
      fileListOf(
        new File(['a'], 'a.epub'),
        new File(['b'], 'b.epub'),
        new File(['c'], 'c.epub'),
        new File(['d'], 'd.epub'),
        new File(['e'], 'e.epub')
      )
    )
  );

  // Five queued, cap of 2: exactly two requests may be in flight. Assert the
  // cap came from GraphQL, not the hard-coded default of 3 — a test that
  // allowed 3 would pass against the fallback and prove nothing.
  await waitFor(() => expect(opened).toHaveLength(2));
  expect(result.current.items.filter((i) => i.status === 'uploading')).toHaveLength(2);
  expect(result.current.items.filter((i) => i.status === 'queued')).toHaveLength(3);
});
```

Read `app/client/src/provider/book/hook/use-upload-queue.test.ts` and
`use-upload-queue.test.tsx` first and **reuse their `XMLHttpRequest` stub** rather than
writing a new one — those two files are the existing coverage for this exact machinery,
and their stub already models `upload.onprogress`, `onload`, `onerror`, and `status`.

- [ ] **Step 2: Run and watch it fail**

```bash
npx vitest run src/provider/upload/hook/use-upload-transport.test.tsx
```
Run from `app/client`. Expected: FAIL — module not found.

- [ ] **Step 3: Implement**

Copy the XHR engine from `provider/book/hook/use-upload-queue.ts` — `startedRef`,
`xhrMapRef`, `nextIdRef`, the rolling-concurrency effect, `addFiles`, and the
`ensureFreshToken` + `withTargetUser('/api/books/upload')` send path — into the new file,
with these changes:

1. `maxConcurrent` comes from `useQuery(UploadConfigDocument)`, defaulting to 3 while
   loading or on error, exactly as the old `catch` did.
2. `xhr.onload`'s success branch stores `bookGlobalId: result?.globalId` and **drops
   `bookId`**. Nothing downstream needs the raw id (Global Constraints).
3. After a successful upload it calls `onUploaded()` instead of
   `clearCompleteBookIdsRef.current()` + `fetchBookListRef.current()`. Task 9 supplies a
   real callback; passing `() => {}` is correct until then.
4. `dropItem(id)` removes a row locally. It replaces the local half of
   `dismissCompleted`; the server half becomes a `CLEAR` mutation in Task 7.

Keep `useWithTargetUser` — an admin uploading on another user's behalf still needs
`?user=` on the multipart POST.

- [ ] **Step 4: Run the tests**

```bash
npx vitest run src/provider/upload/hook/use-upload-transport.test.tsx
```
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add app/client/src/provider/upload/hook/use-upload-transport.ts \
        app/client/src/provider/upload/hook/use-upload-transport.test.tsx
git commit -m "feat(client): extract the upload XHR transport, config over GraphQL"
```

The old `provider/book/hook/use-upload-queue.ts` is still in place and still wired up —
Task 8 removes it. Nothing is broken at this commit.

---

## Task 7: Client — the pending-fix read and the four actions

**Files:**
- Create: `app/client/src/provider/upload/hook/use-pending-fixes.ts` (+ `.test.tsx`)
- Create: `app/client/src/provider/upload/hook/use-fix-actions.ts` (+ `.test.tsx`)

**Interfaces:**
- Consumes: `LibraryPendingFixesDocument`, `BookResolvePendingFixDocument`, `PendingFixRowFragment` from `~/graphql/upload`; `useCurrentLibraryId()` from `~/provider/library-target`.
- Produces:
  ```ts
  // The query's own row type, NOT `FragmentType<…>`: Task 8 reads `.book.id`
  // and `.state` off these directly. Masking in this codebase is compile-time
  // only (`useFragment` is an identity cast), so exposing the concrete row
  // type here is honest rather than a workaround.
  export type PendingFixRow = NonNullable<
    Extract<LibraryPendingFixesQuery['node'], { __typename: 'Library' }>
  >['pendingFixes'][number];
  export const usePendingFixes = (): {
    rows: PendingFixRow[];
    loading: boolean;
    error: string | undefined;
    refetch: () => void;
  };

  export type FixKey = { field: string; kind: string; from: string };
  export const useFixActions = (): {
    acceptFixes: (bookGlobalId: string, fixes?: FixKey[]) => Promise<boolean>;
    dismissFixes: (bookGlobalId: string, fixes?: FixKey[]) => Promise<boolean>;
    undoFixes: (bookGlobalId: string) => Promise<boolean>;
    clearFixes: (bookGlobalId: string) => Promise<boolean>;
    error: string | undefined;
  };
  ```
  Task 8 consumes both.

**Context:** `useCurrentLibraryId()` returns `{ libraryId, loading }` and serves admins
(who read the `library-target` selection) and non-admins (who always get their own
`viewer.library.id`) alike. Never reach for `useLibraryTarget()` directly here.

Each action returns `true` on success and `false` on any typed error or network failure,
matching the boolean contract `page/upload` already expects from `applyFix`/`undo`.

- [ ] **Step 1: Write the failing tests**

```tsx
it('reads the current library’s pending fixes', async () => {
  const { result } = renderHookWithApollo(() => usePendingFixes(), {
    mocks: [viewerBootstrapMock, pendingFixesMock],
  });
  await waitFor(() => expect(result.current.loading).toBe(false));
  expect(result.current.rows).toHaveLength(1);
});

it('skips the query entirely while no library id is resolved', async () => {
  // An admin with no target selected must not fire a query with libraryId: ''.
  const { result } = renderHookWithApollo(() => usePendingFixes(), {
    mocks: [adminWithNoTargetMock], // deliberately NO pendingFixes mock
  });
  await waitFor(() => expect(result.current.loading).toBe(false));
  expect(result.current.rows).toEqual([]);
  expect(result.current.error).toBeUndefined(); // a missing mock would surface as an error
});

it('accepts a single named fix', async () => {
  const { result } = renderHookWithApollo(() => useFixActions(), {
    mocks: [acceptOneFixMock],
  });
  await expect(
    result.current.acceptFixes(BOOK_GID, [{ field: 'title', kind: 'replace', from: 'Old' }])
  ).resolves.toBe(true);
});

it('reports a typed error as false and surfaces its message', async () => {
  const { result } = renderHookWithApollo(() => useFixActions(), {
    mocks: [acceptCollisionMock], // resolves to BookHashCollisionError
  });
  await expect(result.current.acceptFixes(BOOK_GID)).resolves.toBe(false);
  await waitFor(() => expect(result.current.error).toBe('a book with that content already exists'));
});

it('omits `fixes` from the variables entirely for a bulk action', async () => {
  // MockedResponse matches on variables, so a mock declared WITHOUT `fixes`
  // only matches if the hook truly omits it — passing `fixes: undefined`
  // explicitly would fail this test, which is the point.
  const { result } = renderHookWithApollo(() => useFixActions(), {
    mocks: [acceptAllMock],
  });
  await expect(result.current.acceptFixes(BOOK_GID)).resolves.toBe(true);
});
```

Build each mock with an explicit `MockedResponse<LibraryPendingFixesQuery>` /
`MockedResponse<BookResolvePendingFixMutation>` annotation — `renderHookWithApollo`'s own
doc comment warns that an unannotated object literal type-checks permissively and
silently stops catching shape drift.

- [ ] **Step 2: Run and watch them fail**

```bash
npx vitest run src/provider/upload/hook/use-pending-fixes.test.tsx src/provider/upload/hook/use-fix-actions.test.tsx
```
Expected: FAIL — modules not found.

- [ ] **Step 3: Implement `use-pending-fixes.ts`**

```ts
export const usePendingFixes = () => {
  const { libraryId, loading: libraryIdLoading } = useCurrentLibraryId();
  const { data, loading, error, refetch } = useQuery(LibraryPendingFixesDocument, {
    variables: { libraryId: libraryId ?? '' },
    skip: libraryId === undefined,
  });

  const library = data?.node?.__typename === 'Library' ? data.node : undefined;
  return {
    rows: library?.pendingFixes ?? [],
    // A SKIPPED useQuery reports loading:false, so fold the id's own loading
    // in — otherwise an admin whose target is still resolving renders "no
    // pending fixes" for a frame. Same correction `useLibraryEntries` carries.
    loading: libraryIdLoading || loading,
    error: error?.message,
    refetch: () => void refetch(),
  };
};
```

- [ ] **Step 4: Implement `use-fix-actions.ts`**

One `useMutation(BookResolvePendingFixDocument)` and one shared runner:

```ts
const run = useCallback(
  async (id: string, action: PendingFixResolution, fixes?: FixKey[]): Promise<boolean> => {
    setError(undefined);
    try {
      const { data } = await resolve({
        // `fixes` is OMITTED, not passed as undefined, for bulk actions —
        // "absent" is what the server reads as "every proposal".
        variables: fixes === undefined ? { id, action } : { id, action, fixes },
      });
      const result = unwrapResult<BookResolvePendingFixPayload>(
        data?.bookResolvePendingFix,
        'BookResolvePendingFixPayload'
      );
      if (result.status === 'ok') return true;
      setError(result.status === 'error' ? result.message : 'Failed to update fixes');
      return false;
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to update fixes');
      return false;
    }
  },
  [resolve]
);
```

with `acceptFixes`/`dismissFixes`/`undoFixes`/`clearFixes` as thin wrappers passing
`'ACCEPT'`/`'DISMISS'`/`'UNDO'`/`'CLEAR'`. `undoFixes` and `clearFixes` never pass
`fixes`.

Extract the payload type the way the codebase already does — `unwrapResult`'s `TPayload`
sits where TypeScript cannot infer it:

```ts
type BookResolvePendingFixPayload = Extract<
  NonNullable<BookResolvePendingFixMutation['bookResolvePendingFix']>,
  { __typename: 'BookResolvePendingFixPayload' }
>;
```

**No manual cache writes.** The mutation selects `library { id pendingFixes { … } }`, so
Apollo reconciles the list from the payload by itself. Task 9 adds the one eviction that
the payload genuinely cannot express.

- [ ] **Step 5: Run the tests**

```bash
npx vitest run src/provider/upload/hook/use-pending-fixes.test.tsx src/provider/upload/hook/use-fix-actions.test.tsx
```
Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add app/client/src/provider/upload/hook/use-pending-fixes.ts \
        app/client/src/provider/upload/hook/use-fix-actions.ts \
        app/client/src/provider/upload/hook/use-pending-fixes.test.tsx \
        app/client/src/provider/upload/hook/use-fix-actions.test.tsx
git commit -m "feat(client): read pending fixes and resolve them over GraphQL"
```

---

## Task 8: Client — merge the queue, delete the REST engine

**Files:**
- Rewrite: `app/client/src/provider/upload/hook/use-upload-queue.ts` (+ new `.test.tsx`)
- Modify: `app/client/src/provider/upload/provider.tsx`, `app/client/src/provider/upload/context.ts`, `app/client/src/provider/upload/index.ts`
- Delete: `app/client/src/provider/upload/api.ts`, `app/client/src/provider/upload/api.test.ts`
- Delete: `app/client/src/provider/book/hook/use-upload-queue.ts`, `use-upload-queue.test.ts`, `use-upload-queue.test.tsx`
- Delete: `app/client/src/provider/book/hook/use-patch-book-metadata.ts`, `use-patch-book-metadata.test.tsx`
- Modify: `app/client/src/provider/book/hook/index.ts`, `app/client/src/provider/book/index.ts` (drop the removed exports)

**Interfaces:**
- Consumes: `useUploadTransport` (Task 6), `usePendingFixes` + `useFixActions` (Task 7).
- Produces: `useUploadQueueEngine(): UseUploadQueue` — the SAME `UseUploadQueue` shape the context already declares, so `page/upload` and `FixReview` keep working. `UploadItem` moves to `provider/upload` and **loses `bookId`**; `bookGlobalId` is the only book identifier.

**Context:** This is the task that makes the step real. A queue item now comes from one of
two places, or both:

- a **live** transport item (this session's upload, has a `file`, shows progress)
- a **server** pending-fix row (survives reloads, carries the fix state)

They join on `bookGlobalId`: once an upload completes, its transport item and the server
row it created describe the same book and must render as ONE row.

- [ ] **Step 1: Write the failing test**

```tsx
it('renders one row, not two, when a live upload and its server row describe the same book', async () => {
  const { result } = renderHookWithApollo(() => useUploadQueueEngine(), {
    mocks: [viewerBootstrapMock, pendingFixesMockFor(BOOK_GID)],
  });
  act(() => result.current.addFiles(fileListOf(new File(['x'], 'dune.epub'))));
  await completeTheUploadWith(BOOK_GID); // drives the XHR stub's onload

  await waitFor(() => expect(result.current.items).toHaveLength(1));
  expect(result.current.items[0]!.bookGlobalId).toBe(BOOK_GID);
  expect(result.current.items[0]!.proposals).toHaveLength(1); // from the server row
});

it('keeps a server row that no live item matches', async () => {
  const { result } = renderHookWithApollo(() => useUploadQueueEngine(), {
    mocks: [viewerBootstrapMock, pendingFixesMockFor(BOOK_GID)],
  });
  await waitFor(() => expect(result.current.items).toHaveLength(1));
  expect(result.current.items[0]!.status).toBe('done');
});

it('keeps a live item that has no server row (a clean upload with no fixes)', async () => {
  const { result } = renderHookWithApollo(() => useUploadQueueEngine(), {
    mocks: [viewerBootstrapMock, emptyPendingFixesMock],
  });
  act(() => result.current.addFiles(fileListOf(new File(['x'], 'clean.epub'))));
  await completeTheUploadWith(BOOK_GID);
  await waitFor(() => expect(result.current.items).toHaveLength(1));
  expect(result.current.items[0]!.proposals ?? []).toEqual([]);
});
```

- [ ] **Step 2: Run and watch it fail**

```bash
npx vitest run src/provider/upload/hook/use-upload-queue.test.tsx
```
Expected: FAIL.

- [ ] **Step 3: Implement the merge**

```ts
export const useUploadQueueEngine = (): UseUploadQueue => {
  const { rows, refetch } = usePendingFixes();
  const transport = useUploadTransport(() => refetch());
  const actions = useFixActions();

  const items = useMemo(() => {
    const byBook = new Map(rows.map((r) => [r.book.id, r]));
    const live: UploadItem[] = transport.items.map((t) => {
      const row = t.bookGlobalId ? byBook.get(t.bookGlobalId) : undefined;
      if (row) byBook.delete(t.bookGlobalId!); // claimed — don't emit it twice
      return mergeRow(t, row);
    });
    // Whatever is left has no live counterpart: a reload's reseeded rows.
    const seeded = [...byBook.values()].map(seededRow);
    return [...seeded, ...live];
  }, [rows, transport.items]);
  …
};
```

Key rules:

- **Seeded rows come first**, matching today's `setItems((prev) => [...seeded, ...prev])`.
- Fix state (`autoFixes`, `appliedFixes`, `proposals`, `undo`) is read from the SERVER row
  whenever one exists. The transport's own `autoFixes`/`proposals` (from the upload
  response) are the fallback for a book with no row yet.
- A seeded row's `status` is `'done'` and its `bytesUploaded` is its `fileSize`.
- The item's React key is the server row's `PendingFix.id` when seeded, else the
  transport's session id. `PendingFix.id` rotates when an `ACCEPT` rewrites the EPUB, so
  that row remounts — accepted deliberately (spec §4.4), not worked around.

Then map the public callbacks onto the actions:

| `UseUploadQueue` member | Implementation |
|---|---|
| `applyFix(itemId, fix)` | `acceptFixes(gid, [fixKeyOf(fix)])` |
| `applyAllProposals(itemId)` | `acceptFixes(gid)` |
| `dismissFix(itemId, fix)` | `dismissFixes(gid, [fixKeyOf(fix)])` |
| `dismissAllProposals(itemId)` | `dismissFixes(gid)` |
| `undo(itemId)` | `undoFixes(gid)` |
| `dismissCompleted(itemId)` | `transport.dropItem(itemId)` then `clearFixes(gid)` if the item has one |

`fixKeyOf` is a one-liner that lives beside the existing `fixKey` string helper — the
server takes the triple as an object, not as a joined string:

```ts
export const fixKeyOf = (fix: MetadataFix): FixKey => ({
  field: fix.field,
  kind: fix.kind,
  from: fix.from,
});
```

`dismissAllProposals` and `dismissFix` are declared synchronous (`() => void`) in today's
`UseUploadQueue`. They become async. Update the type in `provider/upload/context.ts` and
the `page/upload` call sites — `dismissFix` is called as a bare statement, so it needs a
`void` prefix or an `await`, not a silent floating promise.

- [ ] **Step 4: Rewire and delete**

- `provider/upload/provider.tsx` imports `useUploadQueueEngine` from `./hook/use-upload-queue` instead of `~/provider/book`.
- Move `UploadItem`, `UploadItemStatus`, `MetadataFix`-adjacent types and `fixKey` into `provider/upload/`; re-export from `provider/upload/index.ts`. Update every importer of `UploadItem`/`UndoSnapshot` from `~/provider/book` — `component/upload-item`, `component/fix-review`, `control/upload-replace-modal`, `page/upload`.
- Delete the six files listed above and remove their barrel exports.

- [ ] **Step 5: Verify nothing still imports the deleted modules**

```bash
grep -rn "provider/upload/api\|usePatchBookMetadata\|useUploadQueueEngine" app/client/src | grep -v node_modules
```
Expected: only `provider/upload/`'s own new files.

- [ ] **Step 6: Full client suite + lint**

```bash
npm test -w app/client
npm run lint -w app/client
```
Foreground, wait. Expected: green. `tsc --noEmit` inside lint is what catches a missed
`UploadItem` importer.

- [ ] **Step 7: Commit**

```bash
git add -A app/client/src/provider/upload app/client/src/provider/book \
        app/client/src/component app/client/src/control app/client/src/page/upload
git commit -m "feat(client): merge the upload queue onto GraphQL, delete the REST engine"
```

---

## Task 9: Client — refresh the grid after an upload and after a scan

**Files:**
- Modify: `app/client/src/provider/upload/hook/use-upload-queue.ts` (+ its test)
- Modify: `app/client/src/provider/upload/hook/use-fix-actions.ts` (+ its test)
- Modify: `app/client/src/provider/book/hook/use-scan-library.ts` (+ `use-scan-library.test.tsx`)

**Interfaces:**
- Consumes: Tasks 6–8.
- Produces: no new exports. `useScanLibrary` keeps its current public shape.

**Context — this fixes a live defect, it is not migration bookkeeping.** Nothing currently
refreshes the GraphQL grid after an upload. `use-delete-book.ts:100-107` and
`use-update-book-metadata.ts` both evict `Library.entries` after mutating; the upload queue
instead calls `fetchBookList()`, which refreshes the REST book-list cache — and nothing
renders from that cache any more. `LibraryEntriesDocument` is cache-first, so a newly
uploaded book does not appear in `/library` until an unrelated mutation happens to evict
entries or the user hard-reloads. `useScanLibrary` has the identical defect, and a scan
adds or removes many books at once.

The reason it went unnoticed is that no test asserts an uploaded book reaches the grid.
Both tests below must be **seen-to-fail**: write them, watch them fail against the current
code, then fix.

- [ ] **Step 1: Write the failing tests**

For the upload path, in `use-upload-queue.test.tsx`:

```tsx
it('invalidates the LibraryEntries connection after a completed upload, so the grid refetches', async () => {
  const { result, client } = renderHookWithApollo(() => useUploadQueueEngine(), {
    mocks: [viewerBootstrapMock, entriesMock, emptyPendingFixesMock, entriesRefetchMock],
  });

  // Seed the connection, then prove it is really in the cache — otherwise a
  // broken assertion below could "pass" against a cache that was empty all along.
  await client.query({ query: LibraryEntriesDocument, variables: ENTRIES_VARS });
  expect(
    client.cache.readQuery({ query: LibraryEntriesDocument, variables: ENTRIES_VARS })
  ).not.toBeNull();

  act(() => result.current.addFiles(fileListOf(new File(['x'], 'dune.epub'))));
  await completeTheUploadWith(BOOK_GID);

  await waitFor(() =>
    expect(
      client.cache.readQuery({ query: LibraryEntriesDocument, variables: ENTRIES_VARS })
    ).toBeNull()
  );
});
```

For the scan path, the same shape in `use-scan-library.test.tsx`, driving the hook to a
completed scan the way that file's existing tests already do.

- [ ] **Step 2: Run and watch BOTH fail**

```bash
npx vitest run src/provider/upload/hook/use-upload-queue.test.tsx src/provider/book/hook/use-scan-library.test.tsx
```
Expected: FAIL — the connection is still readable, because nothing evicts it. **Record
this failure output in the task report.** A seen-to-fail claim without the failing output
is not evidence.

- [ ] **Step 3: Evict after an upload**

In `use-upload-queue.ts`, the `onUploaded` callback handed to `useUploadTransport` becomes:

```ts
const client = useApolloClient();
const { libraryId } = useCurrentLibraryId();

const onUploaded = useCallback(() => {
  // The upload lands over XHR, so there is no mutation payload for Apollo to
  // reconcile from — the invalidation has to be explicit. Same field-level
  // eviction `use-delete-book` performs, and for the same reason: the new
  // book's position in a sorted, filtered, paginated connection is the
  // server's to decide, so the only correct move is to drop the stored
  // connection and let the next read miss.
  if (libraryId !== undefined) {
    client.cache.evict({
      id: client.cache.identify({ __typename: 'Library', id: libraryId }),
      fieldName: 'entries',
    });
    client.cache.gc();
  }
  refetch(); // the new book may have arrived with proposals
}, [client, libraryId, refetch]);
```

- [ ] **Step 4: Evict after an ACCEPT or an UNDO**

In `use-fix-actions.ts`, add an `update` to the mutation that evicts `entries` — but only
for the two actions that rewrite the EPUB:

```ts
update: (cache, { data }) => {
  // ACCEPT applies metadata; UNDO reverts it. Both change the fields the grid
  // sorts and filters on, so both move the book's position in the connection.
  // DISMISS and CLEAR only touch the pending-fix row, which the payload's own
  // `library { pendingFixes }` selection already reconciles.
  if (action !== 'ACCEPT' && action !== 'UNDO') return;
  const result = unwrapResult<BookResolvePendingFixPayload>(
    data?.bookResolvePendingFix,
    'BookResolvePendingFixPayload'
  );
  if (result.status !== 'ok') return;
  cache.evict({
    id: cache.identify({ __typename: 'Library', id: result.payload.library.id }),
    fieldName: 'entries',
  });
  cache.gc();
},
```

- [ ] **Step 5: Evict after a scan**

In `use-scan-library.ts`, replace the `clearCompleteBookIds()` + `fetchBookList()` pair in
the scan-completion effect with the same eviction. **Remove both calls** — do not leave
`fetchBookList()` alongside the eviction. It refreshes a cache nothing reads, and leaving
it would keep `useFetchBookList` artificially alive, which is exactly the write-only-cache
trap step 8 hit with `renameProgressKey`.

Keep `useScanLibrary`'s public return shape unchanged.

- [ ] **Step 6: Run both tests, then the full client suite**

```bash
npx vitest run src/provider/upload/hook/use-upload-queue.test.tsx src/provider/book/hook/use-scan-library.test.tsx
npm test -w app/client
```
Foreground. Expected: PASS.

- [ ] **Step 7: Commit**

```bash
git add app/client/src/provider/upload app/client/src/provider/book/hook/use-scan-library.ts \
        app/client/src/provider/book/hook/use-scan-library.test.tsx
git commit -m "fix(client): refresh the library grid after an upload and after a scan"
```

---

## Task 10: Client — the Replace modal onto GraphQL

**Files:**
- Rewrite: `app/client/src/provider/book/hook/use-replace-book.ts` (+ `use-replace-book.test.tsx`)
- Modify: `app/client/src/control/upload-replace-modal/index.tsx` (+ its test)

**Interfaces:**
- Consumes: `BookAnalyzeReplaceDocument`, `BookReplaceDocument` (Task 5); `stageUpload` from `~/lib/staged-upload`; `FixKey` from `~/provider/upload/hook/use-fix-actions` (Task 7).
- Produces: `useReplaceBook()` keeping the members the modal already uses — `analyzeReplacement`, `commitReplacement`, `analyzing`, `committing`, `commitError`.

**Context:** Today both calls POST the raw file as multipart to
`/api/books/:id/replace/analyze` and `/api/books/:id/replace`. The GraphQL mutations take a
`stagedUploadId` instead, so the flow becomes: stage the bytes over the sanctioned staging
seam, then reference the staged id from the mutation. This is exactly the pattern step 7
established for staged covers — read `lib/staged-upload.ts` and the cover-staging call
site in `book-edit-form` before writing this.

`bookAnalyzeReplace` is explicitly read-only and does NOT consume the staged upload, so one
`stagedUploadId` can be analyzed and then committed. Stage once, in `analyzeReplacement`,
and carry the id to `commitReplacement`.

**Delete, do not port, the `bookList` sweep** in today's `commitReplacement`. Its own
comment already records that it became an unconditional dead no-op once `page/book` moved
to GraphQL and began passing a global id where the sweep compares raw ids.

- [ ] **Step 1: Write the failing tests**

```tsx
it('stages the file once and analyzes the staged id', async () => {
  const stage = vi.spyOn(stagedUpload, 'stageUpload').mockResolvedValue('staged-1');
  const { result } = renderHookWithApollo(() => useReplaceBook(), { mocks: [analyzeMock] });

  const analysis = await result.current.analyzeReplacement(BOOK_GID, file);

  expect(stage).toHaveBeenCalledTimes(1);
  expect(analysis?.proposals).toHaveLength(1);
});

it('commits the SAME staged id the analysis used, without re-staging', async () => {
  const stage = vi.spyOn(stagedUpload, 'stageUpload').mockResolvedValue('staged-1');
  const { result } = renderHookWithApollo(() => useReplaceBook(), {
    mocks: [analyzeMock, replaceMock],
  });

  await result.current.analyzeReplacement(BOOK_GID, file);
  const replaced = await result.current.commitReplacement(BOOK_GID, ['title:replace:Old']);

  expect(stage).toHaveBeenCalledTimes(1); // not twice
  expect(replaced?.id).toBe(NEW_BOOK_GID);
});

it('surfaces a typed replace error and returns undefined', async () => {
  const { result } = renderHookWithApollo(() => useReplaceBook(), {
    mocks: [analyzeMock, replaceCollisionMock],
  });
  await result.current.analyzeReplacement(BOOK_GID, file);
  await expect(result.current.commitReplacement(BOOK_GID, [])).resolves.toBeUndefined();
  await waitFor(() => expect(result.current.commitError).toBeDefined());
});

it('makes no /api/books call', async () => {
  const spy = vi.spyOn(globalThis, 'fetch');
  const { result } = renderHookWithApollo(() => useReplaceBook(), { mocks: [analyzeMock] });
  await result.current.analyzeReplacement(BOOK_GID, file);
  const bookRoutes = spy.mock.calls.filter(([u]) => String(u).includes('/api/books/'));
  expect(bookRoutes.map(([u]) => String(u))).toEqual([]); // staging is mocked above
});
```

- [ ] **Step 2: Run and watch them fail**

```bash
npx vitest run src/provider/book/hook/use-replace-book.test.tsx
```

- [ ] **Step 3: Implement**

Replace both `apiFetch` bodies with `stageUpload` + the two mutations, keeping
`analyzing` / `committing` / `commitError` state and the existing single-flight guards
(`if (analyzing) return undefined;`, `if (committing) return undefined;`).

`commitReplacement`'s third parameter is `acceptedFixKeys: string[]` today — a list of
`field:kind:from` strings. Convert to `MetadataFixKeyInput` objects at the boundary:

```ts
const toFixKeys = (keys: string[]): FixKey[] =>
  keys.map((k) => {
    const [field = '', kind = '', ...rest] = k.split(':');
    // `from` can itself contain ':' — rejoin everything after the second
    // separator rather than taking only the third segment.
    return { field, kind, from: rest.join(':') };
  });
```

If Task 5 found that `BookReplaceInput` has no accepted-fixes field, drop the third
parameter here instead and **report it** — the modal would then commit the server's own
auto-fix decision, which is a behaviour change to surface, not absorb silently.

Update `upload-replace-modal/index.tsx` for the id type: it is handed `bookId={book.id}`,
which is already a **global** id, so nothing needs converting — but delete any comment
claiming it is raw.

- [ ] **Step 4: Run the tests, then the full suite**

```bash
npx vitest run src/provider/book/hook/use-replace-book.test.tsx src/control/upload-replace-modal/index.test.tsx
npm test -w app/client
```

- [ ] **Step 5: Commit**

```bash
git add app/client/src/provider/book/hook/use-replace-book.ts \
        app/client/src/provider/book/hook/use-replace-book.test.tsx \
        app/client/src/control/upload-replace-modal
git commit -m "feat(client): replace a book's file over GraphQL via a staged upload"
```

---

## Task 11: Client — the three remaining consumers

**Files:**
- Modify: `app/client/src/provider/upload/hook/use-upload-badge.ts` (+ new test)
- Modify: `app/client/src/provider/upload/hook/use-pending-fixes-for-book.ts` (+ test)
- Modify: `app/client/src/graphql/book-edit.ts`
- Modify: `app/client/src/provider/library-target/hook/use-current-library-id.ts` (+ test)

**Interfaces:**
- Consumes: Tasks 5–9.
- Produces: `usePendingFixesForBook(bookGlobalId?: string)` now takes a **global** id.

- [ ] **Step 1: Badge — write the failing test**

```tsx
it('counts books with pending proposals from the server, with no upload in flight', async () => {
  const { result } = renderHookWithApollo(() => useUploadBadge(), {
    mocks: [viewerBootstrapMock, pendingFixesMockWithTwoProposalRows],
  });
  await waitFor(() => expect(result.current.count).toBe(2));
});
```

Reimplement `count` on `usePendingFixes()`, keeping `active` on `useUploadQueue()` —
`active` means "an upload is in flight", which only the transport knows. That is why the
hook keeps both sources rather than moving wholesale.

- [ ] **Step 2: Per-book pending fixes — write the failing test**

```tsx
it('reports the book’s own pending fix without consulting the upload queue', async () => {
  const { result } = renderHookWithApollo(() => usePendingFixesForBook(BOOK_GID), {
    mocks: [bookEditMockWithPendingFix],
  });
  await waitFor(() => expect(result.current?.proposals).toHaveLength(1));
});
```

Add to `BookEditDocument` in `graphql/book-edit.ts`:

```graphql
        pendingFix {
          id
          state {
            proposals {
              ...MetadataFixFragment
            }
          }
        }
```

Measured, this selection costs breadth 14 (14.0%) / complexity 14 (0.0%) standalone — it
adds almost nothing to the host document. Re-run `npm run codegen -w app/client` and
`npm run test:cost -w app/server`, then update `BookEdit`'s recorded numbers in its doc
comment.

Reimplement `usePendingFixesForBook` to read that field. It drops its dependency on
`UploadProvider` entirely — `page/book-edit` no longer needs the upload context mounted to
detect a pending-fix conflict.

- [ ] **Step 3: Re-home the stale-target self-heal — write the failing tests**

```tsx
it('clears an admin’s target when the library id no longer resolves', async () => {
  localStorage.setItem('library-target-id', 'lib-ghost');
  renderHookWithApollo(() => useCurrentLibraryId(), {
    mocks: [adminBootstrapMock, nodeResolvesToNullMock],
  });
  await waitFor(() => expect(localStorage.getItem('library-target-id')).toBeNull());
});

it('does NOT clear a non-admin’s stored target', async () => {
  // A non-admin never reads the stored target at all; clearing it would be a
  // side effect on state this hook deliberately ignores.
  localStorage.setItem('library-target-id', 'lib-ghost');
  renderHookWithApollo(() => useCurrentLibraryId(), { mocks: [nonAdminBootstrapMock] });
  await waitFor(() => expect(localStorage.getItem('library-target-id')).toBe('lib-ghost'));
});

it('does NOT clear while the resolving query is still loading', async () => {
  // Clearing on a not-yet-loaded read would wipe a VALID selection on every
  // mount — the failure mode is silent, so this guard needs its own test.
  localStorage.setItem('library-target-id', 'lib-alice');
  renderHookWithApollo(() => useCurrentLibraryId(), {
    // A delayed mock keeps `loading` true for the duration of this assertion.
    mocks: [adminBootstrapMock, { ...nodeResolvesToLibraryMock, delay: 1000 }],
  });
  await Promise.resolve();
  expect(localStorage.getItem('library-target-id')).toBe('lib-alice');
});
```

**Why this task exists:** `useFetchBookList` cleared a stale `targetLibraryId` on a 404 and
on an unresolvable admin username (`use-fetch-book-list.ts:50,77`). Task 9 removed its last
caller, so that behaviour is now dead — the file still exists but nothing invokes it. The
switcher's own effect covers "target missing from the user list"; "target does not resolve
to a library" has no other home. Re-homed here it is strictly better than the REST version,
firing wherever the library is read rather than only where something called `fetchBookList`.

Implement as an effect in `use-current-library-id.ts`: when the viewer is an admin, holds a
`targetLibraryId`, and a `node(id: targetLibraryId)` read has LOADED and resolved to `null`
or a non-`Library`, call `setTargetLibraryId(undefined)`.

- [ ] **Step 4: Run the three test files**

```bash
npx vitest run src/provider/upload/hook/use-upload-badge.test.tsx \
  src/provider/upload/hook/use-pending-fixes-for-book.test.tsx \
  src/provider/library-target/hook/use-current-library-id.test.tsx
```
Expected: PASS.

- [ ] **Step 5: Full suites, lint, cost**

```bash
npm test -w app/client
npm run lint -w app/client
npm run test:cost -w app/server
```

- [ ] **Step 6: Commit**

```bash
git add app/client/src
git commit -m "feat(client): badge, per-book fixes, and target self-heal off the new read"
```

---

## Task 12: Sweep — verify the claims this step makes

**Files:**
- Modify: `docs/superpowers/specs/2026-08-03-apollo-client-migration-design.md` (§9 row 9)
- Modify: whatever the counts below prove wrong

**Interfaces:**
- Consumes: everything.
- Produces: the recorded end state step 10 plans against.

**Context:** Steps 6 and 7 both mispredicted which hooks retire, each time because a
wrapper hook hid a live caller. This task exists to replace predictions with counts. Every
number below is to be **measured and reported**, not confirmed from the plan.

- [ ] **Step 1: Count `useWithTargetUser` consumers**

```bash
grep -rn 'useWithTargetUser(' app/client/src | grep -v '\.test\.' | wc -l
grep -rln 'useWithTargetUser(' app/client/src | grep -v '\.test\.'
```

Expected **5**, by name: `use-download-book` (permanent seam), the upload transport
(admin-on-behalf multipart POST), and three dead files step 10 deletes —
`use-fetch-book`, `use-fetch-book-list`, `use-upload-book-list`.

If the count differs, **the count is right and the plan was wrong**: report the real list
and which prediction failed.

- [ ] **Step 2: Confirm the REST surface is what the spec says it is**

```bash
grep -rln "apiFetch\|api-fetch" app/client/src | grep -v '\.test\.' | sort
grep -rn "fetch(" app/client/src --include='*.ts' --include='*.tsx' | grep -v '\.test\.' | grep -v apiFetch
```

Every remaining hit must be one of: `lib/api-fetch.ts`, `lib/staged-upload.ts`,
`lib/use-authorized-src.ts`, `provider/apollo/*`, `provider/auth/provider.tsx`,
`provider/config/provider.tsx` (the raw-`fetch` `/api/public-config` seam the spec §1 flags
for step 10), the upload transport, and the three dead files above.

**Anything else is a bug this step introduced.** Report it.

- [ ] **Step 3: Confirm no raw book ids survive in the upload provider**

```bash
grep -rn "bookId" app/client/src/provider/upload | grep -v '\.test\.'
```

Expected: no hits, or only `bookGlobalId`. A bare `bookId` in this directory means the
dual-id hazard the step set out to delete is still present.

- [ ] **Step 4: Confirm the deletions actually happened**

```bash
ls app/client/src/provider/upload/api.ts \
   app/client/src/provider/book/hook/use-upload-queue.ts \
   app/client/src/provider/book/hook/use-patch-book-metadata.ts 2>&1
```
Expected: three "No such file or directory".

- [ ] **Step 5: Confirm what was deliberately NOT deleted**

```bash
ls app/client/src/provider/book/hook/use-fetch-book-list.ts \
   app/client/src/provider/book/hook/use-fetch-book.ts \
   app/client/src/provider/book/hook/use-upload-book-list.ts \
   app/client/src/provider/book/provider.tsx
```
Expected: all four present. They are dead and step 10 owns them (Global Constraints). A
missing file here is a scope breach to report, not a bonus.

- [ ] **Step 6: Run every gate, in the foreground**

```bash
npm test -w app/server
npm test -w app/client
npm run test:cost -w app/server
npm run lint -w app/server
npm run lint -w app/client
```

All five must pass. `lint` covers `tsc --noEmit`, SDL drift (`graphql:schema:check`) and
codegen drift (`codegen:check`).

- [ ] **Step 7: Record the outcome in the parent spec**

Fill in §9's row 9 in `2026-08-03-apollo-client-migration-design.md` with the same density
the rows for steps 6–8 use: what shipped, the real `useWithTargetUser` count, the real
test counts before and after, which files were deleted, which were deliberately left, and
any prediction in this plan that turned out wrong. Mark it ✅ Complete.

Also record, for step 10:
- `provider/config/provider.tsx` uses raw `fetch('/api/public-config')`, so it is a fifth
  REST seam the four-seam sweep assertion would not catch. It is genuinely pre-auth and
  cannot move to `Query.config`.
- Whether `Library.pendingFixes` needs pagination if the fragment ever grows (measured
  headroom at this step's shipped shape).

- [ ] **Step 8: Commit**

```bash
git add docs/superpowers/specs/2026-08-03-apollo-client-migration-design.md
git commit -m "docs(spec): record step 9's outcome in the migration sequencing table"
```

Note: `docs/` is gitignored in this repo, so this commit will be empty unless other files
changed. That is expected — the spec update still matters for the next session, it just
lives on disk rather than in history.
