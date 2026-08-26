# Library-Target Reshape + `/library` Grid Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Move `/library` — target selection, the entries grid, both row cells, search suggestions and subjects — from REST onto GraphQL, and give `useCurrentLibraryId` its admin path.

**Architecture:** `library-target` stores a **Library global ID** instead of a username, so `useCurrentLibraryId()` finally serves admins and every screen roots on `node(id: $libraryId) { id ... on Library { … } }`. The grid reads `Library.entries` — a `Book | Series` union connection — and hands each edge's node to `BookRow`/`SeriesRow` as a **fragment**, replacing today's "render a bare id, let the cell fetch itself" pattern. `Book.progress`, `Book.thumbnailUrl(width:)` and `Book.coverUrl` come down with the connection, so the grid stops needing `ProgressProvider` and `lib/cover-url.ts` on this path.

**Tech Stack:** Apollo Client 4.2.9, graphql-codegen client-preset 6.1.0 (fragment masking ON), rxjs 7, vitest + MockLink, oxlint/oxfmt.

## Global Constraints

- **Root every library-scoped document on `node(id: $libraryId) { id ... on Library { … } }`.** `node(id:)` returns the `Node` **interface**, which declares its own `id` — an inline `... on Library { id }` satisfies `Library`'s cache key but **not** `Node`'s. Both are required. The cache-key guardrail will fail the build otherwise.
- **Fragment masking is ON.** A field selected through a named fragment is not accessible on the parent's generated type; unmask with codegen's `useFragment`. It is *not* a React hook — it is a generated identity function, safe to call conditionally or on `undefined`.
- **Forward pagination only.** `Library.entries` rejects `last`/`before` with `BACKWARD_PAGINATION_UNSUPPORTED`. `first` max 100, default 20.
- **Cost gate:** every shipped operation stays under **70%** of `BREADTH_BUDGET` (100) and `COMPLEXITY_BUDGET` (33,000), enforced by `app/server/graphql/client-operations-cost.test.ts` over the committed `persisted-documents.json`. `Viewer.users` carries a ×50 multiplier; `Library.entries` is priced at its `maxSize` (100) when `first` is a variable, **not** at the default 20.
  **The page-size multiplier applies to complexity ONLY.** `cost-limit.ts`'s `costOfSelectionSet` computes `breadth: 1 + child.breadth` unconditionally — the multiplier never touches it. The calibration table proves it: `entries(first: 100)` and `entries(first: 20)` both measure breadth 41, with complexity 19,103 vs 3,823. So breadth is a pure count of the selection tree; only complexity answers "what does the worst-case page cost". Do not try to re-derive a breadth number from the page size.
- **`Viewer.users` and `Device.enabledUsers` are admin-gated** (`authScopes: { admin: true }`): a non-admin gets `null` **plus** a `FORBIDDEN` error, and Apollo's default `errorPolicy: 'none'` discards the whole `data`. Any hook selecting them needs `skip: !isAdmin`. `Viewer.library`, `Viewer.syncPassword` and `Library.*` are **not** gated — do not add skips by pattern-matching.
- **No storage migration.** A `library-target` value that is not a Library global ID (i.e. a legacy username) is treated as *no selection*. An admin re-picks once after upgrade. Do not write a username→id conversion path.
- **Never mint global IDs client-side.** `btoa('Library:' + userId)` would work and is rejected deliberately — it hard-codes Pothos's encoding into the client. Read ids from the server.
- **Global IDs in URLs must be `encodeURIComponent`'d** — they are base64 and may contain `+`, `/`, `=`. `router/path.ts` already does this; keep it.
- Lint is `npm run lint` from the repo **ROOT** (oxlint/oxfmt/tsc/codegen:check — not ESLint). ERRORS: `typescript/no-explicit-any`, `no-shadow`, `eqeqeq`, `react-hooks/exhaustive-deps`.
- **Do not modify the server.** If a screen has nowhere to go without a server change, surface it and STOP.
- `docs/` is gitignored — never `git add` it.

## Correction to the spec, to be applied in Task 12

Spec §9 says step 5 "Ends with: `useWithTargetUser` deleted". **That is wrong and this plan does not do it.** `useWithTargetUser` has 21 non-test consumers across book detail, book edit, upload, series, download and cover — steps 6–9. It survives this plan, serving the not-yet-migrated hooks. What step 5 actually ends with: `/library` on GraphQL, `useCurrentLibraryId` serving admins, and `library-target` storing a Library global ID.

## File Structure

