# Email Address Ownership Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Let the operator see who holds an email address and clear it, so a mistaken or stale claim stops being permanent and invisible.

**Architecture:** Address uniqueness stays — login-by-email and password reset both resolve through it. Instead of loosening the constraint, the operator gets two things they do not have today: the address and its confirmed state on the `User` node (owner-or-admin scoped), and an admin-only `userClearEmail` mutation. That mutation is the first in this codebase to write another user's row, so it carries the same `isConfigAdminRow` guard `userDelete` and `userResetPassword` use.

**Tech Stack:** TypeScript, Express 4, Prisma 7 + better-sqlite3, Pothos GraphQL (relay + scope-auth + prisma plugins), vitest + supertest (server); React 19, Apollo Client, vitest + Testing Library (client).

**Spec:** `docs/superpowers/specs/2026-09-20-email-address-ownership-design.md`

## Global Constraints

- **Working directory:** `/Users/korzun/.herdr/worktrees/Bookplate/notifications`, branch `email-address-ownership`. It is a git worktree — never `cd` to `/Users/korzun/Code/Bookplate`.
- **Tests:** `cd app/server && npm test`; `cd app/client && npm test`.
- **Lint from the repo ROOT only:** `npm run lint`. Running it inside one workspace silently skips the other and has caused CI failures in this project.
- **The SDL is checked in.** Tasks 1 and 2 change it: run `cd app/server && npm run graphql:schema` and commit the result. Task 3 changes client documents: run the client's codegen and commit that. `npm run lint` fails on drift in either.
- **`userClearEmail` must refuse the config admin row**, returning the same `null` a nonexistent row returns — so the row stays unaddressable rather than merely protected. Guard with `isConfigAdminRow` from `services/admin-account.ts`.
- **`EmailInUseError`'s message must stay uniform** — it must never reveal who holds an address or whether they have confirmed it. It is returned to whoever probed the address.
- **Clearing an address re-gates that user.** `mustSetEmail` is derived (`email == null && mailConfigured`), so they land on the set-email screen at their next token refresh. This is intended; the admin-facing copy must say so.
- No new npm dependencies. No Prisma schema change — every column already exists.
- TDD throughout. Commit per task.

## File Structure

**Server**

| File | Responsibility |
| --- | --- |
| `app/server/graphql/schema/user/model.ts` | Gains `email` and `emailVerifiedAt`, both owner-or-admin scoped. |
| `app/server/graphql/schema/user/mutation/clear-email.ts` (new) | The `userClearEmail` mutation, its input, payload and result union, and the config-admin guard. |
| `app/server/graphql/schema/user/mutation/clear-email.test.ts` (new) | Its tests, including the load-bearing no-write assertion. |
| `app/server/graphql/schema/index.ts` | Registers the new mutation module. |
| `app/server/graphql/schema/email-in-use-error/model.ts` | Message reworded to point at the remedy. |
| `app/server/graphql/schema.generated.graphql` | Regenerated. |

**Client**

| File | Responsibility |
| --- | --- |
| `app/client/src/graphql/user.ts` | `UserRowFragment` gains the two fields; new `UserClearEmailDocument`. |
| `app/client/src/component/user-row/index.tsx` | Renders address + confirmed state, and the clear action with its confirmation. |
| `page/user-list` | **No change needed.** It composes `...UserRowFragment` into `UserListDocument`, so adding fields to the fragment flows through automatically. The spec names the page as a surface; the row is where the surface lives. |
| `app/client/src/component/user-row/index.test.tsx` | Tests for both. |
| `app/client/src/gql/*` | Regenerated codegen output. |

---

### Task 1: Expose the address on `User`

**Files:**
- Modify: `app/server/graphql/schema/user/model.ts`
- Test: `app/server/graphql/schema/user/email-fields.test.ts` (new)
- Modify: `app/server/graphql/schema.generated.graphql` (regenerated)

**Interfaces:**
- Consumes: nothing.
- Produces GraphQL: `User.email: String` (nullable) and `User.emailVerifiedAt: DateTime` (nullable), each readable by that user or an admin.

Two precedents in this repo define the shape, and both must be followed rather than invented:

