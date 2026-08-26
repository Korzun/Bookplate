# Schema ID Cleanup Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Remove every raw user id from the GraphQL schema, give `Progress` a single opaque identifier, and close two defects the `userChangePassword` review surfaced — all before any client code depends on the current shapes.

**Architecture:** `Progress` gains a computed global ID built the same way `Book`, `PendingFix` and `Validation` already build theirs (`encodeGlobalID(type, JSON.stringify([userId, localKey]))`), decoded on the way back in with the existing `parseCompoundId`. No database migration and no new `Node` — this follows the `Device`/`PendingFix`/`Validation` precedent of a scalar `id` for cache identity *without* an ungated `node(id:)` door.

**Tech Stack:** graphql-yoga, Pothos v4 (relay + prisma + scope-auth plugins), Prisma 7/SQLite, Vitest, oxlint/oxfmt. Client side: Apollo Client v4 with graphql-codegen.

## Global Constraints

- **No Prisma migration, no schema.prisma change.** `Progress`'s PK stays `@@id([userId, document])`. Every id in this plan is *computed* at the GraphQL boundary. Bookplate is self-hosted; migrating populated `progress` tables on machines we do not operate buys nothing the computed id does not.
- **`Progress` must NOT become a `Node`.** The design ledger rejected that deliberately: `Progress` is only ever reached through an already-owner-scoped `Book` or `Library`, so a `node(id:)` door would be a second, separately-guarded entry onto tenant data. `builder.prismaObject` stays; do not switch to `prismaNode`.
- **Every SDL change requires `npm run graphql:schema -w app/server`** and the committed artifact must match (repo-root `npm run lint` runs `graphql:schema:check`).
- **Verification is the repo-ROOT command** `cd /Users/korzun/.supacode/repos/Bookplate/graphql-migration && npm run lint`; it must exit 0. Do NOT substitute per-file linting — `oxlint` and `oxfmt` are separate tools and only the latter catches formatting.
- oxlint ERRORS: `typescript/no-explicit-any`, `no-shadow`, `eqeqeq` (null-ignoring), `react-hooks/exhaustive-deps`.
- **Baselines to preserve:** server 1942, client 1012, `npm run test:cost -w app/server` 33, root lint 0.
- **`docs/` is gitignored** — never commit anything under it.
- Tenant isolation is the property under test throughout: `document` is a KOReader content hash that **collides across users**. Any change that lets two users' progress share an identity is a Critical defect.

## Deliberate non-changes — do not "fix" these

- **`progressSet` keeps its `userId` input.** It is self-only and the argument is therefore redundant, exactly as `userChangePassword`'s was. It is NOT included here because it is not *broken*: unlike a `mustChangePassword` viewer, an ordinary authenticated caller can read `viewer.user.id`, so there is no deadlock. Recorded as a follow-up, not scope.
- **`progressSet` cannot take a `Progress` global ID** in place of its `userId`: it CREATES the row, so no id exists yet to name.
- **`Device`, `PendingFix`, `Validation` are untouched.** They already carry scalar ids without implementing `Node`; they are the precedent this plan follows.

---

### Task 1: `Progress.id` as a computed global ID; drop `Progress.userId`

**Files:**
- Modify: `app/server/graphql/schema/progress/model.ts`
- Modify: `app/server/graphql/schema.generated.graphql` (regenerated)
- Test: `app/server/graphql/schema/progress/model.test.ts` (create if absent — check first)

**Interfaces:**
- Consumes: `encodeGlobalID` from `@pothos/plugin-relay`.
- Produces: `Progress.id: ID!` valued `encodeGlobalID('Progress', JSON.stringify([userId, document]))`. `Progress.userId` no longer exists. Task 2 decodes this id; Task 6 removes the client typePolicy that keyed on the old pair.

- [ ] **Step 1: Confirm no other resolver reads `Progress.userId` through GraphQL**

```bash
cd /Users/korzun/.supacode/repos/Bookplate/graphql-migration
grep -rn "userId" app/server/graphql/schema/progress/ | grep -v "\.test\."
grep -rn "progress.userId\|parent.userId" app/server/graphql/schema/ | grep -v "\.test\." | grep -i progress
```

