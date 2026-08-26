# Devices & Users Migration Implementation Plan (spec 2, steps 3–4)

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Move the `/devices` and `/users` routes off REST onto Apollo, retiring `DeviceProvider` and `UserProvider` and building the mutation-cache machinery every later screen reuses.

**Architecture:** The two providers' React Context state dies; their *hooks* survive as thin Apollo-backed wrappers keeping their existing tuple signatures, so most consumers need no change. Reads come from the `Viewer` singleton (`viewer.devices`, `viewer.users`, `viewer.syncPassword`). Six of the ten mutations that need hand-written cache updates live here.

**Tech Stack:** React 19, TypeScript, Vite/Vitest, `@apollo/client@4`, graphql-codegen client-preset, oxlint/oxfmt.

**Scope:** steps 3–4 of the spec's 11-step sequencing. Steps 5–10 (library grid, book detail, book edit, progress, upload, sweep) are NOT in this plan.

## Global Constraints

- **Verification is the repo-ROOT command** `cd /Users/korzun/.supacode/repos/Bookplate/graphql-migration && npm run lint`; it must exit 0. Do NOT substitute per-file linting — `oxlint` and `oxfmt` are separate tools and only the latter catches formatting. Root lint also runs the client's `codegen:check` and the server's `graphql:schema:check`.
- **Baselines:** server **1953**, client **1013**, `npm run test:cost -w app/server` **33**, root lint 0. Do not regress.
- oxlint ERRORS: `typescript/no-explicit-any`, `no-shadow`, `eqeqeq` (null-ignoring), `react-hooks/exhaustive-deps`. Never use `any`.
- **No server changes.** If a screen has nowhere to go, surface it and STOP — do not patch the schema mid-client-work. (That rule already paid for itself: it caught `userChangePassword` being uncallable, which is why it now takes no `userId`.)
- Every new document is measured by the cost gate and linted by the cache-key check the moment codegen runs. Both read `persisted-documents.json`.
- After adding or changing any document you MUST run `npm run codegen -w app/client` and commit the regenerated `src/gql/`, or lint fails its freshness check.
- `docs/` is gitignored — never commit anything under it.

## Facts established before this plan — do not re-derive

**Mock data shape.** Generated types carry `__typename` at every level *including the root*, so mock `data` objects need `__typename: 'Query'` / `'Mutation'`. See `provider/apollo/client.test.tsx` for the pattern.

**Fragment masking is ON — and this plan avoids it entirely.** Masking only applies to *named* fragments: fields selected through one are not readable from the parent's result without `useFragment`. Every document in this plan selects fields **inline**, so no unmasking is needed. Do not introduce a named fragment here to "share" a selection; that trades a real simplification for an unnecessary mechanism.

**`Viewer` is a singleton with `keyFields: []`**, so `cache.identify({ __typename: 'Viewer' })` yields `Viewer:{}` — that is the id to hand `cache.modify` when appending to `viewer.devices` / `viewer.users`.

**Deletes need only `cache.evict`.** `Viewer.devices` and `Viewer.users` are arrays **of references**, which Apollo auto-filters once the referenced entity is evicted. The connection-edge-filter helper the spec describes is NOT needed here — it exists for `Library.entries`/`Library.progress`, whose edges are objects wrapping a `node` ref. Do not build it in this plan.

**Identity, verified against the SDL:**
- Device mutations take `deviceId: String!` — a **raw** id. `Device` is not a `Node`; `Device.id` is `t.exposeID('id')`.
- `deviceEnableUser`/`deviceDisableUser` take `deviceId: String!` **and** `userId: ID!` — the latter a **User global ID**.
- `userDelete`, `userResetPassword`, `userRegenerateSyncPassword` take `userId: ID!` (global ID).
- **`userChangePassword` takes NO user identifier** — only `currentPassword`/`newPassword`. It derives the caller from the viewer.
- The client's `User` type today is `{ username, progressCount }` with **no id**. It must gain `id`.

