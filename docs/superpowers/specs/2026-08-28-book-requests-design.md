# Book requests — design

**Branch:** `book-request` · **Started:** 2026-08-28 · **Completed:** 2026-08-29
· **Path:** architectural (brainstorming skill)

**Status: complete and approved.** All three sections were presented and
approved. Nothing has been implemented; no feature code exists on this branch.
The next step is the writing-plans skill.

**Blocked on a prerequisite, for implementation only.** The user wants the
Pothos Prisma/Relay conversion done *before* this feature is built. See
`2026-08-28-pothos-prisma-relay-conversion-prompt.md` and the audit it produced,
`2026-08-29-pothos-prisma-relay-audit.md`. That work is partly landed on main —
the Phase 1 audit, `Library.progress` → `t.prismaConnection`, the loader
consolidation under `graphql/loaders/`, and the `Book.lineage` batching. Design
was not blocked and is now finished; **confirm the prerequisite is far enough
along before the plan is executed.**

---

## 1. The feature

A reader asks the library admin for a book that isn't in Bookplate. The admin
sees the request, finds the EPUB themselves, uploads it into that reader's
library, and the request closes.

### Settled decisions

Each of these was an explicit answer, not an inference:

| Question | Decision |
| --- | --- |
| What is being requested | A **free-text wish** — a book that exists nowhere in Bookplate. Not a copy of a book from another user's library. |
| Lifecycle | **pending → fulfilled / declined.** Resolved requests stay visible until deleted. Declining carries an optional reason. |
| Fulfillment | **Upload from the request, auto-fulfill** — the request stores a link to the resulting book, and the reader's list shows it landed. |
| Fulfillment plumbing | **Approach B: per-item request binding in the upload queue**, with inline upload from the request row. Approach A (deep-link to `/upload` in "fulfilling" mode) was recommended and explicitly rejected. |
| Fulfillment recovery | **A manual "link an existing book" affordance** on the request row, calling the same mutation. It is both the recovery path when auto-fulfill fails and the route for an admin who uploaded the book before opening the request. |
| Surfaces | Admin sees requests **grouped per user inside the existing `/users` page**; readers get a card on `/user`. No new route, no new nav entry. |
| Request fields | **Title and author both required**, note optional. |
| Guardrails | All three: **cap on open requests per reader**, **reject duplicates**, **reader can cancel/delete**. |
| Pagination shape | **`t.prismaConnection` over a hand-written keyset**, mirroring `Library.progress`. See §3. |
| The cap's home | **A module constant**, not a config option. |

---

## 2. Codebase findings

Verified against `6aa730b0`, after fast-forwarding this branch onto main. The
branch carried no unique commits; the 12 it gained include several slices of the
Pothos conversion, which changed two of the findings below. Node modules were
installed, so the Pothos API claims are read off the shipped typings rather than
recalled.

### Server

- **Stores are gone.** `services/*.ts` are flat modules of plain exported
  functions taking `prisma` as the first argument (`createDevice(prisma, input)`),
  imported directly by resolvers. `Context` has no `stores` bag — named fields
  only, for genuine singletons (`scanJobs`, `thumbnails`, `replaceStaging`,
  `editionsRoot`). See `app/server/services/README.md`.
- **Reads live in Pothos, writes live in services.** Only three direct Prisma
  writes remain anywhere under `graphql/schema/`.
- **Domain errors** are classes thrown by the service function and converted by
  `to-result.ts` (`KNOWN_DOMAIN_ERROR_CLASSES`, `toResult`, `isKnownDomainError`).
  Commit `5c426328` deliberately moved the P2002/P2025 conversions *out of
  resolvers* and into the service. Resolver bodies contain no `try`, no `catch`,
  no `throw`.
- **Policy failures the function decides itself** return a value instead of
  throwing, and are then *not* wrapped in `toResult` — `createUser` returns
  `false` on its P2002 race, `updateDevice` returns `null` on P2025, both with
  doc comments explaining why.
- `graphql/schema/node-scope.ts` exports `isOwnerOrAdmin`, `NO_MATCH_USER_ID`,
  `parseCompoundId`, and `ownerScopedFindUnique` — the node-guard vocabulary
  every node type uses.
