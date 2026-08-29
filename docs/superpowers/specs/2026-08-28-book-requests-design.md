# Book requests — design (work in progress)

**Branch:** `request-book-from-admin` · **Started:** 2026-08-28 · **Path:** architectural (brainstorming skill)

**Status: incomplete.** Section 1 (data model + server API) is written and was
awaiting approval when the session ended. Sections 2 (client) and 3 (testing and
rollout) were never presented — section 2 exists here only as an unreviewed
draft. Nothing has been implemented; no feature code exists on this branch.

**Blocked on a prerequisite.** The user wants the Pothos Prisma/Relay conversion
done *before* this feature is built. See
`2026-08-28-pothos-prisma-relay-conversion-prompt.md` in this directory.

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
| Surfaces | Admin sees requests **grouped per user inside the existing `/users` page**; readers get a card on `/user`. No new route, no new nav entry. |
| Request fields | **Title and author both required**, note optional. |
| Guardrails | All three: **cap on open requests per reader**, **reject duplicates**, **reader can cancel/delete**. |

---

## 2. Codebase findings

Verified against `cd1f569b` (after rebasing this branch onto main twice during
the session — the REST removal, then the store removal).

### Server

- **Stores are gone.** `services/*.ts` are now flat modules of plain exported
  functions taking `prisma` as the first argument (`createDevice(prisma, input)`),
  imported directly by resolvers. `Context` has no `stores` bag — named fields
  only, for genuine singletons (`scanJobs`, `thumbnails`, `replaceStaging`,
  `editionsRoot`). See `app/server/services/README.md`.
- **Reads live in Pothos, writes live in services.** Only three direct Prisma
  writes remain anywhere under `graphql/schema/`.
- **Domain errors** are classes thrown by the service function and converted by
  `to-result.ts` (the `KnownDomainError` family). Commit `5c426328` deliberately
  moved the P2002/P2025 conversions *out of resolvers* and into the service.
  Resolver bodies contain no `try`, no `catch`, no `throw`.
- **Policy failures that the function decides itself** return a value instead of
  throwing, and are then *not* wrapped in `toResult` — `createUser` returns
  `false` on its P2002 race, `updateDevice` returns `null` on P2025, both with
  doc comments explaining why.
- The config-based admin has **`userId: null`** — no row in `users`. It cannot
  own library rows and cannot be a requester.
- `POST /api/books/upload` and `resolveOwner`'s `?user=<username>` targeting
  survive the REST removal as a sanctioned seam (XHR is the only source of
  upload progress).

### Client

- The upload queue is a **single session-wide provider** (`provider/upload`),
  mounted above the router so it survives navigation.
- `use-upload-transport.ts` targets uploads via
  `withTargetUserRef.current('/api/books/upload')` — derived from the admin's
  **global** library-switcher selection, not per item.
- `use-upload-queue.ts` merges transport items with `LibraryPendingFixesDocument`,
  which is rooted on `useCurrentLibraryId()` — also global. So is its
  `Library.entries` cache eviction.
- `user-row-content` already lazily mounts per-user content only when the card is
  expanded, and owns its own `Query.user(id:)`-rooted document. That is the
  pattern the admin request list should follow.
- The nav already supports a count badge (`NavItem.badge`), unused by this design
  since there is no new nav entry.

---

## 3. Design — section 1: data model and server API

Written, not yet approved.

### Prisma model

New migration directory `prisma/migrations/<ts>_add_book_requests/migration.sql`,
applied by the existing `db/migrate.ts`.

```prisma
model BookRequest {
  id            String  @id                     // randomUUID(), minted in the service
  userId        String  @map("user_id")
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

  @@index([userId, status])
  @@index([userId, dedupeKey])
  @@map("book_requests")
}
```

Two non-obvious choices:

- **`onUpdate: Cascade` on the book FK**, matching `PendingFix`. A book id is a
  content hash and rotates whenever the EPUB is rewritten (accepting a metadata
  fix does exactly this), so a fulfilled request would otherwise point at a dead
  id.
- **`onDelete: SetNull`** — a fulfilled request whose book is later deleted stays
  fulfilled but loses its link. The reader's card renders "added to your library"
  without a link rather than as an error.

Status is stored lowercase and exposed as an uppercase `BookRequestStatus` enum,
following `CoverFit`.

### Service — `services/book-request.ts`

Singular-domain naming, alongside `device.ts`, `user.ts`, `progress.ts`,
`pending-fix.ts`. Exports `createBookRequest(prisma, input)`,
`fulfillBookRequest`, `declineBookRequest`, `deleteBookRequest`, plus
`MAX_OPEN_BOOK_REQUESTS` (10, a module constant — **not** an add-on config
option unless the user asks) and the pure `dedupeKey(title, author)`.