| File | Responsibility |
|---|---|
| `app/client/src/test-utils.tsx` | gains `renderHookWithApollo` — the probe-component harness, currently hand-rolled in 3+ test files |
| `app/client/src/graphql/library.ts` | `LibraryEntriesDocument`, `LibrarySubjectsDocument`, `SearchSuggestionsDocument`, `BookRowFragment`, `SeriesRowFragment` |
| `app/client/src/provider/library-target/provider.tsx` | stores a Library global ID; legacy values ignored |
| `app/client/src/provider/library-target/hook/use-current-library-id.ts` | admin path added |
| `app/client/src/provider/library/hook/use-library-entries.ts` | the grid's connection read + `fetchMore` |
| `app/client/src/component/book-row/index.tsx` | renders from `BookRowFragment` |
| `app/client/src/component/series-row/index.tsx` | renders from `SeriesRowFragment` |
| `app/client/src/component/library-switcher/index.tsx` | selects by Library global ID |
| `app/client/src/component/search-bar/use-search-suggestions.ts` | `Library.searchSuggestions` |

---

### Task 1: The shared test seam — `renderHookWithApollo` and typed mocks

**Files:**
- Modify: `app/client/src/test-utils.tsx`
- Test: `app/client/src/test-utils.test.tsx`

**Interfaces:**
- Produces: `renderHookWithApollo<T>(useHook: () => T, mocks: MockedResponse[]): { result: { current: T | undefined }, ... }` — a probe-component harness returning the hook's latest value.

Spec §14.6 recorded this seam as missing after it was hand-rolled in three test files; it has since been hand-rolled in roughly a dozen more. Every later task in this plan needs it. Build it first.

The final whole-branch review of steps 3–4 also found that `MockedResponse<T>`'s generics have **zero** adherence despite `test-utils.tsx` instructing their use — every mock in every hook test is a bare object literal, so `tsc` cannot reject a mock shape the server could never return. Wire the generic into the new helper's signature so adoption is the path of least resistance, and fix `test-utils.tsx`'s own comment if it overstates what is enforced today.

- [ ] **Step 1: Read the three hand-rolled harnesses and extract their common shape**

```bash
cd /Users/korzun/.supacode/repos/Bookplate/graphql-migration/app/client/src
grep -rln "function Probe\|const Probe" provider/ component/ | head
sed -n '55,110p' test-utils.tsx
```

- [ ] **Step 2: Write the failing test**

```tsx
it('returns the hook value and re-renders on cache writes', async () => {
  const { result } = renderHookWithApollo(() => useQuery(SomeDocument), [someMock]);
  await waitFor(() => expect(result.current?.loading).toBe(false));
  expect(result.current?.data).toEqual(expected);
});
```

- [ ] **Step 3: Run it and watch it fail**

Run: `npx vitest run src/test-utils.test.tsx --root app/client`
Expected: FAIL — `renderHookWithApollo is not a function`.

- [ ] **Step 4: Implement, then migrate exactly two existing test files onto it**

Two, not all — enough to prove the seam fits real callers without turning this task into a sweep. Pick `use-device-list.test.tsx` and `use-user-list.test.tsx`. Their assertions must not change.

- [ ] **Step 5: Verify and commit**

```bash
npx vitest run src/test-utils.test.tsx src/provider/device src/provider/user --root app/client
cd /Users/korzun/.supacode/repos/Bookplate/graphql-migration && npm run lint
git add app/client/src/test-utils.tsx app/client/src/test-utils.test.tsx app/client/src/provider/device app/client/src/provider/user
git commit -m "test(client): add renderHookWithApollo, the shared hook probe seam"
```

---

### Task 2: Measure the entries document BEFORE building on it

**Files:**
- Create: `app/client/src/graphql/library.ts`
- Modify: `app/client/src/gql/**` (codegen output)

**Interfaces:**
- Produces: `LibraryEntriesDocument`, `BookRowFragment`, `SeriesRowFragment`.

This task ships **no UI**. It exists because `LibraryEntries` is the most expensive document in the entire migration and the cost gate is a hard CI failure, not a warning. Building the grid first and discovering the document is over budget would waste every task after it.

`Library.entries` is priced at `maxSize` (100) when `first` is a variable, and each edge's node fans out into a `Book` **or** a `Series` — and `Series.books` is itself a connection. Selecting `Series.books` inside the entries connection is the shape most likely to blow the budget.

**Do not select `Series.books` inside `LibraryEntries`.** `SeriesRow` needs an author, a book count, and a cover stack. Use `Series.bookCount` and `Series.author` — both scalars on the type — and give the cover stack its own decision in Task 7.

- [ ] **Step 1: Write the documents**

```graphql
fragment BookRowFragment on Book {
  id
  title
  author
  seriesIndex
  hasCover
  thumbnailUrl(width: 88)
  progress { id percentage }
}

fragment SeriesRowFragment on Series {
  id
  name
  author
  bookCount
}

query LibraryEntries($libraryId: ID!, $first: Int!, $after: String, $filter: LibraryFilter) {
  node(id: $libraryId) {
    id
    ... on Library {
      id
      entries(first: $first, after: $after, filter: $filter) {
        edges {
          cursor
          node {
            __typename
            ... on Book { ...BookRowFragment }
            ... on Series { ...SeriesRowFragment }
          }
        }
        pageInfo { hasNextPage endCursor }
      }
    }
  }
}
```