- **The scope:** `User.library` in this same file already uses `authScopes: (parent) => ({ ownerOf: parent.id })`. `ownerOf` resolves through `isOwnerOrAdmin` (`graphql/schema/node-scope.ts:37`) to `viewer.isAdmin || viewer.userId === userId` — exactly "this user, or an admin".
- **The computed field:** `emailVerifiedAt` is stored as a `Float` ms-epoch and must surface as `DateTime`, so it needs a resolver. On a Prisma-backed type a resolver's parent only carries what the field selects. The pattern is `progress/model.ts:146-154`: `select: { … } as const` beside the resolver. `epochToDate` is exported from `graphql/derive.ts:55`.

- [ ] **Step 1: Write the failing tests**

Create `app/server/graphql/schema/user/email-fields.test.ts`, using the harness the other `graphql/schema/user/**` tests use (read one first — `graphql/test-util.ts` exports `createHarness` and viewer fixtures):

```ts
it('lets an admin read another user’s address and confirmed state', async () => {
  const harness = createHarness();
  const id = await harness.createReader('ann');
  await setUserEmail(harness.prisma, id, 'ann@example.com');
  await markEmailVerified(harness.prisma, id);

  const result = await harness.execute(
    `query($id: ID!) { node(id: $id) { ... on User { email emailVerifiedAt } } }`,
    { id: harness.globalUserId(id) },
    harness.adminViewer
  );

  expect(result.errors).toBeUndefined();
  expect(result.data?.node.email).toBe('ann@example.com');
  expect(result.data?.node.emailVerifiedAt).not.toBeNull();
});

it('lets a user read their own address', async () => {
  const harness = createHarness();
  const id = await harness.createReader('ann');
  await setUserEmail(harness.prisma, id, 'ann@example.com');

  const result = await harness.execute(
    `query($id: ID!) { node(id: $id) { ... on User { email emailVerifiedAt } } }`,
    { id: harness.globalUserId(id) },
    harness.viewerFor('ann', id)
  );

  expect(result.data?.node.email).toBe('ann@example.com');
  // Never confirmed: setUserEmail always clears emailVerifiedAt.
  expect(result.data?.node.emailVerifiedAt).toBeNull();
});

it('does not let one reader read another reader’s address', async () => {
  const harness = createHarness();
  const annId = await harness.createReader('ann');
  const bobId = await harness.createReader('bob');
  await setUserEmail(harness.prisma, annId, 'ann@example.com');

  const result = await harness.execute(
    `query($id: ID!) { node(id: $id) { ... on User { email } } }`,
    { id: harness.globalUserId(annId) },
    harness.viewerFor('bob', bobId)
  );

  // `User`'s own findUnique redirects a non-owner to NO_MATCH_USER_ID, so the
  // node resolves null rather than erroring — assert no address leaks either way.
  expect(JSON.stringify(result)).not.toContain('ann@example.com');
});
```

The harness helper names above (`createReader`, `globalUserId`, `viewerFor`, `adminViewer`) are what the neighbouring tests use — **read `graphql/test-util.ts` and use whatever it actually exports.** Several helper names in this project's briefs have not existed; if one of these does not, use the real one and say so in your report.

- [ ] **Step 2: Run the tests to verify they fail**

Run: `cd app/server && npx vitest run graphql/schema/user/email-fields.test.ts`
Expected: FAIL — `Cannot query field "email" on type "User"`.

- [ ] **Step 3: Add the two fields**

In `app/server/graphql/schema/user/model.ts`, inside `fields: (t) => ({ … })`, after `mustChangePassword`:

```ts
    /**
     * Owner-or-admin, via the same `ownerOf` field scope `User.library` below
     * uses. Declared at the field rather than left to the node's own
     * `findUnique` redirect: the boundary is stated where a reader looks for
     * it, and it does not silently widen if node reachability ever changes.
     *
     * The operator needs this to answer "who holds this address?", which
     * nothing in the app could answer before — `viewerSetEmail` writes only the
     * caller's own row, so a mistaken claim was previously both permanent and
     * invisible.
     */
    email: t.exposeString('email', {
      nullable: true,
      authScopes: (parent) => ({ ownerOf: parent.id }),
    }),

    /**
     * `Float` ms-epoch in the database, `DateTime` in the schema — so this is a
     * resolver, not an expose, and a resolver on a Prisma-backed type only sees
     * what it selects. `select: { … } as const` is the pattern
     * `progress/model.ts`'s `currentChapter` uses for exactly this reason.
     */
    emailVerifiedAt: t.field({
      type: 'DateTime',
      nullable: true,
      select: { emailVerifiedAt: true } as const,
      authScopes: (parent) => ({ ownerOf: parent.id }),
      resolve: (user) =>
        user.emailVerifiedAt === null ? null : epochToDate(user.emailVerifiedAt),
    }),
```