Expected: internal resolver reads of `parent.userId` (for example `Progress.currentChapter`'s chapter-spine lookup) are FINE and must keep working — they read the Prisma row, not the GraphQL field. Only the exposed `userId: t.exposeID('userId')` field is being removed. If you find a resolver that depends on the *exposed field* rather than the row, stop and report.

- [ ] **Step 2: Write the failing test**

Create or extend `app/server/graphql/schema/progress/model.test.ts`. Match the conventions of a sibling test (for example `app/server/graphql/schema/user/mutation/delete.test.ts`) for harness setup, and whether `describe`/`it` are globals or imported.

```ts
const PROGRESS_QUERY = `
  query($id: ID!) {
    node(id: $id) {
      ... on Library {
        progress(first: 10) {
          edges { node { id document percentage } }
        }
      }
    }
  }
`;

describe('Progress.id', () => {
  // Tenant isolation is the whole point: `document` is a KOReader content
  // hash, so two users who own the same book have the SAME document value.
  // A single-user fixture would pass even if `id` were just the document.
  it('differs between two users who share a document hash', async () => {
    const shared = 'shared-document-hash';
    await seedProgress(harness.aliceOwner.userId, shared);
    await seedProgress(harness.bobOwner.userId, shared);

    const aliceId = await firstProgressId(harness.aliceViewer, harness.aliceOwner);
    const bobId = await firstProgressId(harness.bobViewer, harness.bobOwner);

    expect(aliceId).not.toEqual(bobId);
  });

  it('decodes to the owning user and the document', async () => {
    const shared = 'shared-document-hash';
    await seedProgress(harness.aliceOwner.userId, shared);

    const id = await firstProgressId(harness.aliceViewer, harness.aliceOwner);
    const { typename, id: local } = decodeGlobalID(id);

    expect(typename).toBe('Progress');
    expect(JSON.parse(local)).toEqual([harness.aliceOwner.userId, shared]);
  });

  it('no longer exposes a raw userId field', async () => {
    const result = await harness.execute(
      `query($id: ID!) { node(id: $id) { ... on Library { progress(first: 1) { edges { node { userId } } } } } }`,
      { viewer: harness.aliceViewer, variables: { id: libraryIdOf(harness.aliceOwner) } }
    );

    // A removed field is a VALIDATION error, so `data` is absent entirely.
    expect(result.errors?.[0]?.message).toMatch(/Cannot query field "userId"/);
  });
});
```

Write the two helpers locally. **There is no `stores.progress`** — progress rows are seeded through Prisma directly, exactly as `progress/mutation/delete.test.ts` already does; copy that file's `seedProgress` verbatim rather than inventing one:

```ts
const seedProgress = (userId: string, document: string): Promise<unknown> =>
  harness.prisma.progress.create({
    data: {
      userId,
      document,
      progress: 'EPUB_CFI(/6/4!/4/2:0)',
      percentage: 0.5,
      device: 'Web',
      deviceId: 'dev-1',
      timestamp: 1_700_000_000,
    },
  });

/** The harness exposes no library id; a Library's global ID is its owner's user id. */
const libraryIdOf = (owner: { userId: string }) => encodeGlobalID('Library', owner.userId);

const firstProgressId = async (viewer: Viewer, owner: { userId: string }): Promise<string> => {
  const result = await harness.execute(PROGRESS_QUERY, {
    viewer,
    variables: { id: libraryIdOf(owner) },
  });
  const node = result.data?.node as { progress: { edges: { node: { id: string } }[] } };
  return node.progress.edges[0].node.id;
};
```

The harness exposes `aliceOwner`/`aliceViewer`/`aliceGlobalId`/`bobOwner`/`bobViewer`/`adminViewer` — use `bobOwner`/`bobViewer` for the second tenant. Adjust the test bodies above to call `seedProgress(harness.aliceOwner.userId, shared)` and `firstProgressId(harness.aliceViewer, harness.aliceOwner)`.

- [ ] **Step 3: Run test to verify it fails**

```bash
cd /Users/korzun/.supacode/repos/Bookplate/graphql-migration && npx vitest run graphql/schema/progress/model --root app/server
```

Expected: FAIL — `Cannot query field "id" on type "Progress"`.

- [ ] **Step 4: Write the implementation**

In `app/server/graphql/schema/progress/model.ts`, add the `encodeGlobalID` import and REPLACE the `userId: t.exposeID('userId'),` field (and its doc comment) with:

```ts
    /**
     * A single opaque identifier, built exactly as `Book`, `PendingFix` and
     * `Validation` build theirs: `encodeGlobalID(type, JSON.stringify([userId,
     * localKey]))`, decoded by `parseCompoundId`. Computed — there is no `id`
     * column and no migration; `Progress`'s PK stays `@@id([userId,
     * document])`.
     *
     * Replaces the raw `userId` this type used to expose. That field was a
     * genuine footgun: it carried the RAW Prisma id while every mutation input
     * named `userId` is a `t.globalID` and REJECTS a raw value ("Invalid
     * global ID: …"), so the two shared a name and a GraphQL type while being
     * incompatible — and the output one was the natural thing to pass to
     * `progressDelete`.
     *
     * The owner is still inside the id, so this remains tenant-unique:
     * `document` is a KOReader content hash and COLLIDES across users.
     *
     * `Progress` is still deliberately NOT a `Node` — see this type's own doc
     * comment. This id exists for cache identity only, following the
     * `Device`/`PendingFix`/`Validation` precedent of a scalar id with no
     * `node(id:)` door.
     */
    id: t.field({
      type: 'ID',
      resolve: (progress) =>
        encodeGlobalID('Progress', JSON.stringify([progress.userId, progress.document])),
    }),
```

Leave every other field, and every internal `parent.userId` read, untouched.

- [ ] **Step 5: Regenerate the SDL and run the tests**

```bash
cd /Users/korzun/.supacode/repos/Bookplate/graphql-migration
npm run graphql:schema -w app/server
npx vitest run graphql/schema/progress --root app/server
sed -n '/^type Progress {/,/^}/p' app/server/graphql/schema.generated.graphql
```

Expected: tests PASS; the printed type shows `id: ID!` and NO `userId`.

- [ ] **Step 6: Demonstrate the tenant test can fail (seen-to-fail)**

Temporarily change the resolver to `encodeGlobalID('Progress', progress.document)` — dropping the owner. Re-run; the two-user test must FAIL because both users now produce the same id. Revert, confirm green. Record the observed output in your report and the commit message.

- [ ] **Step 7: Commit**

```bash
git add app/server/graphql/schema/progress app/server/graphql/schema.generated.graphql
git commit -m "feat(server)!: give Progress a computed global ID, drop its raw userId"
```

---

### Task 2: `progressDelete` takes the `Progress` id; payload returns `deletedId`

**Files:**
- Modify: `app/server/graphql/schema/progress/mutation/delete.ts`
- Modify: `app/server/graphql/schema/progress/mutation/delete.test.ts`
- Modify: `app/server/graphql/schema.generated.graphql` (regenerated)

**Interfaces:**
- Consumes: `Progress.id`'s construction (Task 1), `parseCompoundId` from `../../node-scope`, `isOwnerOrAdmin` from the same module.
- Produces: `input ProgressDeleteInput { id: ID! }` (was `{ userId, document }`); `type ProgressDeletePayload { deletedId: ID!, library: Library! }` (`deletedDocument` removed).

**Authorization note — read before touching the scope.** `progressDelete` is `ownerOf`-gated and genuinely admin-capable: REST has an admin `DELETE .../progress/:document` in `routes/users.ts`. The owner now rides inside the id, exactly as it does for the ten book mutations, so the decoded `userId` is what the scope must check — via `isOwnerOrAdmin`, NOT by comparing against `context.viewer.userId`, which would break the admin path.

- [ ] **Step 1: Read how a book mutation decodes its compound id**

```bash
cd /Users/korzun/.supacode/repos/Bookplate/graphql-migration
sed -n '1,60p' app/server/graphql/schema/book/mutation/delete.ts
sed -n '40,95p' app/server/graphql/schema/node-scope.ts
```

Follow that decode-and-authorize shape rather than inventing one. Note what a malformed or foreign id resolves to there (`NO_MATCH_USER_ID`) and mirror it — a wrong id must not be distinguishable from a missing row.

- [ ] **Step 2: Update the tests first**

In `delete.test.ts`, every call currently passes `input: { userId: <User global ID>, document: '…' }`. Replace with `input: { id: <Progress global ID> }`, building that id the same way Task 1's resolver does. Keep every existing assertion about WHO may delete WHAT — the admin-capable path and the cross-tenant refusal are the tests that matter, and their meaning is unchanged.

Add one test that did not previously make sense:

```ts
it("refuses a Progress id belonging to another tenant, indistinguishably from a missing row", async () => {
  const foreign = encodeGlobalID('Progress', JSON.stringify([harness.bobOwner.userId, 'doc-1']));

  const result = await harness.execute(MUTATION, {
    viewer: harness.aliceViewer,
    variables: { input: { id: foreign } },
  });

  // Same answer a nonexistent row gives — a probe must not learn that bob has this document.
  expect(result.data?.progressDelete ?? null).toBeNull();
  // Bob's row survives. There is no progress store — read Prisma directly,
  // as this test file already does for its other assertions.
  expect(
    await harness.prisma.progress.findFirst({
      where: { userId: harness.bobOwner.userId, document: 'doc-1' },
    })
  ).not.toBeNull();
});
```

Seed bob's row first with the file's existing `seedProgress(harness.bobOwner.userId, 'doc-1')` helper.

- [ ] **Step 3: Run tests to verify they fail**

```bash
npx vitest run graphql/schema/progress/mutation/delete --root app/server
```

Expected: FAIL — the input field `id` does not exist yet.

- [ ] **Step 4: Write the implementation**

Replace the input type:

```ts
/**
 * One opaque `Progress` global ID, replacing the `(userId, document)` pair.
 * The owner rides inside the id — the same collapse the book-relay-id plan
 * applied to all ten book mutations — so the scope decodes and authorizes it
 * with `isOwnerOrAdmin` rather than taking the caller's word for an owner.
 */
const input = builder.inputType('ProgressDeleteInput', {
  fields: (t) => ({
    id: t.id({ required: true }),
  }),
});
```

Then decode in the scope/resolver following the book-mutation shape from Step 1, and change the payload:

```ts
type ProgressDeletePayloadShape = {
  readonly __typename: 'ProgressDeletePayload';
  readonly deletedId: string;
  readonly owner: Owner;
};

/**
 * `deletedId`, not `deletedDocument`: `Progress` now carries a global ID
 * (Task 1), so a normalized cache evicts by `cache.identify({ __typename:
 * 'Progress', id })` and needs nothing else. This follows the precedent set
 * when `BookDeletePayload.deletedBookId` was removed — the only consumer of
 * this schema is the in-repo client, and a raw-key field beside a global ID
 * served no one.
 */
```

`library` stays exactly as it is.

- [ ] **Step 5: Regenerate, run, and check the admin path specifically**

```bash
npm run graphql:schema -w app/server
npx vitest run graphql/schema/progress --root app/server
sed -n '/^input ProgressDeleteInput/,/^}/p;/^type ProgressDeletePayload/,/^}/p' app/server/graphql/schema.generated.graphql
```

Expected: PASS, and the admin-deletes-another-user's-progress test still green. If it went red, the scope is comparing against `viewer.userId` instead of using `isOwnerOrAdmin`.

- [ ] **Step 6: Seen-to-fail on the cross-tenant refusal**

Temporarily replace the scope's `isOwnerOrAdmin(context.viewer, decodedUserId)` with `context.viewer !== null`. Re-run; the foreign-id test from Step 2 must FAIL (alice would delete bob's row). Revert and confirm green. Record the observed output.