- `graphql/schema/pagination.ts` exports `rejectOversizePage`,
  `rejectOversizeIdBatch`, and `CONNECTION_LIMITS`, whose ruling is **reject,
  never clamp**.
- The config-based admin has **`userId: null`** — no row in `users`. It cannot
  own library rows and cannot be a requester.
- `POST /api/books/upload` and `resolveOwner`'s `?user=<username>` targeting
  survive the REST removal as a sanctioned seam (XHR is the only source of
  upload progress).

#### Changed by the Pothos work now on main

- **`t.prismaConnection` has a live precedent.** `Library.progress` is one
  (`schema/library/model.ts`). It carries a measured hazard and its fix, both of
  which this design inherits: the plugin paginates by **seeking to a row**
  (`prismaCursorConnectionQuery`: `cursor` + `skip: 1`), so when the row a cursor
  names has been deleted the page comes back **empty, with `hasNextPage: false`
  and no error**. A client that deletes the row it last paged from silently stops
  paginating. `Library.progress` drops the plugin's `cursor`/`skip`, keeps its
  `take`, and rebuilds the original keyset predicate from the parsed cursor
  (`progressKeyset`), backed by a `@@unique` that carries every sort column.
- **`t.relationCount` takes a `where`.** Confirmed on the shipped typings:
  `RelationCountOptions` (`@pothos/plugin-prisma/dts/types.d.ts:159`) declares
  `where?: Where | ((args, context) => Where)`. `User.progressCount` is the
  unfiltered example; it compiles to a `_count` select merged into whichever
  query already fetched the row.
- **`Viewer.user` exists** (`schema/viewer/model.ts:35`), a `t.prismaField`
  returning the viewer's own `User` node, null exactly when `v.userId === null`
  — the config admin.

### Client

- The upload queue is a **single session-wide provider** (`provider/upload`),
  mounted above the router so it survives navigation.
- `use-upload-transport.ts` targets uploads via
  `withTargetUserRef.current('/api/books/upload')`, derived from the admin's
  **global** library-switcher selection (`useWithTargetUser`), not per item.
  `addFiles` takes `(files: FileList)` and nothing else.
- `use-upload-queue.ts` merges transport items with `LibraryPendingFixesDocument`,
  rooted on `useCurrentLibraryId()` — also global. So is its `onUploaded`
  `Library.entries` cache eviction, which takes no arguments and reads the
  ambient `libraryId`.
- `TransportItem` already stores `proposals` and `autoFixes` from the XHR
  response, and stores `bookGlobalId` — never a raw book id. That constraint
  ("no raw book id may appear anywhere under `provider/upload/`") is documented
  on the type and must hold for anything this feature adds there.
- `page/upload` has the `announcedRef` once-per-item guard pattern.
- `user-row-content` lazily mounts per-user content only when the card is
  expanded, and owns its own `Query.user(id:)`-rooted document
  (`UserProgressListDocument`). Its doc comment explains why hoisting such a
  document to the route would be a cost regression under `Viewer.users`' ×50
  multiplier.
- `component/my-progress-content` is the same pattern for the reader's own data
  on `/user`, mounted only while its `Card` is expanded.
- `/user` already branches on `isAdmin`, rendering `ConnectionUrls`,
  `SyncPassword` and the rest only for non-admins.
- The nav supports a count badge (`NavItem.badge`), unused by this design since
  there is no new nav entry.

---

## 3. Section 1 — data model and server API

### Prisma model

New migration directory `prisma/migrations/<ts>_add_book_requests/migration.sql`,
hand-written SQL applied by the existing `db/migrate.ts`, matching the dated
directories already there.