Import `epochToDate` from `../../derive` (check the correct relative depth from this file).

- [ ] **Step 4: Run the tests to verify they pass**

Run: `cd app/server && npx vitest run graphql/schema/user/email-fields.test.ts`
Expected: PASS.

- [ ] **Step 5: Regenerate the SDL and run the full suite**

```bash
cd app/server && npm run graphql:schema && npm test && npm run test:cost
```
Expected: PASS. If a cost test fires, **do not raise a budget** — those ceilings are deliberate and documented. Report it instead; two nullable scalars on an existing type should not move a budget.

- [ ] **Step 6: Lint and commit**

```bash
npm run lint
git add app/server/graphql/schema/user/model.ts app/server/graphql/schema/user/email-fields.test.ts app/server/graphql/schema.generated.graphql
git commit -m "feat(server): expose a user's address and confirmed state to its owner and the admin"
```

---

### Task 2: `userClearEmail`, and the error copy

**Files:**
- Create: `app/server/graphql/schema/user/mutation/clear-email.ts`
- Create: `app/server/graphql/schema/user/mutation/clear-email.test.ts`
- Modify: `app/server/graphql/schema/index.ts` (register the module)
- Modify: `app/server/graphql/schema/email-in-use-error/model.ts`
- Modify: `app/server/graphql/schema.generated.graphql` (regenerated)

**Interfaces:**
- Consumes: `isConfigAdminRow(prisma, userId)` from `services/admin-account.ts`; `invalidateEmailTokens(prisma, userId, purpose?)` from `services/email-token.ts`; `User.email`/`emailVerifiedAt` from Task 1.
- Produces GraphQL: `userClearEmail(input: UserClearEmailInput!): UserClearEmailResult` where `UserClearEmailInput` is `{ userId: ID! }` and the result union's single member is `UserClearEmailPayload { user: User! }`. The field is **nullable** — `null` means "no such user", and the config admin is deliberately indistinguishable from that.

**Follow `user/mutation/delete.ts`'s file shape exactly**: an explicit `<Name>Input`, an `objectRef` payload, an explicit `<Name>Result` union, and `builder.mutationField`. Read its doc comment on why a single-member union is the right shape rather than a compromise — the same reasoning applies here, and the same `authScopes: { admin: true }` applies.

- [ ] **Step 1: Write the failing tests**

Create `app/server/graphql/schema/user/mutation/clear-email.test.ts`:

```ts
const CLEAR = `mutation($input: UserClearEmailInput!) {
  userClearEmail(input: $input) { ... on UserClearEmailPayload { user { id email emailVerifiedAt } } }
}`;

it('clears the address, the key and the confirmed state', async () => {
  const harness = createHarness();
  const id = await harness.createReader('ann');
  await setUserEmail(harness.prisma, id, 'ann@example.com');
  await markEmailVerified(harness.prisma, id);

  const result = await harness.execute(CLEAR, { input: { userId: harness.globalUserId(id) } }, harness.adminViewer);

  expect(result.errors).toBeUndefined();
  const row = await harness.prisma.user.findUniqueOrThrow({ where: { id } });
  expect(row.email).toBeNull();
  expect(row.emailKey).toBeNull();
  expect(row.emailVerifiedAt).toBeNull();
});

it('invalidates outstanding email tokens of both purposes', async () => {
  const harness = createHarness();
  const id = await harness.createReader('ann');
  await setUserEmail(harness.prisma, id, 'ann@example.com');
  await issueEmailToken(harness.prisma, { userId: id, purpose: 'verify', email: 'ann@example.com' });
  await issueEmailToken(harness.prisma, { userId: id, purpose: 'reset', email: 'ann@example.com' });

  await harness.execute(CLEAR, { input: { userId: harness.globalUserId(id) } }, harness.adminViewer);

  expect(await harness.prisma.emailToken.count({ where: { userId: id } })).toBe(0);
});

it('frees the address for another account', async () => {
  const harness = createHarness();
  const annId = await harness.createReader('ann');
  const bobId = await harness.createReader('bob');
  await setUserEmail(harness.prisma, annId, 'shared@example.com');
  expect(await setUserEmail(harness.prisma, bobId, 'shared@example.com')).toEqual({ ok: false, reason: 'in_use' });

  await harness.execute(CLEAR, { input: { userId: harness.globalUserId(annId) } }, harness.adminViewer);

  expect(await setUserEmail(harness.prisma, bobId, 'shared@example.com')).toEqual({ ok: true });
});

it('refuses the config admin row, and writes nothing to it', async () => {
  const harness = createHarness();
  const adminId = await ensureAdminUser(harness.prisma, 'admin');
  await setUserEmail(harness.prisma, adminId, 'boss@example.com');

  const result = await harness.execute(CLEAR, { input: { userId: harness.globalUserId(adminId) } }, harness.adminViewer);

  expect(result.errors).toBeUndefined();
  expect(result.data?.userClearEmail).toBeNull();
  // THE LOAD-BEARING ASSERTION: a guard that returned null while still writing
  // would satisfy the line above and leave the defect intact. Same reasoning as
  // `userResetPassword`'s guard test asserting `passwordHash` is still null.
  const row = await harness.prisma.user.findUniqueOrThrow({ where: { id: adminId } });
  expect(row.email).toBe('boss@example.com');
});

it('returns null for a user that does not exist', async () => {
  const harness = createHarness();
  const result = await harness.execute(
    CLEAR,
    { input: { userId: harness.globalUserId('no-such-user') } },
    harness.adminViewer
  );
  expect(result.data?.userClearEmail).toBeNull();
});

it('re-gates the cleared user when mail is configured', async () => {
  // mustSetEmail is derived (`email == null && mailConfigured`), so clearing an
  // address puts the user back on the set-email screen at their next token
  // refresh. This is the consequence the admin-facing copy warns about, and it
  // is the one behaviour of this mutation a user actually notices.
  const harness = createHarness({ mail: MAIL_CONFIG });
  const id = await harness.createReader('ann');
  await setUserEmail(harness.prisma, id, 'ann@example.com');
  expect(await computeMustSetEmail(harness.prisma, harness.config, 'ann')).toBe(false);

  await harness.execute(CLEAR, { input: { userId: harness.globalUserId(id) } }, harness.adminViewer);

  expect(await computeMustSetEmail(harness.prisma, harness.config, 'ann')).toBe(true);
});

it('is refused for a non-admin viewer', async () => {
  const harness = createHarness();
  const id = await harness.createReader('ann');
  const result = await harness.execute(
    CLEAR,
    { input: { userId: harness.globalUserId(id) } },
    harness.viewerFor('ann', id)
  );
  expect(result.errors?.[0].message).toMatch(/not authorized/i);
});
```

Use whatever the real harness exports; report any name that does not exist.

- [ ] **Step 2: Run the tests to verify they fail**

Run: `cd app/server && npx vitest run graphql/schema/user/mutation/clear-email.test.ts`
Expected: FAIL — `Unknown type "UserClearEmailInput"`.

- [ ] **Step 3: Write the mutation**

Create `app/server/graphql/schema/user/mutation/clear-email.ts`, following `delete.ts`'s structure. The resolver:

```ts
    resolve: async (_parent, args, context) => {
      const owner = await context.loadOwner(args.input.userId.id);
      if (owner === null) return null;

      // The config admin's row is not an ordinary account. Creating that row is
      // what made this mutation's cross-account write possible at all, so it
      // carries the same guard `userDelete` and `userResetPassword` do, and
      // returns the same ordinary `null` — the row stays UNADDRESSABLE, not
      // merely protected, and is indistinguishable from one that is absent.
      if (await isConfigAdminRow(context.prisma, owner.userId)) return null;

      await context.prisma.user.update({
        where: { id: owner.userId },
        data: { email: null, emailKey: null, emailVerifiedAt: null },
      });

      // Both purposes: a verify code proves an address this row no longer
      // holds, and a reset code was sent to one. Neither may stay spendable.
      await invalidateEmailTokens(context.prisma, owner.userId);

      return { __typename: 'UserClearEmailPayload' as const, userId: owner.userId };
    },
```