- [ ] **Step 2: Run codegen and the cost gate**

```bash
cd /Users/korzun/.supacode/repos/Bookplate/graphql-migration
npm run codegen -w app/client
npm run test:cost -w app/server
```

Record `LibraryEntries`'s breadth and complexity percentages **verbatim** in your report. If either exceeds 70%, **stop and report the number** rather than trimming fields on your own judgement — which field to drop is a product decision, and `progress` is the likeliest candidate.

- [ ] **Step 3: Verify the cache-key guardrail passes**

```bash
npx vitest run src/provider/apollo/selection-ids.test.ts --root app/client
```

This is what catches a missing `id` on the `Node` interface itself. Expected: PASS. If it fails, the fix is `node(id: $libraryId) { id ... }`, not a change to the guardrail.

- [ ] **Step 4: Commit**

```bash
git add app/client/src/graphql/library.ts app/client/src/gql
git commit -m "feat(client): add the LibraryEntries document and measure its cost"
```

---

### Task 3: `library-target` stores a Library global ID

**Files:**
- Modify: `app/client/src/provider/library-target/provider.tsx`, `context.ts`, `hook/use-library-target.ts`
- Test: `app/client/src/provider/library-target/hook/use-library-target.test.tsx`

**Interfaces:**
- Produces: `useLibraryTarget(): [string | undefined, (libraryId: string | undefined) => void]` — the value is now a **Library global ID**, not a username.

The storage key changes from `library-target-user` to `library-target-id`. A value under the old key is ignored and never read, which is what makes "no migration" true rather than aspirational: leaving the old key readable would mean a username could still reach `useCurrentLibraryId`'s admin path and be sent to the server as a global ID.

`useWithTargetUser` still needs a **username** for the REST hooks it serves (21 consumers, steps 6–9). It currently reads `useLibraryTarget()`. After this task it cannot. Task 4 gives it a username source; until then this task deliberately breaks it.

**This opens a regression window that Task 4 closes.** Record it in the ledger in capital letters — between these two tasks, every REST book hook targets the wrong library for an admin. That is user-visibly broken, not merely half-migrated.

- [ ] **Step 1: Write the failing tests**

```tsx
it('ignores a legacy username under the old key', () => {
  localStorage.setItem('library-target-user', 'alice');
  const { result } = renderHook(() => useLibraryTarget(), { wrapper });
  expect(result.current[0]).toBeUndefined();
});

it('persists a selected Library global ID', () => {
  const { result } = renderHook(() => useLibraryTarget(), { wrapper });
  act(() => result.current[1]('TGlicmFyeTox'));
  expect(localStorage.getItem('library-target-id')).toBe('TGlicmFyeTox');
});
```

- [ ] **Step 2: Run and watch both fail**

Run: `npx vitest run src/provider/library-target --root app/client`

- [ ] **Step 3: Implement — new key, no read of the old one**

- [ ] **Step 4: Seen-to-fail on the legacy guard**

Point the provider back at `library-target-user`. The first test must FAIL. Revert and record the verbatim output. Without this, "no migration" is an untested claim and a stale username silently becomes a global ID sent to the server.

- [ ] **Step 5: Commit**

```bash
npx vitest run src/provider/library-target --root app/client
cd /Users/korzun/.supacode/repos/Bookplate/graphql-migration && npm run lint
git add app/client/src/provider/library-target
git commit -m "feat(client): store the Library global ID in library-target"
```

---

### Task 4: `useCurrentLibraryId` serves admins; `useWithTargetUser` gets its own username source

**Files:**
- Modify: `app/client/src/provider/library-target/hook/use-current-library-id.ts`, `hook/use-with-target-user.ts`
- Test: both matching test files

**Interfaces:**
- Consumes: `useLibraryTarget()` from Task 3.
- Produces: `useCurrentLibraryId(): { libraryId: string | undefined; loading: boolean }` — now non-`undefined` for an admin with a selection.

Two hooks, one task, because Task 3 broke the second and leaving it broken across a review boundary is worse than a slightly wider task.

```ts
// use-current-library-id.ts — the shape, not the whole file
const [targetLibraryId] = useLibraryTarget();
const { data, loading } = useQuery(ViewerBootstrapDocument);
const isAdmin = data?.viewer.isAdmin ?? false;
return {
  libraryId: isAdmin ? targetLibraryId : data?.viewer.library?.id,
  loading,
};
```

An admin with no selection gets `undefined` — screens render "Select a library". That is the designed state, not an error.

`useWithTargetUser` needs the **username** matching the selected library. Resolve it from the same admin user list the switcher uses, matching on `library.id`. Do **not** decode the global ID to recover a user id — that is the client-side encoding coupling the constraints forbid.

That means **this task extends the user-list document** with `library { id }`:

```graphql
query UserList { viewer { users { id username progressCount library { id } } } }
```

Task 5 consumes the same field; it is added here because this task is the first to need it.

- [ ] **Step 0: Extend the user-list document, run codegen, re-measure**

```bash
cd /Users/korzun/.supacode/repos/Bookplate/graphql-migration
npm run codegen -w app/client && npm run test:cost -w app/server
```

`Viewer.users` carries a ×50 multiplier — report `UserList`'s new percentages. It was 8.0% breadth / 0.6% complexity. If adding one nested `id` per user pushes it near the 70% line, stop and report the number.

- [ ] **Step 1: Write the failing tests**

```tsx
it('returns the stored selection for an admin', async () => { /* isAdmin: true, stored id */ });
it('returns viewer.library.id for a non-admin, ignoring any stored selection', async () => { /* … */ });
it('returns undefined for an admin with no selection', async () => { /* … */ });
```

The second test is the one that matters: a non-admin must never be able to read another library by writing to their own localStorage.

- [ ] **Step 2: Run and watch them fail**

- [ ] **Step 3: Implement both hooks**

- [ ] **Step 4: Seen-to-fail on the non-admin branch**

Make the hook return `targetLibraryId` unconditionally. The non-admin test must FAIL. Revert, record verbatim output.

- [ ] **Step 5: Verify the regression window is closed**

```bash
npx vitest run src/provider/library-target src/provider/book --root app/client
```

Book hooks must be green again. Report the count.

- [ ] **Step 6: Commit**

```bash
cd /Users/korzun/.supacode/repos/Bookplate/graphql-migration && npm run lint
git add app/client/src/provider/library-target
git commit -m "feat(client): give useCurrentLibraryId its admin path"
```

---

### Task 5: `LibrarySwitcher` selects by Library global ID

**Files:**
- Modify: `app/client/src/component/library-switcher/index.tsx`
- Test: `app/client/src/component/library-switcher/index.test.tsx`

**Interfaces:**
- Consumes: `useLibraryTarget()` (Task 3), `useUserList()`.

The switcher lists users and must now store the selected user's **library** id. `User.library` is `Library!` — non-null — and Task 4 already added `library { id }` to the `UserList` document, so no document change is needed here.

`useUserList` already carries `skip: !isAdmin`, added in step 4's plan because `Viewer.users` is admin-gated and returns `null` + `FORBIDDEN` for a non-admin. Verify it is still there; do not add a second gate in the component.

- [ ] **Step 1: Write the failing test**

```tsx
it('stores the selected user\'s library id, not their username', async () => {
  /* render, click "alice", assert localStorage 'library-target-id' === alice's library gid */
});
```

- [ ] **Step 2: Run it, implement, re-run**

- [ ] **Step 3: Commit**

```bash
cd /Users/korzun/.supacode/repos/Bookplate/graphql-migration && npm run lint
git add app/client/src/component/library-switcher
git commit -m "feat(client): select a library by global ID in the switcher"
```

---

### Task 6: `useLibraryEntries` — the grid's connection read

**Files:**
- Create: `app/client/src/provider/library/hook/use-library-entries.ts`, `index.ts`
- Test: `app/client/src/provider/library/hook/use-library-entries.test.tsx`

**Interfaces:**
- Consumes: `LibraryEntriesDocument` (Task 2), `useCurrentLibraryId()` (Task 4).
- Produces: `useLibraryEntries(filter): { edges, loading, error, hasNextPage, fetchNextPage }`.

`Library.entries` already has `relayStylePagination(['filter'])` in `cacheConfig` — keyed on `filter`, so changing the filter starts a fresh list rather than appending to the old one. Do not add a second pagination policy.

**`fetchMore` and the error-surfacing policy.** Spec §14.6 flagged that no error-surfacing pattern exists for screens and asked the next plan to decide one. Decide it here and document it in the hook:

> Every migrated screen hook returns `error: string | undefined`, derived from Apollo's `error?.message`. A **first-page** failure with no data is the screen's empty-error state; a **fetchMore** failure keeps the existing rows and surfaces a retry affordance. The existing `LibraryPage` already distinguishes these two (`bookListItems.length === 0` vs `> 0`) — preserve that distinction rather than collapsing both into one error slot.

Skip the query when `libraryId` is `undefined` — an admin with no selection has nothing to query, and `node(id: undefined)` is a wasted round trip.

- [ ] **Step 1: Write the failing tests**

```tsx
it('returns edges for the current library', async () => { /* … */ });
it('appends the next page on fetchNextPage without dropping the first', async () => { /* … */ });
it('keeps existing edges when fetchNextPage fails', async () => { /* … */ });
it('does not query when there is no library id', async () => { /* no mocks at all — MockLink throws if it fires */ });
it('starts a fresh list when the filter changes', async () => { /* … */ });
```

The fourth test's mechanism is load-bearing: with no mock in scope, `MockLink` throws "No more mocked responses" if the query fires, so the test fails loudly rather than vacuously passing.

