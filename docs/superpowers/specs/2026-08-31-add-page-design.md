# The "Add" page — design

**Branch:** `book-request` · **Date:** 2026-08-31 · **Path:** architectural
(brainstorming skill)

**Status: complete and approved.** All sections were presented and approved.
Nothing has been implemented.

## Supersedes

This document **reverses three decisions recorded as settled** in
`2026-08-28-book-requests-design.md`. That document is not edited — its
reasoning trail stays intact — but where the two disagree, this one wins:

| Settled in the 2026-08-28 design | Superseded by this design |
| --- | --- |
| "readers get a card on `/user`" | Requesting moves to `/add/request`. The `/user` card is deleted. |
| "admin sees requests grouped per user inside the existing `/users` page" | The admin resolves requests on `/add/request`, scoped to the switcher's library. `/users` keeps only the per-row count badge. |
| "No new route, no new nav entry" | `/upload` is renamed `/add` and gains a nested `/add/request`. The nav entry is renamed, not added. |

Everything else in that design — the data model, the service, the whole
GraphQL surface, the upload-queue plumbing, `bookRequestCreate` /
`Fulfill` / `Decline` / `Delete` — is unchanged and still authoritative.
**This is a client-side reorganization. No server change of any kind.**

---

## 1. The change

`/upload` becomes `/add`, a page with two ways to put a book into a library:
**Upload** one you have, or **Request** one you don't. A segmented control
switches between them; everything the two share — the admin's library picker,
the toggle itself — lives in a layout route above them.

### Settled decisions

Each was an explicit answer, not an inference:

| Question | Decision |
| --- | --- |
| Route rename | `/upload` → `/add`. **No redirect** from the old path; a stale bookmark hits the existing `*` catch-all and lands on `/library`. |
| Nav icon | **Unchanged.** The upload glyph still reads as "put something into the library", which covers both halves. |
| Nav label | "Upload" → "Add". |
| Toggle mechanism | **Nested routes**, not a query param or component state. `/add` is a layout route rendering the shared chrome and an `<Outlet />`. |
| Default view | `/add` **index route** is Upload. No `/add/upload` path, no redirect hop. |
| Admin "Request" view | The **selected library's** requests, with the existing Upload / Link / Decline row actions. |
| Admin library gate | Moves from the upload page into the layout, so "pick a library first" covers both sub-routes. |
| Per-user list on `/users` | **Removed.** The per-row `pendingBookRequestCount` badge stays, and becomes the entry point. |
| Reader card on `/user` | **Removed entirely.** |
| Request counts for the admin | Shown **per user in the library switcher**, using data the switcher already has. |
| Nav badge number | **Unchanged** — it keeps meaning "fixes awaiting a decision". Nothing is folded into it. |
| Nav dot | Also set when **any** reader has a pending request, admin only. |

### Why the badge number is left alone

The first draft of this design folded pending requests into the nav badge's
number. That was rejected on review, correctly: the number already means one
specific thing — books with fixes awaiting a decision — and a reader of the UI
cannot tell a conflated number's two populations apart. The count belongs where
the admin is already choosing whose library to work on, which is the switcher.

---

## 2. Codebase findings

Verified against `69359364`.

- **`/upload` is not admin-gated.** Only the "Users" nav item is wrapped in
  `isAdmin` (`component/nav/index.tsx`). Readers reach the upload page and
  upload into their own library; `withTargetUser` appends `?user=` only for
  admins.
- **The admin already picks a library on this page.** `page/upload/index.tsx`
  returns a bare `<LibrarySwitcher />` when `isAdmin && !targetLibraryId`. That
  gate is what makes the admin's request view possible here at all.
- **A layout-route precedent exists.** `router/nav-layout.tsx` is a layout route
  rendering `<Outlet />`, and its doc comment gives the reason this design
  reuses the shape: keeping shared chrome mounted across navigations rather than
  remounting it.
- **`LibrarySwitcher` already has the request counts.** It queries
  `UserListDocument` and unmasks `UserRowFragment`
  (`component/library-switcher/index.tsx`), and that fragment already carries
  `pendingBookRequestCount`. Showing per-user counts needs **no new query and no
  new field**.
- **`SelectOption` is `string | { label, value, description? }`**
  (`control/select/index.tsx`), so a count has a home that does not mangle the
  label.
- **`UserListDocument` is already in flight app-wide for admins.**
  `useWithTargetUser` (`provider/library-target/hook/use-with-target-user.ts`)
  queries it, and the upload provider that calls it is mounted above the router.
  A nav-level read hits the same normalized result.
- **`useWithTargetUser` already resolves library id → username**, by matching
  `ref.library.id === targetLibraryId` against that same user list. The user's
  global id is available at the same index.
- **`UserRequestList` takes `{ userId, skip }`** and roots at
  `Query.user(id:) { bookRequests }`, which is admin-only. It derives the row
  actions' `target` from its own document's `user.library.id` / `username`.