- [ ] **Step 7: Commit**

```bash
git add app/server/graphql/schema/progress app/server/graphql/schema.generated.graphql
git commit -m "feat(server)!: progressDelete takes a Progress global ID, returns deletedId"
```

---

### Task 3: Drop `UserDeletePayload.deletedUserId`

**Files:**
- Modify: `app/server/graphql/schema/user/mutation/delete.ts`
- Modify: `app/server/graphql/schema/user/mutation/delete.test.ts`
- Modify: `app/server/graphql/schema.generated.graphql` (regenerated)

**Interfaces:**
- Produces: `type UserDeletePayload { deletedId: ID! }` — the raw `deletedUserId: String!` is gone.

- [ ] **Step 1: Confirm nothing consumes it**

```bash
cd /Users/korzun/.supacode/repos/Bookplate/graphql-migration
grep -rn "deletedUserId" app/ --include="*.ts" --include="*.tsx" | grep -v node_modules
```

Expected: only the server definition and its own tests. If anything under `app/client/src/gql/` references it, STOP and report — that would mean a shipped client document depends on it.

- [ ] **Step 2: Update the test**

In `delete.test.ts`, remove `deletedUserId` from the selection set and from any assertion. Where a test asserted on `deletedUserId`'s value, assert on `deletedId` instead — it identifies the same user, in the form the client actually evicts by.