```prisma
model BookRequest {
  userId        String  @map("user_id")
  id            String                          // randomUUID(), minted in the service
  title         String
  author        String
  note          String  @default("")
  status        String  @default("pending")     // pending | fulfilled | declined
  declineReason String  @default("") @map("decline_reason")
  dedupeKey     String  @map("dedupe_key")      // lowercased, whitespace-collapsed "title\0author"
  createdAt     Float   @default(dbgenerated("strftime('%s','now') * 1000")) @map("created_at")
  resolvedAt    Float?  @map("resolved_at")
  bookUserId    String? @map("book_user_id")
  bookId        String? @map("book_id")

  user User  @relation(fields: [userId], references: [id], onDelete: Cascade)
  book Book? @relation(fields: [bookUserId, bookId], references: [userId, id], onDelete: SetNull, onUpdate: Cascade)

  @@id([userId, id])
  @@unique([userId, createdAt, id])
  @@index([userId, status])
  @@index([userId, dedupeKey])
  @@map("book_requests")
}
```

`User` gains `bookRequests BookRequest[]`; `Book` gains
`bookRequests BookRequest[]`.

Five choices worth their reasons:

- **`@@id([userId, id])`, not a plain `id String @id`** — the house pattern for
  every tenant-owned row (`Book`, `PendingFix`, `Progress`). It is not cosmetic:
  it is what makes the node guard possible. See "`BookRequest` is a `prismaNode`"
  below.
- **`onUpdate: Cascade` on the book FK**, matching `PendingFix`. A book id is a
  content hash and rotates whenever the EPUB is rewritten (accepting a metadata
  fix does exactly this), so a fulfilled request would otherwise point at a dead
  id.
- **`onDelete: SetNull`** — a fulfilled request whose book is later deleted stays
  fulfilled but loses its link. The reader's card renders "added to your library"
  without a link rather than as an error.
- **`@@unique([userId, createdAt, id])` exists for the cursor and nothing else.**
  It is what lets the connection's keyset compare values carried *in* the cursor
  instead of seeking to a row — the `@@unique([userId, timestamp, document])` on
  `Progress` is the same device for the same reason, and should be commented the
  same way in `schema.prisma`.
- **`id` is in that unique as the tiebreaker, and it is required, not cosmetic.**
  `createdAt` defaults to `strftime('%s','now') * 1000` — whole seconds scaled —
  so two requests created in the same second share a timestamp, and cursor
  pagination needs a total order or a page boundary can repeat or skip a row.

Status is stored lowercase and exposed as an uppercase `BookRequestStatus` enum,
following `CoverFit`.

### Service — `services/book-request.ts`

Singular-domain naming, alongside `device.ts`, `user.ts`, `progress.ts`,
`pending-fix.ts`. Exports:

- `createBookRequest(prisma, input)`
- `fulfillBookRequest(prisma, input)`
- `declineBookRequest(prisma, input)`
- `deleteBookRequest(prisma, input)`
- `MAX_OPEN_BOOK_REQUESTS` — **10, a module constant.** Not an add-on config
  option: that would cost `config.yaml`, the README, and the options table for a
  number nobody will tune.
- `dedupeKey(title, author)` — pure, lowercases and collapses whitespace, joins
  with `\0`.

`randomUUID` lives here, as it does in `createDevice`. The
count-then-dedupe-then-insert runs in one `prisma.$transaction` inside
`createBookRequest` so the cap cannot be raced.

The cap and duplicate outcomes are **returned as a discriminated value, not
thrown** — no new members in `KNOWN_DOMAIN_ERROR_CLASSES`, no `toResult`
wrapper. This follows the line the codebase already draws (see §2): thrown
classes are for failures escaping as exceptions from a distance; these two are
decided by an explicit read inside the same function, exactly like `createUser`'s
`false` and `updateDevice`'s `null`.

> **Correction worth preserving.** An earlier version of this design put the
> writes directly in the resolvers, on the argument that "no stores" meant
> "resolvers own their Prisma calls". That is wrong: the store removal replaced
> injected classes with *function modules*, and `5c426328` had just finished
> pulling constraint handling out of resolvers. A resolver owning
> `prisma.bookRequest.create` would be the fourth exception in the schema, in
> the layer that commit had just cleared.

### GraphQL — `schema/book-request/`

GraphQL-only; no REST twin.

**`BookRequest` is a `prismaNode` keyed on the compound id**, so `node(id:)`
cannot read another reader's requests:

```ts
builder.prismaNode('BookRequest', {
  id: { field: 'userId_id' },
  findUnique: ownerScopedFindUnique((userId, id) => ({ userId_id: { userId, id } })),
  nullable: true,
  // …
});
```

This is why the model uses `@@id([userId, id])`. `ownerScopedFindUnique` decides
ownership **without reading the row**, by taking the `userId` out of the global
id itself and substituting `NO_MATCH_USER_ID` when the viewer is neither the
owner nor an admin. A plain `String @id` would carry no owner in the global id,
so the guard would have to read the row first — and `node-scope.test.ts`
enforces generically that every tenant-owned node type routes its `findUnique`
through this helper. `BookRequest` is a tenant-owned type and gets no exemption.

**One connection field, not two.** `User.bookRequests`, declared with
`authScopes: (parent) => ({ ownerOf: parent.id })` — precisely how `User.library`
is declared. It serves both surfaces:

- the reader reads `viewer { user { bookRequests } }`, and `Viewer.user` is
  already null for the config admin;
- the admin reads `user(id:) { bookRequests }`, and `Query.user` is admin-gated.

A separate `Viewer.bookRequests` would duplicate the field, its
`CONNECTION_LIMITS` entry, and its auth tests for no gain.

**The connection is a `t.prismaConnection` over a hand-written keyset**, mirroring
`Library.progress`:

```ts
bookRequests: t.prismaConnection(
  {
    type: bookRequest,
    authScopes: (parent) => ({ ownerOf: parent.id }),
    cursor: 'userId_createdAt_id',
    maxSize: CONNECTION_LIMITS.userBookRequests.maxSize,
    defaultSize: CONNECTION_LIMITS.userBookRequests.defaultSize,
    resolve: (query, parent, args, context) => {
      rejectOversizePage('User.bookRequests', args, CONNECTION_LIMITS.userBookRequests.maxSize);
      const { cursor, skip: _skip, ...page } = query;
      return context.prisma.bookRequest.findMany({
        ...page,
        where: {
          userId: parent.id,
          ...requestKeyset(cursor?.userId_createdAt_id, page.take),
        },
        orderBy: [{ createdAt: 'desc' }, { id: 'asc' }],
      });
    },
  },
  { name: 'UserBookRequestsConnection' },
  { name: 'UserBookRequestsConnectionEdge' }
);
```

`requestKeyset` is the local twin of `progressKeyset`: given the parsed cursor
and the plugin's own `take`, it returns the `where` for rows strictly after the
cursor in `createdAt desc, id asc` order, mirrored when `take` is negative, and
`{}` when there is no cursor. `take`'s **sign** is the direction and must be the
plugin's own — `resolvePrismaCursorConnection` slices the extra row off using its
own copy of that number, so changing it corrupts `hasNextPage` rather than
resizing the page. `cursor` and `skip` are deliberately dropped; `take` is
deliberately kept.

**Why the keyset rather than the plugin's seek, here specifically.** The audit
measured the deleted-cursor failure and accepted it on `Series.books` and
`Validation.messages`, where deleting the row you last paged from is an edge
case. On this connection it is the *expected* interaction: `bookRequestDelete` is
a first-class action on both surfaces — the reader withdraws a request, the admin
clears a resolved one. `t.relatedConnection` was considered and rejected for
exactly this reason: the audit proved the fix cannot be expressed there, because
its `resolve` is a fallback only.

**Other fields:**

- `User.pendingBookRequestCount` as a **filtered** `t.relationCount`
  (`where: { status: 'pending' }`), so the `/users` list shows who is waiting
  without paying for rows. It merges into the `Viewer.users` read the page
  already performs, exactly as `progressCount` does.
- `BookRequest.book` as a `t.relation`, nullable.
- `CONNECTION_LIMITS.userBookRequests` — `{ maxSize: 100, defaultSize: 20 }`,
  matching the other row-shaped connections.

**Mutations**, each returning a result union in the house style:

| Mutation | Scope | Union members beyond the payload |
| --- | --- | --- |
| `bookRequestCreate(title, author, note)` | viewer with `userId !== null` | `InvalidInputError`, `BookRequestLimitExceededError`, `DuplicateBookRequestError` |
| `bookRequestFulfill(id, bookId)` | admin | `InvalidInputError`, `BookRequestNotPendingError` |
| `bookRequestDecline(id, reason)` | admin | `BookRequestNotPendingError` |
| `bookRequestDelete(id)` | owner or admin | — |