`randomUUID` lives here, as it does in `createDevice`. The
count-then-dedupe-then-insert runs in one `prisma.$transaction` inside
`createBookRequest` so the cap cannot be raced.

The cap and duplicate outcomes are **returned as a discriminated value, not
thrown** — no new members in `KNOWN_DOMAIN_ERROR_CLASSES`, no `toResult`
wrapper. This follows the line the codebase already draws (see §2): thrown
classes are for failures escaping as exceptions from a distance; these two are
decided by an explicit read inside the same function.

> **Correction worth preserving.** An earlier version of this design put the
> writes directly in the resolvers, on the argument that "no stores" meant
> "resolvers own their Prisma calls". That is wrong: the store removal replaced
> injected classes with *function modules*, and `5c426328` had just finished
> pulling constraint handling out of resolvers. A resolver owning
> `prisma.bookRequest.create` would be the fourth exception in the schema, in
> the layer that commit had just cleared.

### GraphQL — `schema/book-request/`

GraphQL-only; no REST twin.

- `BookRequest` as a `prismaNode` with the standard `isOwnerOrAdmin` `findUnique`
  guard, so `node(id:)` cannot read another reader's requests.
- Reads: `Viewer.bookRequests` (the reader's own); `User.bookRequests` under the
  existing `ownerOf`/admin scope, rooted from `Query.user(id:)` for the admin
  card; `User.pendingBookRequestCount` as a filtered `t.relationCount`, so the
  `/users` list shows who is waiting without paying for rows — exactly how
  `progressCount` behaves.
- Both connections need a documented bound in `CONNECTION_LIMITS`.
- Mutations, each returning a result union in the house style:
  - `bookRequestCreate(title, author, note)` → `BookRequestCreatePayload | InvalidInputError | BookRequestLimitExceededError | DuplicateBookRequestError`
  - `bookRequestFulfill(id, bookId)` — admin only
  - `bookRequestDecline(id, reason)` — admin only
  - both of the above also return `BookRequestNotPendingError`, so a double
    resolve is a typed answer rather than a silent overwrite
  - `bookRequestDelete(id)` — owner or admin; serves both "reader withdraws a
    pending request" and "clear a resolved one off my list"
- `bookRequestCreate` requires `viewer.userId !== null`. The config-based admin
  cannot be a requester; the reader card simply does not render for an admin
  (`/user` already branches on `isAdmin`).

---

## 4. Design — section 2: client (DRAFT, never presented)

This was worked out but not shown to the user. Treat it as input, not agreement.

The core problem Approach B creates: the upload queue is global and
**library-scoped in three places** — the transport's `?user=` target, the
`LibraryPendingFixesDocument` merge, and the `Library.entries` cache eviction.
An item uploaded to bob's library while the switcher points at alice's would
have its proposals silently dropped and evict the wrong library's entries.

Proposed shape:

- `addFiles(files, options?: { target?: { libraryId, username }, requestId? })`.
- `TransportItem` gains `targetUsername?`, **captured at add time**. The
  transport uses `item.targetUsername` when set, else today's
  `withTargetUserRef.current(url)`. This also closes a pre-existing hazard: an
  admin who switches libraries while items are still queued currently has those
  items upload into the *new* target.
- `TransportItem` gains `fulfillsRequestId?`. When an item reaches `done` with a
  `bookGlobalId`, the queue engine fires `bookRequestFulfill`, guarded by a ref
  set so it fires exactly once per item (the `announcedRef` pattern in
  `page/upload`).
- `onUploaded` takes the item's library id so the eviction hits the right
  library.
- **Fix review stays out of the request row.** The row shows progress, errors,
  EPUB validation failures, and on success a link to the new book plus
  "N suggestions — review in Upload". The count comes from the XHR response's
  `results[0].proposals`, which the transport already stores, so the row needs no
  extra query. Full proposal review remains on `/upload`.

Open within this section: whether the reader's card needs any live update when a
request is fulfilled while they have the page open (leaning no — no
subscription, YAGNI).

---

## 5. Open items for the next session

1. **Approve or amend section 1** (the corrected version in §3).
2. **Present sections 2 and 3.** Section 2 draft is §4; section 3 (testing and
   rollout) has not been drafted at all.
3. Decide whether `MAX_OPEN_BOOK_REQUESTS` stays a constant or becomes an add-on
   config option (`config.yaml` + README + the options table).
4. Then: spec self-review, user review of the written spec, and only then the
   writing-plans skill. No implementation before that gate.

## 6. Verification commands

```
npm run lint                  # server lint includes tsc + graphql:schema:check
npm test
npm run test:cost -w app/server
```

`app/server/graphql/schema.generated.graphql` is checked in and asserted by
`print-schema.test.ts`; adding this schema module changes it, and the snapshot
must be regenerated deliberately via `npm run graphql:schema -w app/server`.