- [ ] **Step 2: Run all five and watch them fail**

- [ ] **Step 3: Implement**

- [ ] **Step 4: Seen-to-fail on the skip**

Remove `skip`. The fourth test must FAIL with MockLink's "No more mocked responses". Revert, record verbatim output.

- [ ] **Step 5: Commit**

```bash
npx vitest run src/provider/library --root app/client
cd /Users/korzun/.supacode/repos/Bookplate/graphql-migration && npm run lint
git add app/client/src/provider/library
git commit -m "feat(client): read the library entries connection over GraphQL"
```

---

### Task 7: `BookRow` and `SeriesRow` render from fragments

**Files:**
- Modify: `app/client/src/component/book-row/index.tsx`, `app/client/src/component/series-row/index.tsx`
- Test: both matching test files

**Interfaces:**
- Consumes: `BookRowFragment`, `SeriesRowFragment` (Task 2).
- Produces: `<BookRow book={bookFragmentRef} />`, `<SeriesRow series={seriesFragmentRef} />`.

Today both cells take a bare identifier (`bookId`, `seriesName`) and fetch themselves — `BookRow` via `useBook` + `useMyProgress` + `coverUrl()` + `useWithTargetUser`, `SeriesRow` via `useSeriesBookList`. After this task they take a **masked fragment ref** and render. No fetching, no loading branch, no error branch: the parent already has the data.

**Fragment masking is ON**, so the prop's type is an opaque `{ ' $fragmentRefs': … }` marker. Unmask at the top of each component with the generated `useFragment`. It is not a React hook — calling it on a possibly-`undefined` prop is fine.

`BookRow`'s cover comes from `thumbnailUrl(width: 88)`, which the server builds with the correct `?user=` and `v=` suffixes for admins. That replaces `coverUrl(book.id, { width: 88, version: book.mtime })` **and** the `withTargetUser()` wrapper. `useAuthorizedSrc` still applies — the URL is a REST binary endpoint and still needs the auth header.

`SeriesRow`'s `CoverStack` currently takes `seriesName` and fetches the series' books to build its layers. Leave `CoverStack` on its existing data path this task and pass it `seriesName` from the fragment. Reshaping it needs `Series.books`, which Task 2 deliberately kept out of the entries document on cost grounds; that belongs to step 6's series work.

`BookRow` is also used outside the grid (`component/cover-stack`, book detail, upload). Find every call site before changing the prop:

```bash
grep -rn "<BookRow\|<SeriesRow" app/client/src --include=*.tsx | grep -v "\.test\."
```

If a caller cannot supply a fragment ref yet because its own screen is still on REST, **stop and report** rather than inventing a second dual-mode prop shape. A component that accepts either an id or a fragment is exactly the ambiguity this migration is removing.

- [ ] **Step 1: Enumerate call sites (command above) and record them in your report**

- [ ] **Step 2: Write the failing tests**

```tsx
it('renders title, author and progress from the fragment without fetching', () => {
  /* render with NO mocks in scope — a fetch would throw */
});
it('uses the server-supplied thumbnailUrl', () => { /* … */ });
it('renders the placeholder when hasCover is false', () => { /* … */ });
```

The first test's "no mocks in scope" is the property: these cells must not fetch.

- [ ] **Step 3: Run, implement both components, re-run**

- [ ] **Step 4: Commit**

```bash
cd /Users/korzun/.supacode/repos/Bookplate/graphql-migration && npm run lint
git add app/client/src/component/book-row app/client/src/component/series-row
git commit -m "feat(client): render library rows from entry fragments"
```

---

### Task 8: Wire `LibraryPage` to the connection

**Files:**
- Modify: `app/client/src/page/library/index.tsx`
- Test: `app/client/src/page/library/index.test.tsx`

**Interfaces:**
- Consumes: `useLibraryEntries` (Task 6), the reshaped rows (Task 7).

Replace `useBookList` + `useBookListItems` + `useFetchNextPage` with `useLibraryEntries`. `useBookListFilter` stays as-is — it is URL-state, not server-state, and its `BookListFilter` maps onto `LibraryFilter` by renaming `query`→`query`, `status` (`'not-started'|'in-progress'|'completed'` → `NOT_STARTED|IN_PROGRESS|COMPLETED`) and `entryType` (`'series'|'standalone'` → `SERIES|STANDALONE`). Write that mapping as a tested pure function; the enum casing is exactly the kind of thing that silently returns an empty grid.

Preserve all four existing empty/error states verbatim — "No users registered", "Select a library", "Failed to load library", "No books match your search" / "Your library is empty" — including the `isAdmin && targetUsername` wording switch, which now keys on the library id.

The `IntersectionObserver` sentinel stays; only its trigger changes from `nextCursor !== null` to `hasNextPage`.

- [ ] **Step 1: Write the failing tests**