Every `id` argument is a **Relay global id**, and `bookRequestFulfill`'s `bookId`
is one too — both because every mutation in this schema takes global ids, and
because the client half must not handle a raw book id (§2, the `provider/upload`
constraint). A `BookRequest` global id decodes to `[userId, id]`, so the
mutations receive the owner along with the row and pass both to the service
function.

**A request that does not exist, and a request the caller may not touch, are the
same answer** — a null payload, not a distinct error member. Nothing about
whether another reader has a given request id leaks out. `bookRequestFulfill`
and `bookRequestDecline` are admin-scoped, so the only null case there is a
genuine miss; `bookRequestDelete` is owner-or-admin and returns null for a row
belonging to someone else.

`bookRequestFulfill` returns `InvalidInputError` when `bookId` names a book that
is not in the request's own user's library — an admin must not fulfil alice's
request with a book out of bob's shelf.

`BookRequestNotPendingError` makes a double resolve a typed answer rather than a
silent overwrite. `bookRequestDelete` serves both "reader withdraws a pending
request" and "clear a resolved one off my list".

The new error refs follow the `builder.objectRef` convention — plain data
carrying a readonly `owner: Owner`, deliberately not classes, since the domain
outcomes behind two of them are returned values rather than thrown errors.

---

## 4. Section 2 — client

### Surfaces

**Admin — inside `user-row-content`.** A sibling `UserBookRequestsDocument`,
rooted at `Query.user(id: $userId) { bookRequests(...) }`, declared in that
component next to `UserProgressListDocument` rather than hoisted to
`page/user-list`. The reasoning is already written out in that file's doc
comment: the component is a child of `Card`'s `isCollapsible`/`defaultCollapsed`
pair, so it is never mounted until the card expands, and hoisting a per-user
document to a per-viewer route would fetch it for every user on every visit under
`Viewer.users`' ×50 multiplier. A separate document, not an extension of the
progress one, because the two lists page independently.

The `/users` row header shows the `pendingBookRequestCount` badge, which rides
along on the read `page/user-list` already performs.

**Reader — a card on `/user`.** Built like `MyProgress`/`my-progress-content`: a
collapsible `Card` whose content component owns
`viewer { user { bookRequests(...) } }`, so a collapsed card costs the route
nothing. The create form lives inside that card. It renders only in the
non-admin branch, which `/user` already has.

### The Approach B plumbing — four changes to `provider/upload`

1. **`addFiles(files, options?: { target?: { libraryId, username }, requestId? })`.**
   Every existing call site keeps working; the request row is the only caller
   that passes options.
2. **`TransportItem.targetUsername?`, captured at add time.** The transport uses
   `item.targetUsername` when set, else today's `withTargetUserRef.current(url)`.
   This also closes a pre-existing hazard with no request involved: an admin who
   switches libraries while items are still queued currently has those items
   upload into the *new* target.
3. **`TransportItem.fulfillsRequestId?`.** When an item reaches `done` with a
   `bookGlobalId`, the queue engine fires `bookRequestFulfill`, guarded by a ref
   set so it fires exactly once per item — the `announcedRef` pattern from
   `page/upload`.
4. **`onUploaded(libraryId)`** instead of `onUploaded()`, so the
   `Library.entries` eviction hits the library the bytes actually went to rather
   than whichever one the switcher points at.

### What the request row shows, and what it does not

The pending-fix merge is rooted on the *global* switcher, so a book uploaded into
bob's library while the switcher points at alice has no row to merge. Rather than
make that query per-item, **fix review stays out of the request row.** The row
shows progress, errors, EPUB validation failures, and on success a link to the
new book plus "N suggestions — review in Upload". The count reads
`TransportItem.proposals`, which the transport already stores from the XHR
response, so the row needs no extra query. Full proposal review remains on
`/upload`.

### Fulfillment recovery