**Cost model — the specific trap in this plan.** `Viewer.devices` carries a ×100 multiplier and `Device.enabledUsers` a ×50 one, so a selection *nested under both* is priced ×5000 per field. `viewer { devices { enabledUsers { id username } } }` costs roughly 10,000 complexity — about 30% of the 33,000 budget on its own. Select `enabledUsers { id }` and nothing more unless you have measured the alternative. (For contrast, the plain `viewer { users { id username progressCount } }` is cheap: ×50 over three scalars. The project's 68.5% anchor is the admin *progress* traversal `viewer.users → library.progress(first: 50)`, not a plain user list.)

## Deliberate non-changes — do not "fix" these

- **`UserRowContent` keeps its `username` prop and stays on REST.** It reads `useUserProgressList(username)` from the progress provider, which is step 8. Leave it.
- **`Device` does not become a `Node`**, and device ids stay raw strings. That is the schema's deliberate shape.
- **No optimistic UI is added** where none exists today. `use-delete-device` currently does an optimistic remove with rollback; preserve that behaviour, do not extend the pattern to other mutations.

---

### Task 1: `unwrapResult` — the shared three-way mutation-result helper

Every mutation result in this schema is a union, and most are nullable. Call sites branch three ways: `null` (entity gone) / a typed error member / the payload. One helper, used by every later task.

**Files:**
- Create: `app/client/src/provider/apollo/unwrap-result.ts`
- Test: `app/client/src/provider/apollo/unwrap-result.test.ts`

**Interfaces:**
- Produces: `unwrapResult(result, payloadTypename)` returning a discriminated `{ status: 'ok'; payload } | { status: 'error'; message; typename } | { status: 'missing' }`. Every later task consumes it.

- [ ] **Step 1: Write the failing test**

Create `app/client/src/provider/apollo/unwrap-result.test.ts`:

```ts
import { describe, expect, it } from 'vitest';

import { unwrapResult } from './unwrap-result';

describe('unwrapResult', () => {
  it('returns the payload when the result is the expected member', () => {
    const result = unwrapResult(
      { __typename: 'DeviceCreatePayload', device: { __typename: 'Device', id: 'd1' } },
      'DeviceCreatePayload'
    );

    expect(result).toEqual({
      status: 'ok',
      payload: { __typename: 'DeviceCreatePayload', device: { __typename: 'Device', id: 'd1' } },
    });
  });

  // A nullable mutation field resolves null when the entity does not exist.
  // That is NOT an error the server described — it is a distinct third case,
  // and a caller that collapses it into the error branch reports a fabricated
  // message the server never sent.
  it('reports a null result as missing, not as an error', () => {
    expect(unwrapResult(null, 'DeviceUpdatePayload')).toEqual({ status: 'missing' });
    expect(unwrapResult(undefined, 'DeviceUpdatePayload')).toEqual({ status: 'missing' });
  });

  it('surfaces a typed error member with the server message and its typename', () => {
    const result = unwrapResult(
      { __typename: 'DeviceSlugConflictError', message: 'Slug already in use', slug: 'kindle' },
      'DeviceCreatePayload'
    );

    expect(result).toEqual({
      status: 'error',
      message: 'Slug already in use',
      typename: 'DeviceSlugConflictError',
    });
  });

  // InvalidInputError carries per-field issues. The generic branch must not
  // drop them on the floor by reading only `message`.
  it('keeps a typed error distinguishable by typename so callers can branch', () => {
    const result = unwrapResult(
      { __typename: 'InvalidInputError', message: 'Invalid input', issues: [] },
      'UserRegisterPayload'
    );

    expect(result).toMatchObject({ status: 'error', typename: 'InvalidInputError' });
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

```bash
cd /Users/korzun/.supacode/repos/Bookplate/graphql-migration && npx vitest run src/provider/apollo/unwrap-result.test.ts --root app/client
```

Expected: FAIL — `Cannot find module './unwrap-result'`.

- [ ] **Step 3: Write the implementation**

Create `app/client/src/provider/apollo/unwrap-result.ts`:

```ts
/**
 * Every mutation in this schema returns a `<Name>Result` UNION — even
 * single-member ones — and most result fields are nullable ("Resolves to null
 * when the … does not exist"). So a call site has three outcomes, not two:
 *
 *   missing  the field resolved null: the entity is gone. NOT an error the
 *            server described, and reporting it as one invents a message.
 *   error    a typed `UserError` member: the server's own message, and a
 *            `typename` so a caller can branch (e.g. InvalidInputError's
 *            per-field issues vs a flat conflict).
 *   ok       the expected payload member.
 *
 * Transport failures never reach here — those are thrown by Apollo and handled
 * by the link chain. Typed errors arrive in `data` and are ordinary values.
 */
export type UnwrappedResult<TPayload> =
  | { status: 'ok'; payload: TPayload }
  | { status: 'error'; message: string; typename: string }
  | { status: 'missing' };

type MaybeMember = { __typename?: string; message?: string } | null | undefined;

export const unwrapResult = <TPayload extends { __typename?: string }>(
  result: MaybeMember,
  payloadTypename: TPayload extends { __typename?: infer N } ? N : never
): UnwrappedResult<TPayload> => {
  if (result === null || result === undefined) return { status: 'missing' };

  if (result.__typename === payloadTypename) {
    return { status: 'ok', payload: result as TPayload };
  }

  return {
    status: 'error',
    message: result.message ?? 'Something went wrong',
    typename: result.__typename ?? 'UnknownError',
  };
};
```

If the generic signature fights you, simplify it — a looser signature that still discriminates the three cases is acceptable, but do NOT use `any` and do NOT collapse `missing` into `error`.

- [ ] **Step 4: Run tests to verify they pass**

```bash
npx vitest run src/provider/apollo/unwrap-result.test.ts --root app/client
```

Expected: PASS, 4 tests.

- [ ] **Step 5: Demonstrate the missing/error split can fail (seen-to-fail)**

Temporarily change the null check to fall through into the error branch (i.e. treat `null` as an error). Re-run; the "reports a null result as missing" test must FAIL. Revert. Record the output — this split is the whole reason the helper exists.

- [ ] **Step 6: Commit**

```bash
git add app/client/src/provider/apollo/unwrap-result.ts app/client/src/provider/apollo/unwrap-result.test.ts
git commit -m "feat(client): add unwrapResult, the three-way mutation-result helper"
```

---

### Task 2: Device list read

**Files:**
- Create: `app/client/src/graphql/device.ts`
- Modify: `app/client/src/provider/device/hook/use-device-list.ts`
- Test: `app/client/src/provider/device/hook/use-device-list.test.tsx`
- Modify (generated, committed): `app/client/src/gql/**`

**Interfaces:**
- Consumes: `renderWithApollo` from `~/test-utils`.
- Produces: `DeviceListDocument` from `~/graphql/device`, selecting `viewer { devices { … } }`. `useDeviceList()` keeps its existing tuple `[Device[], loading, hasError, errorMessage]` so `component/device-list` and `component/connection-urls` need NO change.

- [ ] **Step 1: Read what the current hook returns and who consumes it**

```bash
cd /Users/korzun/.supacode/repos/Bookplate/graphql-migration/app/client/src
cat provider/device/hook/use-device-list.ts
cat provider/device/type.ts
grep -rn "useDeviceList" component | grep -v "\.test\."
```

The hook returns devices **sorted by name** (`sortDeviceList`) as an array. Preserve that ordering — the server returns `orderBy: { name: 'asc' }` already, so the client sort becomes redundant, but verify that before dropping it and say what you found.

- [ ] **Step 2: Write the document**

Create `app/client/src/graphql/device.ts`:

```ts
import { graphql } from '~/gql';

/**
 * Devices hang off the `Viewer` singleton, which is already `keyFields: []` in
 * `cacheConfig` — that is what makes `cache.modify` able to address the list
 * when a later task appends to it.
 *
 * Fields selected inline rather than through a named fragment: fragment
 * masking is ON, and an inline selection needs no `useFragment` to read.
 *
 * NOTE the cost shape before adding anything here: `Viewer.devices` carries a
 * ×100 multiplier. `Device.enabledUsers` adds ×50 ON TOP, so a field selected
 * under both is priced ×5000. This document deliberately does NOT select
 * `enabledUsers` — the device-form task fetches those separately.
 */
export const DeviceListDocument = graphql(`
  query DeviceList {
    viewer {
      devices {
        id
        name
        slug
        coverWidth
        coverHeight
        coverFit
        bwCover
        simplify
      }
    }
  }
`);
```

Run `npm run codegen -w app/client`.

- [ ] **Step 3: Write the failing test**

Rewrite `use-device-list.test.tsx` to use `renderWithApollo`. Follow the probe-component pattern already used in `provider/library-target/hook/use-current-library-id.test.tsx`. Cover:
- the happy path returns devices in name order with the tuple's shape unchanged;
- `loading` is true before the mock resolves;
- a GraphQL error surfaces as `hasError === true` with a message, rather than an empty list that looks like "no devices" (this is the silent-failure class an earlier fix round ruled unacceptable).

Mock data must carry `__typename: 'Query'` at the root, `__typename: 'Viewer'`, and `__typename: 'Device'` on each device.

- [ ] **Step 4: Run to verify it fails**

```bash
npx vitest run src/provider/device/hook/use-device-list.test.tsx --root app/client
```

Expected: FAIL — the hook still reads Context/REST.

- [ ] **Step 5: Rewrite the hook**

Replace `use-device-list.ts`'s body with a `useQuery(DeviceListDocument)` and map to the existing tuple. Keep the exported `UseDeviceList` type and `sortDeviceList` if still needed. Remove the `Context` import, the `apiFetch` import, and the mount-time fetch effect — `useQuery` handles fetching.

`coverFit` arrives as the enum `CONTAIN|COVER|FILL|SMART` while the client type uses lowercase `'contain'|'cover'|'fill'|'smart'`. Map it explicitly; do not cast. Put the mapping in one exported function — Task 3 needs the inverse for mutations.

- [ ] **Step 6: Verify, including the consumers you did not touch**

```bash
npx vitest run src/provider/device src/component/device-list src/component/connection-urls --root app/client
npm test -w app/client
cd /Users/korzun/.supacode/repos/Bookplate/graphql-migration && npm run lint
npm run test:cost -w app/server
```

Expected: all green; `test:cost` still 33 with `DeviceList` added to the printed table well under 70%. If it is not, STOP and report the measured number rather than trimming the selection to fit without saying so.

- [ ] **Step 7: Commit**

```bash
git add app/client/src/graphql/device.ts app/client/src/gql app/client/src/provider/device
git commit -m "feat(client): read the device list over GraphQL"
```

---

### Task 3: Device create / update / delete

**Files:**
- Modify: `app/client/src/graphql/device.ts`
- Modify: `app/client/src/provider/device/hook/use-create-device.ts`, `use-update-device.ts`, `use-delete-device.ts`
- Test: the matching `.test.tsx` files
- Modify: `app/client/src/gql/**`

**Interfaces:**
- Consumes: `unwrapResult` (Task 1), the `coverFit` mapping (Task 2).
- Produces: `DeviceCreateDocument`, `DeviceUpdateDocument`, `DeviceDeleteDocument`. All three hooks keep their existing tuple signatures, so `component/device-form` and `component/device-list` need no signature change.

**Cache work — this is the task's real content:**
- `deviceCreate` → **append** to `viewer.devices` via `cache.modify` on the `Viewer` singleton. A returned entity does not insert itself into a list.
- `deviceUpdate` → **free**. It returns the `Device`, which normalizes over the existing entity.
- `deviceDelete` → `cache.evict({ id: cache.identify({ __typename: 'Device', id: deletedDeviceId }) })`. `viewer.devices` is an array of references, so Apollo auto-filters the dangling one — **no manual list edit**.

- [ ] **Step 1: Read the SDL shapes so you build inputs correctly**

```bash
cd /Users/korzun/.supacode/repos/Bookplate/graphql-migration
sed -n '/^input DeviceCreateInput/,/^}/p;/^input DeviceUpdateInput/,/^}/p;/^input DeviceDeleteInput/,/^}/p' app/server/graphql/schema.generated.graphql
grep -n "union DeviceCreateResult\|union DeviceUpdateResult\|union DeviceDeleteResult" app/server/graphql/schema.generated.graphql
sed -n '/^type DeviceSlugConflictError/,/^}/p' app/server/graphql/schema.generated.graphql
```

Note `deviceUpdate`/`deviceDelete` take `deviceId: String!` (raw), and both create and update can return `DeviceSlugConflictError` — a real, user-facing case the form must show.

- [ ] **Step 2: Write the three documents**

Append to `app/client/src/graphql/device.ts`. Each selects `__typename`, the payload's `device { … }` with the same fields as `DeviceListDocument`, and every error member's `message`. `DeviceDeletePayload` returns `deletedDeviceId: String!`.

Run `npm run codegen -w app/client`.

- [ ] **Step 3: Write the failing tests**

For each hook, using `renderWithApollo`. The assertions that matter:
- **create**: after a successful create, the new device appears in a subsequent `DeviceList` read **from the cache** — i.e. the append actually happened. Assert by reading the cache, not by re-mocking the query.
- **create**: a `DeviceSlugConflictError` surfaces the server's message through the tuple's error slot, and does NOT append anything.
- **update**: the changed device's fields are updated in the cache with no explicit update function (proving normalization does the work).
- **delete**: the device is gone from a cached `DeviceList` read afterwards.

- [ ] **Step 4: Run to verify they fail**

```bash
npx vitest run src/provider/device --root app/client
```

- [ ] **Step 5: Rewrite the three hooks**

Use `useMutation` plus `unwrapResult`. For the append:

```ts
update: (cache, { data }) => {
  const created = unwrapResult(data?.deviceCreate, 'DeviceCreatePayload');
  if (created.status !== 'ok') return;

  cache.modify({
    id: cache.identify({ __typename: 'Viewer' }),
    fields: {
      devices: (existing: readonly Reference[] = [], { toReference }) => {
        const ref = toReference(created.payload.device);
        return ref ? [...existing, ref] : existing;
      },
    },
  });
},
```

For delete, evict only — do not hand-filter `viewer.devices`.

**Preserve `use-delete-device`'s optimistic removal and rollback.** It currently removes the device from local state immediately and restores it if the request fails. Under Apollo that is `optimisticResponse` plus the same `update`; an optimistic response must name the concrete union member's `__typename` and supply every field the mutation selects.

- [ ] **Step 6: Verify**

```bash
npx vitest run src/provider/device src/component/device-form src/component/device-list --root app/client
npm test -w app/client
cd /Users/korzun/.supacode/repos/Bookplate/graphql-migration && npm run lint && npm run test:cost -w app/server
```

- [ ] **Step 7: Seen-to-fail on the append**

Delete the `cache.modify` block from the create hook. The "new device appears in a cached read" test must FAIL. Revert, confirm green, record the output. Then do the same for delete: remove the `cache.evict` call and confirm its test fails.

- [ ] **Step 8: Commit**

```bash
git add app/client/src/graphql/device.ts app/client/src/gql app/client/src/provider/device
git commit -m "feat(client): move device create/update/delete to GraphQL with cache updates"
```

---

### Task 4: User list read, and `User` gains an id

**Files:**
- Create: `app/client/src/graphql/user.ts`
- Modify: `app/client/src/provider/user/type.ts`, `provider/user/hook/use-user-list.ts`, `provider/user/hook/use-user.ts`
- Modify: `app/client/src/component/user-list/index.tsx`, `component/user-row/index.tsx`
- Test: `use-user-list.test.tsx`, `use-user.test.ts`
- Modify: `app/client/src/gql/**`

**Interfaces:**
- Produces: `UserListDocument` selecting `viewer { users { id username progressCount } }`. The client `User` type gains `id: string`. `UserRow` gains a `userId` prop alongside its existing `username`.

**Why `User` must gain an id.** Every user mutation takes `userId: ID!` — a **User global ID**. Today the client keys users by username end to end, and that cannot address these mutations. `viewer.users { id }` supplies it.

**`Viewer.users` is NULLABLE** (`[User!]`) — a non-admin selecting it gets `null` for that field rather than a failed operation. Treat `null` as "not permitted / no list", not as an error toast.

- [ ] **Step 1: Confirm the consumer surface**

```bash
cd /Users/korzun/.supacode/repos/Bookplate/graphql-migration/app/client/src
grep -rn "useUserList\|useUser(" component control page provider | grep -v "\.test\." | grep -v "provider/user/"
```

Expect: `component/library-switcher`, `component/device-form`, `component/user-list`, `component/user-row`, `page/library`, `page/upload`. Keeping `useUserList`'s tuple shape means only `user-list` and `user-row` change (for the id), and the other four are untouched. Confirm that holds before proceeding — if a consumer reads a field the new document does not select, add it to the document rather than reshaping the consumer.

- [ ] **Step 2: Write the document**

Create `app/client/src/graphql/user.ts` with `UserListDocument`:

```ts
export const UserListDocument = graphql(`
  query UserList {
    viewer {
      users {
        id
        username
        progressCount
      }
    }
  }
`);
```

`Viewer.users` carries a ×50 multiplier, so keep this to the three fields the UI actually uses. Do NOT add `library { … }` here — `viewer.users → library.progress` is the project's worst-measured legit shape at 68.5% of budget, and this is the query that would become it.

Run `npm run codegen -w app/client`.

- [ ] **Step 3: Write the failing tests**

Cover: the list maps to the tuple with `id` present; `users: null` (non-admin) yields an empty list and NOT an error; a GraphQL error yields the error slot.

- [ ] **Step 4: Run to verify they fail, then rewrite the hooks**

Rewrite `use-user-list.ts` on `useQuery(UserListDocument)`, keeping its tuple. Rewrite `use-user.ts` to find by username within that list, as it does today — its signature does not change.

Add `id: string` to the `User` type in `provider/user/type.ts`.

- [ ] **Step 5: Thread the id to the two components that need it**

- `component/user-list/index.tsx`: pass `userId={user.id}` alongside the existing `username={user.username}`.
- `component/user-row/index.tsx`: accept `userId`, keep `username` for display, and keep passing `username` down to `UserRowContent` (which stays on REST — step 8). Do not change `UserRowContent`.

Leave `ResetPasswordButton`'s props alone in this task; Task 6 changes it when the mutation moves.

- [ ] **Step 6: Verify**

```bash
npx vitest run src/provider/user src/component/user-list src/component/user-row src/component/library-switcher --root app/client
npm test -w app/client
cd /Users/korzun/.supacode/repos/Bookplate/graphql-migration && npm run lint && npm run test:cost -w app/server
```

Expected: green, and `UserList` in the cost table well under 70%. Report its measured percentage.

- [ ] **Step 7: Commit**

```bash
git add app/client/src/graphql/user.ts app/client/src/gql app/client/src/provider/user app/client/src/component/user-list app/client/src/component/user-row
git commit -m "feat(client): read the user list over GraphQL, carrying User global ids"
```

---

### Task 5: Device enable / disable user

**Files:**
- Modify: `app/client/src/graphql/device.ts`
- Modify: `app/client/src/provider/device/hook/use-device-users.ts`, `use-enable-device-user.ts`, `use-disable-device-user.ts`
- Test: the matching test files
- Modify: `app/client/src/gql/**`

**Interfaces:**
- Consumes: `unwrapResult` (Task 1), User global ids from `UserListDocument` (Task 4).
- Produces: `DeviceUsersDocument`, `DeviceEnableUserDocument`, `DeviceDisableUserDocument`.

**The cost trap, restated because this is the task that hits it.** `Device.enabledUsers` is ×50 nested under `Viewer.devices`'s ×100 — ×5000 per selected field. Select `enabledUsers { id }` ONLY. If the UI needs usernames, resolve them against the already-cached `UserList` rather than selecting `username` here. Measure before and after and report both numbers.

**These two mutations are otherwise FREE** — they return `device { id enabledUsers { id } }`, which normalizes over the existing `Device` entity, so no `update` function is needed. Verify that is what actually happens rather than assuming it.

- [ ] **Step 1: Read the current hook and its consumer**

```bash
cd /Users/korzun/.supacode/repos/Bookplate/graphql-migration/app/client/src
cat provider/device/hook/use-device-users.ts
sed -n '60,130p' component/device-form/index.tsx
```

`useDeviceUsers(deviceId)` takes an optional id and is called with `isAdmin ? device?.id : undefined`. Note the existing comment about a set-state-in-effect render loop caused by a fresh `[]` identity — preserve whatever guards that, or reproduce it with a stable empty array.

- [ ] **Step 2: Write the documents, then the failing tests, then the hooks**

`DeviceUsersDocument` selects one device's enabled users. There is no `Query.device`, so it goes through `viewer { devices { id enabledUsers { id } } }` and the hook picks the matching device — **or**, if you find a cheaper reachable path, use it and say what you measured.

Tests must cover: enabling a user makes them appear in a cached read of that device's enabled users; disabling removes them; and neither mutation needs a hand-written `update` (assert by omitting one and showing the cache still updates).

- [ ] **Step 3: Verify and measure**

```bash
npx vitest run src/provider/device src/component/device-form --root app/client
npm test -w app/client
cd /Users/korzun/.supacode/repos/Bookplate/graphql-migration && npm run lint && npm run test:cost -w app/server
```

**Report the measured complexity of `DeviceUsers` as a percentage of budget.** If it exceeds 70%, STOP and report — do not silently reduce the selection below what the UI needs.

- [ ] **Step 4: Commit**

```bash
git add app/client/src/graphql/device.ts app/client/src/gql app/client/src/provider/device
git commit -m "feat(client): move device user enablement to GraphQL"
```

---

### Task 6: User register / delete / reset password

**Files:**
- Modify: `app/client/src/graphql/user.ts`
- Modify: `app/client/src/provider/user/hook/use-register-user.ts`, `use-delete-user.ts`, `use-reset-user-password.ts`
- Modify: `app/client/src/component/user-register/index.tsx`, `component/user-row/index.tsx`, `control/reset-password-button/index.tsx`
- Test: the matching test files
- Modify: `app/client/src/gql/**`

**Interfaces:**
- Consumes: `unwrapResult`, User global ids from Task 4.
- Produces: `UserRegisterDocument`, `UserDeleteDocument`, `UserResetPasswordDocument`.

**Signature changes are unavoidable here** — these three take a User global ID where the hooks currently take a username:
- `useDeleteUser`'s function takes `userId` instead of `username`. `UserRow` already has `userId` from Task 4.
- `useResetUserPassword`'s function takes `userId`. **`ResetPasswordButton` must gain a `userId` prop**; update every place that renders it.
- `useRegisterUser` still takes a `username` — `userRegister(input: { username })` creates the account, so there is no id yet.

**Cache work:**
- `userRegister` → **append** to `viewer.users` via `cache.modify` on the `Viewer` singleton (same shape as Task 3's device append).
- `userDelete` → `cache.evict` the `User` by `deletedId` (a global ID — feed it straight to `cache.identify({ __typename: 'User', id: deletedId })`). Array of refs auto-filters; no manual list edit.
- `userResetPassword` → **free**; it returns the `User` plus the new password.

- [ ] **Step 1: Find every `ResetPasswordButton` render site**

```bash
cd /Users/korzun/.supacode/repos/Bookplate/graphql-migration/app/client/src
grep -rn "ResetPasswordButton" component control page | grep -v "\.test\." | grep -v "reset-password-button/index.tsx"
```

Every one needs a `userId`. If any render site does not have a User id in scope, STOP and report rather than reaching for a lookup by username.

- [ ] **Step 2: Documents, failing tests, then hooks**

Test assertions that matter:
- register: the new user appears in a cached `UserList` read; `UsernameAlreadyExistsError` surfaces its message and appends nothing.
- delete: the user is gone from a cached read.
- reset: returns the generated password; no cache surgery needed.

- [ ] **Step 3: Seen-to-fail on both cache updates**

Remove the register append → its test must fail. Remove the delete evict → its test must fail. Revert both, record the output.

- [ ] **Step 4: Verify and commit**

```bash
npx vitest run src/provider/user src/component/user-register src/component/user-row src/control/reset-password-button --root app/client
npm test -w app/client
cd /Users/korzun/.supacode/repos/Bookplate/graphql-migration && npm run lint && npm run test:cost -w app/server
git add app/client/src/graphql/user.ts app/client/src/gql app/client/src/provider/user app/client/src/component app/client/src/control
git commit -m "feat(client): move user register/delete/reset-password to GraphQL"
```

---

### Task 7: Sync password

**Files:**
- Modify: `app/client/src/graphql/user.ts`
- Modify: `app/client/src/provider/user/hook/use-sync-password.ts`, `use-regenerate-sync-password.ts`
- Test: the matching test files
- Modify: `app/client/src/gql/**`

**Interfaces:**
- Produces: `SyncPasswordDocument` (`viewer { syncPassword }`) and `UserRegenerateSyncPasswordDocument`.

**The wrinkle that makes this its own task.** `userRegenerateSyncPassword` returns `{ syncPassword, user }`, but the field the UI reads is **`Viewer.syncPassword`** — a different place. A returned payload does not update it. This needs an explicit `cache.modify` on the `Viewer` singleton writing the new `syncPassword`.

`Viewer.syncPassword` is nullable and is `null` for the config-based admin (it has no user row). Treat null as "not applicable", not as a failure.

**The mutation takes `userId: ID!`** — the viewer's own User global ID. Get it from `viewer.user { id }`, which the `ViewerBootstrap` document already selects; do not add a second source for it.

- [ ] **Step 1: Read the current hooks and the component**

```bash
cd /Users/korzun/.supacode/repos/Bookplate/graphql-migration/app/client/src
cat provider/user/hook/use-sync-password.ts provider/user/hook/use-regenerate-sync-password.ts
cat component/sync-password/index.tsx
```

- [ ] **Step 2: Documents, failing tests, then hooks**

The test that matters: after regenerating, a cached read of `viewer.syncPassword` returns the NEW value. Assert against the cache, not against the mutation's own payload — reading the payload would pass even with the `cache.modify` missing, which is the exact gap this task exists to close.

- [ ] **Step 3: Seen-to-fail**

Remove the `cache.modify`. The "cached `viewer.syncPassword` is updated" test must FAIL while the mutation itself still resolves fine. Revert, record the output.

- [ ] **Step 4: Verify and commit**

```bash
npx vitest run src/provider/user src/component/sync-password --root app/client
npm test -w app/client
cd /Users/korzun/.supacode/repos/Bookplate/graphql-migration && npm run lint && npm run test:cost -w app/server
git add app/client/src/graphql/user.ts app/client/src/gql app/client/src/provider/user
git commit -m "feat(client): move sync-password read and regeneration to GraphQL"
```

---

### Task 8: Change my password, and the silent-logout contract

**Files:**
- Modify: `app/client/src/graphql/user.ts`
- Modify: `app/client/src/provider/user/hook/use-change-my-password.ts`
- Modify: `app/client/src/component/user-change-password/index.tsx` and/or `app/client/src/page/password-reset/index.tsx` as the logout contract requires
- Test: the matching test files
- Modify: `app/client/src/gql/**`

**Interfaces:**
- Produces: `UserChangePasswordDocument`.

**`UserChangePasswordInput` takes NO user identifier** — only `currentPassword` and `newPassword`. The server derives the caller from the viewer. This is recent and deliberate: requiring a `userId` made the mutation uncallable by exactly the users it exists for, because a viewer with a pending forced change is refused by every `Query` field and so could never obtain their own global ID. **Do not add a `userId` variable.** If you find yourself needing one, stop — something has regressed.

**The silent-logout contract.** A successful change revokes the caller's own refresh tokens, and the server cannot reissue cookies from a GraphQL context. So success means **log out and navigate to `/login`** — never "continue the session". The existing REST flow already does something here; read it and preserve the user-visible behaviour.

**Two call sites, two contexts:** the settings form (`component/user-change-password`) and the forced-reset page (`page/password-reset`), which is where `ProtectedRoute` sends every `mustChangePassword` user. Both must work. The forced-reset path is the one that was structurally broken before the server change — give it a test.

**Typed errors:** `IncorrectPasswordError` and `InvalidInputError` are both members. The form must distinguish "wrong current password" from a validation issue, and `InvalidInputError` carries per-field `issues` the form can attach to the right input.

- [ ] **Step 1: Read both call sites and the current hook**

```bash
cd /Users/korzun/.supacode/repos/Bookplate/graphql-migration/app/client/src
cat provider/user/hook/use-change-my-password.ts
cat component/user-change-password/index.tsx
cat page/password-reset/index.tsx
```

- [ ] **Step 2: Document, failing tests, then the hook**

Tests: success logs out and navigates to `/login`; `IncorrectPasswordError` surfaces its message and does NOT log out; the forced-reset page can complete a change.

- [ ] **Step 3: Seen-to-fail on the logout contract**

Remove the logout-on-success. The success test must FAIL. Revert, record the output — this contract is the one thing here that is silent when broken: the session simply continues with revoked tokens until the next request fails confusingly.

- [ ] **Step 4: Verify and commit**

```bash
npx vitest run src/provider/user src/component/user-change-password src/page/password-reset --root app/client
npm test -w app/client
cd /Users/korzun/.supacode/repos/Bookplate/graphql-migration && npm run lint && npm run test:cost -w app/server
git add app/client/src/graphql/user.ts app/client/src/gql app/client/src/provider/user app/client/src/component/user-change-password app/client/src/page/password-reset
git commit -m "feat(client): move change-password to GraphQL with the silent-logout contract"
```

---

### Task 9: Retire `DeviceProvider` and `UserProvider`

**Files:**
- Delete: `app/client/src/provider/device/context.ts`, `provider/device/provider.tsx`, and the device `util.ts`/`type.ts` if nothing still imports them
- Delete: `app/client/src/provider/user/context.ts`, `provider/user/provider.tsx`, and the user `util.ts` if unused
- Modify: `app/client/src/App.tsx`, `provider/device/index.ts`, `provider/user/index.ts`

**Interfaces:** the hooks' public exports are unchanged; only the Context/state layer disappears.

- [ ] **Step 1: Prove nothing still reads either Context**

```bash
cd /Users/korzun/.supacode/repos/Bookplate/graphql-migration/app/client/src
grep -rn "provider/device/context\|provider/user/context\|from '../context'" provider/device provider/user
grep -rn "DeviceProvider\|UserProvider" . | grep -v "\.test\."
```

Every hit must be the providers' own files or `App.tsx`. If a hook still uses `use(Context)`, that hook was not migrated — STOP and report which one, rather than deleting the Context out from under it.

- [ ] **Step 2: Remove them from the providers tree**

In `App.tsx`, delete the `[DeviceProvider]` and `[UserProvider]` entries and their imports. **Do not reorder the remaining entries** — `buildProvidersTree` renders the first entry outermost, and `ApolloRoot` must stay first.

- [ ] **Step 3: Delete the files and fix the barrels**

Remove the context/provider files and drop their exports from each `index.ts`, keeping every hook export.

- [ ] **Step 4: Prove the REST surface actually shrank**

```bash
cd /Users/korzun/.supacode/repos/Bookplate/graphql-migration
grep -rn "apiFetch" app/client/src/provider/device app/client/src/provider/user; echo "EXIT: $?"
grep -rc "apiFetch" app/client/src --include=*.ts --include=*.tsx | grep -v ":0" | wc -l
```

Expected: no matches in either provider directory (grep exits 1), and the count of files still calling `apiFetch` has dropped from 43 by the number this plan migrated. Record the new count — the spec's definition of done for the whole migration is that `apiFetch` survives only in the four sanctioned REST seams.

- [ ] **Step 5: Full verification**

```bash
npm test -w app/client
npm test -w app/server
npm run test:cost -w app/server
npm run lint
```

- [ ] **Step 6: Commit**

```bash
git add -A app/client/src
git commit -m "refactor(client): retire DeviceProvider and UserProvider"
```

---

## Definition of done

- `/devices` and `/users` read and mutate entirely over GraphQL; `DeviceProvider` and `UserProvider` no longer exist.
- No `apiFetch` under `app/client/src/provider/device` or `app/client/src/provider/user`.
- Six hand-written cache updates exist and each is demonstrated failing without its update function: `deviceCreate` append, `deviceDelete` evict, `userRegister` append, `userDelete` evict, `userRegenerateSyncPassword` modify, plus the `userChangePassword` logout contract.
- `npm run lint` clean from the repo ROOT.
- `npm test -w app/client` and `npm test -w app/server` green (counts will rise; report them).
- `npm run test:cost -w app/server` green, with every new document under 70% of both budgets. Report `DeviceUsers`'s measured percentage explicitly — it is the one at risk.
- Spec `2026-08-03-apollo-client-migration-design.md` §9's sequencing table updated to mark steps 3–4 complete.

## What this plan does NOT do

Steps 5–10: the library-target reshape and `/library` grid, book detail and series, book edit, progress screens, upload, and the final sweep. `useCurrentLibraryId` still returns `undefined` for admins until step 5. The connection-edge-filter helper is not built here — it is needed first by `Library.entries` in step 5.