Resolve `user` on the payload as a fresh `t.prismaField` lookup by that id — the same "field resolvers do the lookup" pattern `UserRegisterPayload.user` uses, rather than carrying a row forward.

Note it deliberately does **not** call `revokeAllForUsername`: losing an address does not compromise a password, and signing someone out for the operator's bookkeeping would be gratuitous. Say so in the doc comment.

Check how `delete.ts` obtains its target (`context.loadOwner` vs. something else) and match it — do not invent a lookup.

- [ ] **Step 4: Register the module**

Add the import to `app/server/graphql/schema/index.ts` in its existing grouped order.

- [ ] **Step 5: Run the tests to verify they pass**

Run: `cd app/server && npx vitest run graphql/schema/user/mutation/clear-email.test.ts`
Expected: PASS.

- [ ] **Step 6: Reword `EmailInUseError`**

In `app/server/graphql/schema/email-in-use-error/model.ts`, change the message from `'That email address is already in use by another account.'` to:

```ts
  message:
    'That email address is already in use by another account. Ask your administrator if you think it should be yours.',
```

Add a test alongside it proving the uniformity, since that is a security property rather than a copy preference:

```ts
it('says the same thing whether the holder has confirmed the address or not', async () => {
  // MUST be configured with mail: viewerSetEmail's first statement returns
  // EmailNotConfiguredError when it is not, which would make both messages
  // trivially equal and this test vacuous.
  const harness = createHarness({ mail: MAIL_CONFIG });
  const annId = await harness.createReader('ann');
  const bobId = await harness.createReader('bob');
  const carlId = await harness.createReader('carl');
  await setUserEmail(harness.prisma, annId, 'unconfirmed@example.com');
  await setUserEmail(harness.prisma, bobId, 'confirmed@example.com');
  await markEmailVerified(harness.prisma, bobId);

  const against = async (address: string) => {
    const result = await harness.execute(
      SET_EMAIL,
      { input: { email: address } },
      harness.viewerFor('carl', carlId)
    );
    return result.data?.viewerSetEmail.message;
  };

  // Identical strings: a different message for a confirmed holder would tell
  // whoever probed the address something about another account.
  expect(await against('unconfirmed@example.com')).toBe(await against('confirmed@example.com'));
});
```

`SET_EMAIL` is the `viewerSetEmail` mutation document; the existing `viewer/mutation/set-email.test.ts` has one to copy, along with `MAIL_CONFIG` (now shared from `test-support/mail.ts`).

No cooldown applies to either call, and you do not need to reset carl between them: `setUserEmail` runs before any token work, and an `in_use` outcome returns `emailInUseError()` immediately — `invalidateEmailTokens` and `issueEmailToken` sit below that return and are never reached on a collision. Verified against `set-email.ts` before this plan was written.

Add a comment: the message is deliberately **uniform** — it never says who holds the address or whether they have confirmed it, because it is returned to whoever probed the address, and that is operator-only information.

- [ ] **Step 7: Regenerate the SDL, run everything**

```bash
cd app/server && npm run graphql:schema && npm test && npm run test:cost
```
Expected: PASS.

- [ ] **Step 8: Lint and commit**

```bash
npm run lint
git add app/server/graphql app/server/graphql/schema.generated.graphql
git commit -m "feat(server): let an admin clear a user's email address"
```

---

### Task 3: Show the address in the admin user list, with a clear action

**Files:**
- Modify: `app/client/src/graphql/user.ts`
- Modify: `app/client/src/component/user-row/index.tsx`
- Modify: `app/client/src/component/user-row/index.test.tsx`
- Modify: `app/client/src/gql/*` (regenerated)

**Interfaces:**
- Consumes: `User.email`, `User.emailVerifiedAt` (Task 1); `userClearEmail` (Task 2).
- Produces: `UserClearEmailDocument` in `graphql/user.ts`; the row renders address, confirmed state and a clear action.