- [ ] **Step 3: Run to verify it fails**

```bash
npx vitest run graphql/schema/user/mutation/delete --root app/server
```

Expected: FAIL, because the field is still present and a test now asserts a shape that does not match — or PASS trivially if you only deleted assertions, in which case add one on `deletedId` so the task has a real gate.

- [ ] **Step 4: Remove the field**

Delete `deletedUserId` from the payload's `fields` and from `UserDeletePayloadShape`, keeping `deletedId`. Update the doc comment that explains why both existed — it should now record that the raw field was removed for the same reason `BookDeletePayload.deletedBookId` was: the schema's only consumer evicts by global ID.

- [ ] **Step 5: Regenerate and verify**

```bash
npm run graphql:schema -w app/server
npx vitest run graphql/schema/user --root app/server
sed -n '/^type UserDeletePayload/,/^}/p' app/server/graphql/schema.generated.graphql
```

Expected: PASS; the printed type has `deletedId: ID!` only.

- [ ] **Step 6: Commit**

```bash
git add app/server/graphql/schema/user app/server/graphql/schema.generated.graphql
git commit -m "refactor(server)!: drop UserDeletePayload.deletedUserId, evict by deletedId"
```

---

### Task 4: Close the `userChangePassword` payload-lookup gap

**Files:**
- Modify: `app/server/graphql/schema/user/mutation/change-password.test.ts`