```tsx
it('renders "Select a library" for an admin with no selection', () => { /* … */ });
it('maps the URL filter onto LibraryFilter enum casing', () => { /* … */ });
it('renders rows from the connection', async () => { /* … */ });
it('keeps rows and offers Retry when the next page fails', async () => { /* … */ });
```

- [ ] **Step 2: Run, implement, re-run**

- [ ] **Step 3: Seen-to-fail on the enum mapping**

Return the raw lowercase filter values. The mapping test must FAIL. Revert, record verbatim output.

- [ ] **Step 4: Commit**

```bash
cd /Users/korzun/.supacode/repos/Bookplate/graphql-migration && npm run lint
git add app/client/src/page/library
git commit -m "feat(client): drive the library grid from the entries connection"
```

---

### Task 9: Search suggestions and subjects

**Files:**
- Modify: `app/client/src/component/search-bar/use-search-suggestions.ts`, `app/client/src/provider/book/hook/use-library-subjects.ts`
- Test: both matching test files

**Interfaces:**
- Consumes: `useCurrentLibraryId()`.
- Produces: `SearchSuggestionsDocument`, `LibrarySubjectsDocument`.

`Library.searchSuggestions(query:, filter:)` returns `[SuggestionGroup!]!`, each with a `type` (`AUTHOR|BOOK|SERIES|SUBJECT`) and `items`. `Suggestion.book` is a nullable `Book` — select only what the dropdown renders; do **not** spread `BookRowFragment` into it, which would multiply the document's cost for a dropdown that shows a label.

Suggestions fire per keystroke. Use a `debounce` if one already exists in the codebase; if not, keep the existing component's debounce and do not introduce a new dependency.

- [ ] **Step 1: Write the documents, run codegen, measure**

```bash
npm run codegen -w app/client && npm run test:cost -w app/server
```

Report both documents' percentages.

- [ ] **Step 2: Write the failing tests, run them, implement, re-run**

Tests: suggestions grouped by type; empty query issues no request; subjects list feeds the filter chips.

- [ ] **Step 3: Commit**

```bash
cd /Users/korzun/.supacode/repos/Bookplate/graphql-migration && npm run lint
git add app/client/src/component/search-bar app/client/src/provider/book app/client/src/graphql app/client/src/gql
git commit -m "feat(client): move search suggestions and subjects to GraphQL"
```

---

### Task 10: Verify `useSubscription` on a variable change — the §14.6 open question

**Files:**
- Modify: `app/client/src/provider/book/hook/use-scan-progress.ts` (only if the probe shows it is needed)
- Test: `app/client/src/provider/book/hook/use-scan-progress.test.tsx`

Spec §14.6 records this as **unverified**: whether Apollo v4's `useSubscription` clears `data` when its variables change. If it does not, switching libraries mid-scan leaves the previous library's scan events outranking the newly-selected library's read. It was unreachable until now because admins had no `libraryId`; Task 4 made the library switchable, so it is reachable and this is where it gets settled.

**Probe first, then decide.** Write a test that mounts `useScanProgress` against `MockSubscriptionLink`, emits an event for library A, changes `libraryId` to B, and asserts what `data` holds. Run it and record the actual behaviour verbatim **before** writing any fix. If Apollo already clears, the test stays as a regression guard and no production code changes — say so plainly rather than inventing a fix to look productive.

Steps 0–2 taught this exact lesson: every defect in the foundation was in something asserted about a library's behaviour without running it, and the one component built against a real server needed no correction.

- [ ] **Step 1: Write the probe test and run it. Record the observed behaviour verbatim.**
- [ ] **Step 2: Decide and report** — guard-only, or guard + fix. State which and why.
- [ ] **Step 3: Commit**

```bash
cd /Users/korzun/.supacode/repos/Bookplate/graphql-migration && npm run lint
git add app/client/src/provider/book
git commit -m "test(client): pin useSubscription's behaviour across a library change"
```

---

### Task 11: Retire the grid's REST hooks

> **CORRECTED 2026-08-06, after Task 8's round-2 re-review.** This task originally said to
> delete four hooks. **Three of them are still live**, and deleting them would break routed
> pages. Only `use-fetch-next-page.ts` is genuinely dead. The corrected scope is below; the
> reachability evidence is in the note that follows it.

**Files:**
- Delete: `provider/book/hook/use-fetch-next-page.ts` and its test — **this one only**
- Modify: `provider/book/hook/index.ts`, `provider/book/index.ts`, `provider/book/context.ts`, `provider/book/provider.tsx` — remove `nextCursor` and any other Context state whose last reader left with the grid

**What is NOT deleted, and why.** A sweep in Task 8 classified `use-fetch-book-list.ts` as dead;
its re-review proved otherwise by tracing the *wrapper* hooks that call it. `useFetchBookList` is
reached from four live paths:

- `useScanLibrary` → `component/scan-library-setting` → `page/user` (refresh after a scan)
- `useBookList` → `useSeriesBookList` → **`page/series`** (a routed page whose entire book list
  comes from this chain) and `component/cover-stack`
- `useUploadQueueEngine` → `UploadProvider`, mounted **globally** in `App.tsx` (refresh after upload)

The original sweep grepped `page/`, `component/` and `control/` for direct imports of
`useFetchBookList`/`useBookList` and found none — because those directories import the wrappers,
not the hooks themselves. **Grep for the wrappers too, or you will repeat the error.**

`useBookListItems` has **zero readers** anywhere, but its writers are live, so removing the reader-
less `bookListItems` state means editing those writers rather than deleting them. Decide whether
that is worth doing here or belongs with the series migration, and say which.

- [ ] **Step 1: Prove reachability yourself before deleting anything**

```bash
cd /Users/korzun/.supacode/repos/Bookplate/graphql-migration/app/client/src
# the hooks themselves AND the wrappers that call them
grep -rn "useBookList\b\|useBookListItems\|useFetchBookList\|useFetchNextPage" .
grep -rn "useScanLibrary\|useSeriesBookList\|useUploadQueueEngine" .
```

**Include test files in this grep.** The step-3–4 plan's equivalent check excluded them with
`grep -v "\.test\."` and missed a test-only `<DeviceProvider>` wrapper, which broke at runtime
while `tsc` stayed green. **And follow every wrapper one level out** — a hook with no direct
importers in `page/` can still be reached through one that has them. That is the exact mistake
this correction exists to prevent.

- [ ] **Step 2: Delete, fix the barrels, prune the Context fields**

- [ ] **Step 3: Prove the REST surface shrank**

```bash
grep -rln "apiFetch" app/client/src | grep -v "\.test\." | wc -l
```

It was **31** files before this plan. Report the new number and the delta. Do not go hunting for extra call sites to make an arithmetic target come out even.

- [ ] **Step 4: Full verification and commit**

```bash
npm test -w app/client && npm test -w app/server && npm run test:cost -w app/server && npm run lint
git add -A app/client/src
git commit -m "refactor(client): retire the REST book-list hooks"
```

---

### Task 12: Re-run every seen-to-fail at the branch tip, and update the spec

**Files:**
- Modify: `docs/superpowers/specs/2026-08-03-apollo-client-migration-design.md` (gitignored — edit, never `git add`)

The final review of steps 3–4 re-ran all six of that plan's seen-to-fail demonstrations at the branch tip and found all six still discriminating. That check exists because a seen-to-fail recorded mid-plan can be invalidated by a later fix subsuming its effect — which happened in that plan. Do it here as a task rather than hoping the final reviewer does it.

- [ ] **Step 1: Re-run each seen-to-fail from Tasks 3, 4, 6 and 8 against the current tip**

For each: break the mechanism, confirm the named test reddens, revert, confirm green. Record verbatim output per demonstration. Use a throwaway worktree so the main checkout is never left dirty.

- [ ] **Step 2: Update the spec**

- §9's table: mark step 5 complete; **correct its "Ends with" for step 5** — `useWithTargetUser` is NOT deleted here (21 consumers remain across steps 6–9).
- §14.6: strike the two items this plan closed (the missing `renderHookWithApollo` seam; `useCurrentLibraryId` self-path only) and record Task 10's finding on the `useSubscription` question.
- §14.6: record the error-surfacing policy decided in Task 6.
- §14.7's "Pre-existing flake" note on `component/device-form/index.test.tsx` is **stale** — that flake was root-caused and fixed. Remove it.
- Add a known-behaviour-changes note: `progressCount` on `/users` is cache-first and no longer refetches on mount, so an external e-reader sync leaves it frozen for the session.

- [ ] **Step 3: Confirm nothing under `docs/` is staged**

```bash
git status --porcelain | grep docs/ ; echo "EXIT: $?"
```

Expected: no output, exit 1.

---

## Definition of done

- `/library` reads its grid, rows, suggestions and subjects entirely over GraphQL.
- `useCurrentLibraryId()` returns a Library global ID for an admin with a selection, `viewer.library.id` for everyone else, `undefined` for an admin with none.
- `library-target` stores a Library global ID; a legacy username is ignored, with a test proving it.
- `BookRow` and `SeriesRow` fetch nothing — proven by tests that render them with no mocks in scope.
- Every new document under 70% of both budgets. Report `LibraryEntries`'s measured percentages explicitly — it is the one at risk.
- `npm test -w app/client` and `npm test -w app/server` green (counts will move; report them). Run the client suite **at least 3 times** — this branch has produced two load-dependent flakes.
- `npm run lint` clean from the repo ROOT.
- Every seen-to-fail re-verified at the branch tip (Task 12).

## What this plan does NOT do