**`component/user-row` already does this exact dance for deletion** — a confirm modal that stays open and shows the server's own message inline on failure, closing only on a genuine payload. Read `handleDeleteUser`/`handleDeleteUserConfirm` and mirror that shape; do not invent a second pattern.

- [ ] **Step 1: Add the fields and the document**

In `app/client/src/graphql/user.ts`, add `email` and `emailVerifiedAt` to `UserRowFragment` (which currently selects `id`, `username`, `pendingBookRequestCount`), and add:

```ts
export const UserClearEmailDocument = graphql(`
  mutation UserClearEmail($input: UserClearEmailInput!) {
    userClearEmail(input: $input) {
      __typename
      ... on UserClearEmailPayload {
        user {
          id
          email
          emailVerifiedAt
        }
      }
    }
  }
`);
```

Selecting the updated `user` lets Apollo's normalized cache update the row in place — no refetch and no manual cache write, unlike deletion which must evict.

Run the client's codegen (check `app/client/package.json` for the script name) before writing the component, so the generated types exist.

- [ ] **Step 2: Write the failing tests**

In `app/client/src/component/user-row/index.test.tsx`, following the file's existing render helper and mock style:

```tsx
it('shows a confirmed address', () => {
  renderUserRow({ username: 'ann', email: 'ann@example.com', emailVerifiedAt: new Date().toISOString() });
  expect(screen.getByText('ann@example.com')).toBeInTheDocument();
  expect(screen.getByText(/confirmed/i)).toBeInTheDocument();
});

it('marks an unconfirmed address as not confirmed', () => {
  renderUserRow({ username: 'ann', email: 'ann@example.com', emailVerifiedAt: null });
  expect(screen.getByText(/not confirmed/i)).toBeInTheDocument();
});

it('offers no clear action when the user has no address', () => {
  renderUserRow({ username: 'ann', email: null, emailVerifiedAt: null });
  expect(screen.queryByRole('button', { name: /clear address/i })).toBeNull();
});

it('warns that the user will be asked to set a new address, then clears it', async () => {
  const user = userEvent.setup();
  renderUserRow(
    { username: 'ann', email: 'ann@example.com', emailVerifiedAt: null },
    { mocks: [clearEmailMock('ann@example.com')] }
  );

  await user.click(screen.getByRole('button', { name: /clear address/i }));
  // The consequence must be stated before the operator confirms: clearing
  // re-gates the user, because mustSetEmail is derived from email == null.
  expect(await screen.findByText(/asked to set (a new )?(email )?address/i)).toBeInTheDocument();

  await user.click(screen.getByRole('button', { name: /^clear$/i }));
  await waitFor(() => expect(screen.queryByText('ann@example.com')).toBeNull());
});
```

`renderUserRow` and `clearEmailMock` stand for whatever the file already uses to render a row with fragment data and to build a `MockedResponse` — read it and follow it.

- [ ] **Step 3: Run the tests to verify they fail**

Run: `cd app/client && npx vitest run src/component/user-row/index.test.tsx`
Expected: FAIL — no address rendered, no clear action.

- [ ] **Step 4: Implement**

Render the address and a confirmed/not-confirmed indicator, and a "Clear address" action shown **only when the user has one**. Wire the mutation through the same confirm-modal shape `handleDeleteUserConfirm` uses: modal stays open on failure showing the server's message, closes on a genuine `UserClearEmailPayload`.

The confirmation copy must state the consequence: the user will be asked to set an address again the next time their session refreshes.

- [ ] **Step 5: Run the tests to verify they pass**

Run: `cd app/client && npx vitest run src/component/user-row/index.test.tsx`
Expected: PASS.

- [ ] **Step 6: Full suite, lint, commit**

```bash
cd app/client && npm test
cd ../.. && npm run lint
git add app/client/src
git commit -m "feat(client): show and clear a user's email address in the admin list"
```

---

## Final verification

- [ ] `cd app/server && npm test` — green
- [ ] `cd app/client && npm test` — green
- [ ] `cd app/server && npm run test:cost` — budgets unchanged
- [ ] `npm run lint` **from the repo root** — green, including `graphql:schema:check` and the client codegen check
- [ ] Manual check: as admin, find a user holding an address, clear it, confirm a second user can then claim that address
- [ ] Manual check: the cleared user lands on the set-email screen at their next refresh