**Interfaces:** none — test-only.

**Why this exists.** A whole-branch review replaced the payload's user lookup with a hardcoded `findFirstOrThrow({ where: { username: 'alice' } })` — a mutation that reports someone else's account — and the **entire 1942-test server suite still passed**. Every success-path assertion uses alice as the caller, and the only non-alice caller (bob) is routed down the `IncorrectPasswordError` branch and never reaches the payload. The gap predates the recent change but is more load-bearing now that the payload's id flows from `context.viewer` instead of from a scope-verified argument.

- [ ] **Step 1: Write the failing test**

Add to `change-password.test.ts`, inside the existing `describe`:

```ts
/**
 * The payload's `user` field is the one line in this resolver that no other
 * test reaches with a non-alice caller: every success-path assertion here
 * uses alice, and bob only ever exercises the IncorrectPasswordError branch.
 * A whole-branch review proved the gap by hardcoding the lookup to alice and
 * watching all 1942 server tests still pass.
 *
 * This pins BOTH halves at once: the write lands on bob, and the payload
 * reports bob.
 */
it('reports the caller in its payload, and writes to the caller, for a non-default user', async () => {
  const result = await harness.execute(MUTATION, {
    viewer: harness.bobViewer,
    variables: { input: { currentPassword: 'bobpass', newPassword: 'bobnewpass' } },
  });

  expect(result.data?.userChangePassword).toEqual({
    __typename: 'UserChangePasswordPayload',
    user: { username: 'bob', mustChangePassword: false },
  });
  expect(await harness.stores.user.validateUser('bob', 'bobnewpass')).toBe(harness.bobOwner.userId);
  expect(await harness.stores.user.validateUser('alice', 'alicepass')).toBe(
    harness.aliceOwner.userId
  );
});
```

`'bobpass'` is bob's real seeded password (`test-util.ts:128`), and `harness.bobOwner`/`harness.bobViewer` both exist — no adjustment needed.

- [ ] **Step 2: Run — it should PASS against correct code**

```bash
npx vitest run graphql/schema/user/mutation/change-password --root app/server
```

Expected: PASS. This test guards existing-correct behaviour, so a green first run is right.

- [ ] **Step 3: Demonstrate it closes the gap (seen-to-fail)**

In `change-password.ts`, temporarily replace the payload's `user` resolver with
`context.prisma.user.findFirstOrThrow({ ...query, where: { username: 'alice' } })`.
Re-run. The new test must FAIL on the payload assertion (`username: 'alice'` where `'bob'` was expected). Revert and confirm green.