- **`BookRequestsContent` takes `{ skip }`** and roots at
  `viewer { user { bookRequests } }`.
- **`SegmentedControl`** (`control/segmented-control/index.tsx`) is
  `{ value, options: {value,label}[], onChange }`. Its only current consumer is
  `component/theme-setting`.
- The nav's `active` test for this item is `pathname === path.upload()`.

---

## 3. Routes and layout

`router/path-internal.ts` gains:

```ts
/** The child route's own segment. Exported so `router/component.tsx` can
 *  declare the nested route with it and the two cannot drift apart. */
export const ADD_REQUEST_SEGMENT = 'request';
export const add = () => '/add';
export const addRequest = () => `${add()}/${ADD_REQUEST_SEGMENT}`;
```

and `upload()` is deleted from both `path-internal.ts` and `path.ts`.
`router/component.tsx` replaces its single `UploadPage` entry with:

```tsx
<Route path={path.add()} element={<AddPage />}>
  <Route index element={<AddUploadView />} />
  <Route path={pathInternal.ADD_REQUEST_SEGMENT} element={<AddRequestView />} />
</Route>
```

The child path is a literal segment, not a route parameter, so it does **not**
belong in `path-key-internal.ts` — that file holds only parameter keys
(`':id'`, `':name'`). Exporting the segment from `path-internal.ts` beside the
builder that uses it is what keeps the router and `path.addRequest()` in sync.

**`AddPage` is the layout.** It renders, in order:

1. The admin library gate — when `isAdmin && !targetLibraryId`, a page
   containing only `<LibrarySwitcher />`, exactly as `page/upload` does today,
   and **no toggle and no `<Outlet />`**. There is nothing to toggle between
   until a library is chosen.
2. Otherwise: `<LibrarySwitcher />` for admins, the `SegmentedControl`, and
   `<Outlet />`.

**The toggle is navigation, not mirrored state.** Its `value` derives from the
pathname — `request` when the path is `path.addRequest()`, else `upload` — and
`onChange` calls `navigate()`. There is no local state to fall out of sync with
the URL, and the back button works.

**Files.** `page/add/index.tsx` (the layout), `page/add/upload.tsx`,
`page/add/request.tsx`. They change together, so they live together;
`page/index.ts` exports all three under the names `router/component.tsx`
imports. `page/upload/` is deleted, its body moving to `page/add/upload.tsx`.

**The nav item** becomes `{ to: path.add(), label: 'Add', icon: UploadIcon }`
with `active: pathname.startsWith(path.add())`. The `===` test must change or
the tab goes dark on `/add/request`; the Library item already uses `startsWith`
for the same reason.

---

## 4. The two views

### Upload — `page/add/upload.tsx`

The current `page/upload/index.tsx` body, minus the admin library gate (now in
the layout) and minus the `<LibrarySwitcher />` render (likewise). Everything
else — `UploadZone`, the queue list, the header actions, the auto-fix
announcement effect and its `announcedRef` — moves across unchanged.

### Request — `page/add/request.tsx`

Branches on `isAdmin`, and each branch mounts a component that already exists:

- **Reader:** `<BookRequestsContent skip={false} />` — the create form and their
  own list. No `Card` wrapper: the toggle is the gate now, so the lazy-mount
  reasoning that governed the `/user` card no longer applies. `skip` stays a
  required prop of that component and is passed `false` here, for the reason its
  own doc comment gives — its tests gate the query directly rather than
  depending on a parent's mount timing.
- **Admin:** `<UserRequestList userId={targetUserId} skip={false} />`, with the
  full Upload / Link / Decline row actions it already renders.

**Getting `targetUserId`.** `UserRequestList` needs a **User** global id; the
switcher holds a **Library** global id. `useWithTargetUser` already resolves
that exact pairing — it finds the user whose `library.id` matches the target and
reads their `username`. It gains one more exposed value, `userId`, read off the
same matched row:

```ts
withTargetUser.ready = ready;
withTargetUser.username = targetUsername;
withTargetUser.userId = targetUserId; // new
```

No new query, no new field, and the value is `undefined` in exactly the cases
`username` already is. A sibling `useTargetUser()` hook was considered and
rejected: it would duplicate the same `UserListDocument` lookup and the same
match, for one field.

---

## 5. Admin surfaces

### The library switcher shows the counts

`LibrarySwitcher`'s `userList` already unmasks `UserRowFragment`; it carries
`pendingBookRequestCount` through alongside `username` and `library.id`, and
builds options as:

```ts
{
  label: user.username,
  value: user.library.id,
  description: user.pendingBookRequestCount > 0
    ? `${user.pendingBookRequestCount} request${user.pendingBookRequestCount === 1 ? '' : 's'}`
    : undefined,
}
```

`description` rather than an appended label, so the option's name stays the
username and the count reads as secondary. Users with no pending requests get no
description at all, so the switcher looks exactly as it does today for a library
with nothing waiting.