The upload can succeed and the `bookRequestFulfill` mutation can then fail — a
dropped connection, a closed tab. The book has landed; the request is still
pending.

The request row therefore offers **"link an existing book"** alongside "upload
EPUB" and "decline": a picker over that reader's library, calling the same
`bookRequestFulfill(id, bookId)`. One mutation, two entry points. It is the
recovery path, and it independently covers the admin who uploaded the book
through `/upload` before opening the request. After a failed auto-fulfill the row
says so plainly — "uploaded, but the request didn't close" — and offers that
picker.

A client-side retry was rejected: the item is session state, so a closed tab
loses the retry and leaves the request with no way to close it but declining and
re-requesting.

### Live updates

None. If a request is fulfilled while the reader has the page open, they see it
on the next mount. No subscription, no polling.

---

## 5. Section 3 — testing and rollout

### Migration

Additive. Existing installs get an empty table: no badges on `/users`, and a
reader card showing an empty list with a create form. No feature flag, no config
option.

### Server tests

Mirroring `pending-fix/model.test.ts` and `device/`:

**`services/book-request.test.ts`**
- the cap — the 10th create succeeds, the 11th returns the limit value;
- the dedupe key's case and whitespace folding;
- that the count-dedupe-insert transaction cannot be raced past the cap;
- status transitions, and the not-pending outcome on a double resolve.

**`schema/book-request/model.test.ts`**
- node-level scope: reader A cannot reach reader B's request through `node(id:)`;
- `User.bookRequests` under `ownerOf` and under admin, including an admin reading
  a *target* user's requests rather than their own — the case
  `library/progress.test.ts` pins for the analogous field;
- the filtered `pendingBookRequestCount`;
- **the deleted-cursor case**: read page 1, delete the row the cursor names, read
  page 2 with that cursor, and assert rows come back rather than an empty page
  with `hasNextPage: false`. This is what the keyset is paying for, and it is the
  test that fails if someone later "simplifies" the resolver back onto the
  plugin's seek;
- backward pagination (`last`/`before`), since `t.prismaConnection` offers it and
  `requestKeyset` mirrors for a negative `take`.

**One test per mutation**, including the config admin (`viewer.userId === null`)
being unable to create, and `bookRequestFulfill` rejecting a book that belongs to
a different user.

### Client tests

- `user-row-content` gaining the request list;
- the reader card's create form, including the client-side required-field
  handling for title and author;
- `use-upload-transport.test.tsx`: `targetUsername` beating the global switcher,
  and the switch-libraries-mid-queue case — a bug fix with no request involved;
- `use-upload-queue.test.tsx`: fulfill firing exactly once per item, and
  `onUploaded(libraryId)` evicting the right library.

### Snapshots and budgets — regenerated deliberately, never to fit

- `app/server/graphql/schema.generated.graphql` is checked in and asserted by
  `print-schema.test.ts`. This feature grows it by a node type, a connection and
  its edge, four mutations, their error refs, and an enum. Regenerate on purpose
  via `npm run graphql:schema -w app/server` and call the change out in the
  commit.
- `client-operations-cost.test.ts` reads `app/client/src/gql/persisted-documents.json`,
  so the two new documents are priced automatically against the live
  `costLimitRule`. Write **literal** page sizes in them: a variable-valued
  `first`/`last` prices at the field's `maxSize`, not the value passed.
- If a cost budget moves, report before/after rather than adjusting the budget.

### Verification commands

```
npm run lint                  # server lint includes tsc ×2 + graphql:schema:check
npm test
npm run test:cost -w app/server
```

---

## 6. Where this goes next

1. Confirm the Pothos prerequisite is far enough along to start building — the
   design is done and does not depend on more of it, but the user's sequencing
   does.
2. The writing-plans skill, to turn this into an implementation plan.

The work splits cleanly at the schema boundary, and a plan should keep that
split: **the server half** (migration, service, schema module, mutations, their
tests, the regenerated SDL) is green and reviewable on its own with no client
change at all. **The client half** then divides again — the two read surfaces
are independent of the upload-provider changes, and change 2 of those
(`targetUsername` captured at add time) is a standalone bug fix that is worth
landing on its own regardless of this feature.