This is the exact mutant that previously survived the whole suite — record the before/after in your report and commit message.

- [ ] **Step 4: Commit**

```bash
git add app/server/graphql/schema/user/mutation/change-password.test.ts
git commit -m "test(server): pin userChangePassword's payload identity to the caller"
```

---

### Task 5: Resolve the dead `passwordChangeAllowed` scope

**Files:**
- Modify: `app/server/graphql/schema/builder.ts`
- Modify: `app/server/graphql/schema/user/mutation/change-password.ts` (comments, possibly `authScopes`)

**Interfaces:** no SDL change either way — auth scopes are invisible in the printed schema.

**The finding.** `passwordChangeAllowed` is declared in the builder's scope map but **no field uses it**. A reviewer set it to `false` outright and all 41 tests across both files still passed. The unauthenticated refusal actually comes from the `context.viewer !== null` half of `userChangePassword`'s own `authScopes` function. Three doc comments — in `builder.ts` and `change-password.ts` — describe it as load-bearing, and one test name repeats the claim.

Both directions are defensible; pick ONE and make the code and comments agree:

- **(a) Use it.** Add `authScopes: { passwordChangeAllowed: true }` alongside the existing boolean check so the type-level substitute is actually declared, and the comments become true.
- **(b) Remove it.** Delete the scope from the builder's map and its initializer, and rewrite the three comments to say the field function does this work.

**Recommendation: (a).** `skipTypeScopes: true` removes the type-level gate entirely, and a field that opts out of a gate should declare what replaces it — otherwise the only thing standing between an unauthenticated caller and this resolver is one clause inside a bespoke function, with nothing in the scope system recording that intent. (a) also keeps the reviewer's mutation (`passwordChangeAllowed: false`) meaningful as a regression signal.

- [ ] **Step 1: Confirm the finding yourself**

```bash
cd /Users/korzun/.supacode/repos/Bookplate/graphql-migration
grep -rn "passwordChangeAllowed" app/server --include="*.ts"
```

Expected: the scope's type entry, its initializer in `builder.ts`, and comments — but no field declaring `authScopes: { passwordChangeAllowed: … }`. Then set the initializer to `false` and run the two affected test files; if everything still passes, the finding is confirmed. Revert before continuing.

- [ ] **Step 2: Write the failing test**

Whichever direction you take, the outcome must be pinned. For (a):

```ts
it('refuses an unauthenticated caller through the declared passwordChangeAllowed scope', async () => {
  const result = await harness.execute(MUTATION, {
    viewer: null,
    variables: { input: { currentPassword: 'x', newPassword: 'y' } },
  });

  expect(result.errors?.[0]?.extensions?.code).toBe('UNAUTHENTICATED');
});
```

An equivalent test already exists; if so, RENAME it to stop misattributing the mechanism and keep one assertion per mechanism rather than duplicating.

- [ ] **Step 3: Apply the change**

For (a), add to the mutation field alongside `skipTypeScopes: true`:

```ts
    // Declares the type-level gate that `skipTypeScopes` removes. Without
    // this the only thing refusing a null viewer is one clause inside the
    // field function below, with nothing in the scope system recording the
    // intent — which is how this scope came to be dead in the first place.
    authScopes: { passwordChangeAllowed: true },
```

Pothos does not accept both an `authScopes` object and an `authScopes` function on one field — read the plugin's typings and combine them correctly (the function form can return a scope map). Whichever form you use, BOTH conditions must still hold: a non-null viewer AND a non-null `viewer.userId`.

- [ ] **Step 4: Fix the misattributing comments**

Update every comment that claims the field uses `passwordChangeAllowed` so it matches what the code now does — in `change-password.ts` (the input doc comment, the mutation doc comment) and `builder.ts`'s note on the exemption. If you took (b), they must instead say the scope is gone and the field function does the work.

- [ ] **Step 5: Verify both refusals still hold**

```bash
npx vitest run graphql/schema/user/mutation/change-password graphql/root-auth --root app/server
```

Expected: PASS, including the config-admin FORBIDDEN test and the unauthenticated test. Then re-run the reviewer's mutation — set `passwordChangeAllowed` to `false` — and confirm a test now FAILS (under (a) it should; under (b) the scope no longer exists). Revert.