### `/users` keeps the badge, loses the list

`component/user-row-content` no longer mounts `UserRequestList`; those cards go
back to progress only, and the heading and divider added for the request list go
with it. `component/user-row` keeps its `pendingBookRequestCount` badge, and the
badge becomes the entry point: activating it sets the library target to that
user's library and navigates to `path.addRequest()`.

This split is deliberate. `/add` is scoped to one library and structurally
cannot answer "who is waiting?"; `/users` can, and is already the cross-user
view. So `/users` is where you *see*, and `/add/request` is the single place you
*act*.

### The nav dot

The badge's **number is untouched** — it still counts books with fixes awaiting
a decision, and no request ever contributes to it.

The `'dot'` value gains a second trigger: for an **admin**, when any reader has a
pending request. `component/nav` reads `UserListDocument` with `skip: !isAdmin`
and sums `pendingBookRequestCount` across users; because `useWithTargetUser`
already has that query in flight app-wide for admins, Apollo serves it from the
same normalized result rather than issuing a second request.

Scoping to *any* reader rather than to the selected library is the point: the
switcher's counts are only visible once you are already on `/add`, so a
selected-library dot would leave an admin sitting on `/library` with no signal
that someone else is waiting.

A reader's own pending request sets nothing. It is a wait, not an action.

**The known cost, accepted:** the dot already means "an upload is in flight", so
it will carry two meanings for admins. Both reduce to "something is happening on
this page", and the number — the part that was actually ambiguous — stays
precise. This is the most droppable piece of the design; nothing else depends
on it.

---

## 6. What is deleted

- `page/upload/` — body moves to `page/add/upload.tsx`.
- `path.upload()` and its `pathKey` usage.
- `component/book-requests/` — the `Card` wrapper for the reader's `/user`
  surface. `BookRequestsContent` survives and is remounted.
- `MyBookRequestCountDocument` in `graphql/book-request.ts` — its only consumer
  was that card's subtitle.
- `<BookRequests />` from `page/user/index.tsx` and from `component/index.ts`.
- `<UserRequestList />` from `component/user-row-content` (the component itself
  survives, remounted on `/add/request`).

### Every remaining `path.upload()` call site

Deleting the builder breaks these, and each needs a deliberate answer rather
than a blind rename:

| Call site | Change |
| --- | --- |
| `component/nav/index.tsx:68,71` | `to: path.add()`, and `active` becomes `startsWith`. |
| `page/book-edit/index.tsx:246` | `navigate(path.add())` — the "review fixes" jump. Fix review lives on the upload view, which is the index route, so `path.add()` is the correct target. |
| `component/book-request-row/index.tsx:310` | `<Link to={path.add()}>`. **The copy stays "review in Upload"** — the toggle option is still labelled *Upload*, so the sentence now names the view rather than the route, and reads correctly either way. |
| `component/nav/index.test.tsx`, `nav-desktop/index.test.tsx`, `nav-mobile/index.test.tsx` | Assert `/add` and the "Add" label. Update, do not delete. |

---

## 7. Testing and rollout

**Routing.** `/add` renders the upload view; `/add/request` renders the request
view; the toggle navigates between them and the nav tab stays active on both. An
admin with no library selected sees the switcher and **no toggle** on either
path.

**Views.** The reader's request view renders the create form and their list; the
admin's renders the selected library's requests with the resolve actions. The
admin branch is driven by the switcher — changing the library changes whose
requests appear, which is the one genuinely new behaviour in this design and the
test most worth having.

**Switcher.** Options show a count only for users with pending requests, and the
label stays the bare username.

**Nav.** The badge number ignores requests entirely — a library with pending
requests and no pending fixes must show no number. The dot appears for an admin
when any reader is waiting, and never for a reader.

**`/users`.** The cards no longer render a request list; the row badge still
renders and navigates to `/add/request` with the target library selected.

**Existing suites that must be updated, not deleted:** every test asserting
`/upload`, `path.upload()`, or the "Upload" nav label, plus
`component/user-row-content` and `page/user` tests that assert the removed
mounts.

**Cost.** `client-operations-cost.test.ts` prices the client's shipped
operations from `persisted-documents.json`. Removing `MyBookRequestCountDocument`
drops an operation; no document's own shape changes, since every query moves
intact. Report measured before/after rather than adjusting any budget.

**Rollout.** Client-only, no migration, no server change, no config. The one
user-visible break is the `/upload` URL, which now falls through the `*`
catch-all to `/library` — accepted deliberately rather than adding a redirect.

**Verification.**

```
npm run lint
npm test
npm run test:cost -w app/server
```

---

## 8. Where this goes next

The writing-plans skill, to turn this into an implementation plan. The work is
one coherent slice — a route rename, a layout route with two children, three
component moves and two deletions — and does not warrant decomposition into
sub-projects.