Steps 6–10: book detail, series, book edit, progress screens, upload, and the final sweep. `useWithTargetUser`, `BookProvider`, `ProgressProvider` and `lib/cover-url.ts` all survive. `CoverStack` keeps its existing data path.

---

## Tasks added mid-plan (2026-08-06), by user decision

Task 7 surfaced two things the plan could not have known. Both were escalated and both were
answered with a **server change**, which this plan otherwise forbids. These two tasks are that
authorisation, written down. They are numbered 13 and 14 but **Task 13 runs BEFORE Task 8** —
Task 8 wires the grid, and without 13 every book click on the migrated grid 404s.

### Task 13: `/api/books/:id` accepts a Relay global ID

**Files:**
- Modify: `app/server/routes/ui.ts` (the `/api/books/:id` handler and any sibling route sharing its id resolution)
- Test: the matching server test file

**Why this exists.** GraphQL's `Book.id` is a Relay global ID encoding `[userId, bookId]`, and spec
1's book-relay-id pass deliberately removed the raw `bookId` field — the global ID is now the only
book identifier in the schema. But `page/book` is still REST and feeds its URL param straight to
`/api/books/:id`, which does no decoding. So a GraphQL-fed grid has nothing to navigate with.

**The decision:** teach the REST route to accept **both** forms. The client never decodes a global
ID — that coupling is exactly what the book-relay-id pass removed — so the decode happens
server-side, where the encoding already lives.

**This route is on spec 3's deletion list.** This change dies with it. Say so in a comment so
nobody mistakes it for a permanent dual-identifier design.

- [ ] **Step 1: Read the route end to end**, including how it resolves the owner and what it does
  with `?user=`. Find every sibling route that takes a book id the same way (`/lineage`,
  `/pending-fixes`, cover, download) and decide — with reasons in your report — whether they need
  the same treatment now or whether only `/api/books/:id` is reachable from the migrated grid.

- [ ] **Step 2: Write the failing tests first.** At minimum: a raw id still resolves; a global ID
  resolves to the same book; a global ID belonging to **another user** is refused exactly as a
  cross-tenant raw id is today; a malformed base64 string is refused without throwing.

- [ ] **Step 3: Implement.** Reuse the server's existing `parseCompoundId`/global-ID helpers — do
  not hand-roll base64 parsing.

- [ ] **Step 4: Seen-to-fail on the cross-tenant test.** Make the decode ignore the owner half. That
  test must go red. This is the assertion that matters: a decode that skips authorization turns a
  tenant boundary into a lookup.

- [ ] **Step 5: Verify and commit**

```bash
npm test -w app/server && npm run lint
git add app/server
git commit -m "feat(server): accept a Relay global ID on the legacy book REST route"
```

### Task 14: `Series` gains an aggregate progress field, and `SeriesRow` gets its badge back

**Files:**
- Modify: `app/server/graphql/schema/series/model.ts`, `app/client/src/graphql/library.ts`,
  `app/client/src/component/series-row/index.tsx`
- Test: the matching server and client test files

**Why this exists.** `SeriesRow` showed an aggregate progress percentage that Task 7 dropped,
because no such field exists on either transport — `useMySeriesProgress` computed it **client-side**
from the user's full progress list plus the series' book list, which a fetch-free row cannot do.

**Two risks, both of which must be measured rather than assumed:**

1. **Cost.** `SeriesRowFragment` sits inside `LibraryEntries`, which is priced at `maxSize` 100.
   `LibraryEntries` currently measures **35.0% breadth / 8.5% complexity**. Adding a field that
   aggregates over a series' books could move complexity sharply. **Measure before building the
   client half** — same discipline as Task 2. If it breaches 70%, stop and report the number.
2. **N+1.** Computing progress per series across a 100-row page must not issue a query per series.
   Check how `Series.bookCount` and `Library.entries` already avoid this and follow that pattern.
   If you cannot avoid N+1 within this task, stop and report — a correct field that melts the
   server on a large library is not a win.

- [ ] **Step 1: Server field first, with its own tests.** Match `useMySeriesProgress`'s existing
  semantics exactly — read that hook before choosing them, and state in your report what
  "series progress" means (mean over books? weighted by pages? completed-count ratio?) and why it
  matches what users see today.

- [ ] **Step 2: Measure.** `npm run test:cost -w app/server` after adding the field to
  `SeriesRowFragment`. Report `LibraryEntries`'s new breadth and complexity verbatim.

- [ ] **Step 3: Client half.** Fragment carries the field; `SeriesRow` renders the badge with the
  same formatting as the REST version (`< 1` → percentage, else "Completed").

- [ ] **Step 4: Seen-to-fail** on the badge test and on the server field's own aggregation test.

- [ ] **Step 5: Verify and commit**

```bash
npm test -w app/server && npm test -w app/client && npm run test:cost -w app/server && npm run lint
```

**Update the spec's known-behaviour-changes note** — Task 7 recorded the badge as dropped; this
task restores it, so that note must not be left standing.