- [ ] **Step 6: Commit**

```bash
git add app/server/graphql/schema/builder.ts app/server/graphql/schema/user/mutation/change-password.ts app/server/graphql/schema/user/mutation/change-password.test.ts
git commit -m "fix(server): make the passwordChangeAllowed scope load-bearing, not vestigial"
```

---

### Task 6: Client — delete the `Progress` typePolicy and update its fixtures

**Files:**
- Modify: `app/client/src/provider/apollo/cache.ts`
- Modify: `app/client/src/provider/apollo/cache.test.ts`
- Modify: `app/client/src/provider/apollo/selection-ids.test.ts`

**Interfaces:**
- Produces: `cacheConfig.typePolicies` no longer contains `Progress`. `Progress` normalizes on the default `id` key, like every other entity with an id.

**Note:** no shipped client document currently selects `Progress` — the manifest holds only `ViewerBootstrap`, `LibraryScanStatus`, `ScanProgress` and `LibraryScan` — so nothing in `persisted-documents.json` changes and the cost gate is unaffected. Confirm that before starting.

- [ ] **Step 1: Confirm no shipped document selects Progress**

```bash
cd /Users/korzun/.supacode/repos/Bookplate/graphql-migration
node -p "Object.values(require('./app/client/src/gql/persisted-documents.json')).filter(q => /progress/i.test(q)).length"
```

Expected: `0`. If not, the cost gate and the id check both cover those documents and you must re-run them after this task.

- [ ] **Step 2: Update the cache tests first**

In `cache.test.ts`, the two-user `Progress` test currently proves the composite key by writing `userId`/`document` for two users and reading both back. Rewrite it to write the new shape — `id` (a `Progress` global ID string) and `document` — and keep the same property: **two users who share a `document` must not collapse onto one cache entity.** That property is unchanged; only the key that delivers it moved from a composite to `id`.

Also update the assertion that enumerates `typePolicies` keys, which will no longer include `Progress`.

In `selection-ids.test.ts`, the fixture asserting `Progress` is missing `userId` no longer holds — `Progress`'s key is now `id`. Change the fixture to select `document` without `id` and expect `missing: ['id']`.

- [ ] **Step 3: Run to verify they fail**

```bash
npx vitest run src/provider/apollo --root app/client
```

Expected: FAIL — the typePolicy is still `['userId','document']`.

- [ ] **Step 4: Delete the typePolicy**

In `cache.ts`, remove the entire `Progress: { keyFields: ['userId', 'document'] },` entry and its doc comment. Add a short note where it was, recording that `Progress` now carries a computed global ID and needs no special keying — otherwise the next reader will wonder why the type that most obviously needs a composite key does not have one.

- [ ] **Step 5: Verify**

```bash
npx vitest run src/provider/apollo --root app/client && npm test -w app/client
```

Expected: PASS. `selection-ids` derives key fields from `cacheConfig`, so it should follow the change automatically — if it does not, that derivation has a bug worth reporting.

- [ ] **Step 6: Seen-to-fail on the tenant property**

The two-user cache test must still be able to fail. Temporarily add `Progress: { keyFields: ['document'] }` back to `cacheConfig`; the test must go red (both users collapsing onto one entity). Revert and confirm green. This is the same property the old composite key protected — prove it still has a guard.

- [ ] **Step 7: Commit**

```bash
git add app/client/src/provider/apollo
git commit -m "refactor(client): drop the Progress typePolicy, now keyed by its global ID"
```

---

## Definition of done

- No raw user id anywhere in `schema.generated.graphql`: `grep -n "userId" app/server/graphql/schema.generated.graphql` returns only `t.globalID`-backed mutation INPUT fields, and no output field.
- `npm run lint` clean from the repo ROOT (includes `graphql:schema:check` and the client's `codegen:check`).
- `npm test -w app/server` green (≥1942 plus this plan's additions); `npm test -w app/client` green (≥1012).
- `npm run test:cost -w app/server` green at 33 — unchanged, since no shipped document selects `Progress`.
- Every seen-to-fail in Tasks 1, 2, 4, 5 and 6 performed and observed failing, with the output recorded in that task's commit message.
- Spec `2026-08-03-apollo-client-migration-design.md` §14 updated: the `Progress` typePolicy no longer exists, and §4's cache-config table no longer lists it.
