# Spec 2, Step 8 — Progress screens — Design

Status: approved (design), 2026-08-23
Parent spec: `2026-08-03-apollo-client-migration-design.md` (§9 sequencing row 8). Read its **§14**
(lessons from executing steps 0–2) and **§15** (known behaviour changes) before planning.
Predecessors: steps 6 and 7 — their identity-seam lessons bind this step directly; see §5.
Base: `2ea303c4`, server 2014/2014, client 1149/1149, `test:cost` 33/33, lint + codegen + SDL clean,
branch pushed.

## User rulings

- **`Progress` gains a nullable `book` edge**, rather than a raw-id lookup field or leaving the rows
  on REST.
- **The lists are lazy on expand, with "Load more"** — not one large page, not auto-paging.
- **The two surviving `renameProgressKey` calls are removed** so `ProgressProvider` can actually be
  deleted in this step.

## 1. The gap: `Progress` has no path to its `Book`

Every progress row renders the book's title, author and cover. Today each row calls
`useBook(rawDocumentId)` over REST. `Progress` exposes `document` — a raw content hash — and nothing
else: no `book` edge, and `Library.book(id:)` takes a **global** id, so the hash cannot address it.
There is no `bookByDocumentId` anywhere in the schema.

**Shape:**

```graphql
type Progress {
  document: String!   # unchanged: raw content hash, identity/display
  book: Book          # NEW, nullable
  # …
}
```

**Nullable is load-bearing.** A KOReader device syncs progress for whatever it is reading, including
documents that are not in this library. Those rows must still render — the reader has real progress
against a book the library cannot resolve. A non-null edge would make the field unrepresentable for
exactly the case the raw `document` exists to describe.

**This mirrors an existing precedent, and should read as one.** `LinkedDocument` already pairs raw
hashes with resolvable edges: `oldId`/`newId` carry "Raw content-hash for display; resolve `oldBook`
to navigate." `Progress.book` is the same contract on a different type, and its description should
say so.

**N+1 safety — follow the established loader rule.** Resolve through a request-scoped batching
loader, `context.loadBookByDocument(userId, document)`, NOT a per-parent query: a page of 50
progress rows must not fire 50 lookups. Per the project's standing loader rule, the loader
**captures `reject` and wraps both the query and the grouping in try/catch** — a loader that only
captures `resolve` hangs the request on a DB error. That bug shipped once here (`progress-loader`)
and must not ship again. Batch by `(userId, document)` PAIRS, never a bare `document IN (...)`: a
KOReader content hash collides across tenants, which `progress-loader.ts`'s own doc comment records.

Server-side work is confined to this field, its loader, and its tests, and goes through the normal
gates: SDL regeneration, the cost-calibration suite, and its own review.

## 2. My progress — `page/user`

The "Progress" card is `defaultCollapsed`, yet today it fetches the entire progress list on mount to
compute its "N books synced" subtitle.

- **Collapsed:** read `progressCount` and fetch **zero rows** — strictly less work than today.
  The path matters: `Query.user(id:)` is admin-only, so a non-admin cannot use it for their own
  count. Use **`viewer { user { progressCount } }`** (`Viewer.user: User`, verified present).
  `Viewer.user` is NULLABLE and is null for the config-based admin, which has no `User` row — the
  same reason `viewer.library` is null for it. Render no subtitle in that case rather than "0 books
  synced", and confirm what the REST screen does there before choosing.
- **On expand:** `progress(first: 50)` — the connection's own `defaultSize`
  (`CONNECTION_LIMITS.libraryProgress` is `{ maxSize: 100, defaultSize: 50 }`).
- **"Load more":** `fetchMore`, the same shape `useLibraryEntries` established in step 5.

Rows render **fetch-free** off the connection — no per-row book request — which is the pattern step 5
established for the library grid and step 6 carried to the series page.

Rooting follows the settled rule: `node(id: $libraryId)` via `useCurrentLibraryId()`.

## 3. A user's progress — `/users`, admin only

`UserRowContent` shows a *different* user's progress, so it cannot root at the viewer's library.
Root at **`Query.user(id: $userId) { library { progress … } }`**.

`Query.user(id:)` is admin-only and refuses a non-admin even for their own id — which is exactly
right here, because `UserRow` renders only for admins, and it already holds the `userId` (a User
global ID, from step 4's `/users` migration). Note this is a deliberate exception to the parent
spec's "always root at `node(id:)`" rule, whose stated reason was that `Query.user(id:)` refuses
non-admins; that reason does not apply on an admin-only screen.

## 4. Mutations

| Hook | Becomes | Note |
|---|---|---|
| `useSetMyProgress` | `progressSet` | Viewer-only by design — the server 403s admins, and `ProgressSetInput.userId` must be the viewer's own User global id. Its `document` is the RAW hash. |
| `useDeleteMyProgress` | `progressDelete` | Takes `Progress.id` and authorises the DECODED owner, so it is genuinely admin-capable. |
| `useDeleteUserProgress` | `progressDelete` | Same mutation; the admin path. |
| `useLinkProgress` | `bookLinkDocument` | |

`Progress.id` is a computed global id (`encodeGlobalID('Progress', [userId, document])`) that is
deliberately NOT resolvable through `node(id:)` — `Progress` is not a `Node`. Use it to key the
cache and to address `progressDelete`, never as a `node()` argument.

## 5. The identity seam — what steps 6 and 7 taught

Progress is the last raw-id-keyed client cache, and `ProgressSetInput.document` is a raw hash, so
this step handles both id kinds at once. Two rules carry forward:

- **Raw hash** for `progressSet`'s `document` and for the display of an unresolvable row.
- **Global id** for `progressDelete`'s `Progress.id`, for `Query.user(id:)`, and for anything
  reaching `Library.book`.

**The client never encodes or decodes a global ID.** Where a raw hash is needed, it comes from
`Progress.document`; where a global id is needed, it comes from the server.

Step 7's whole-branch review found that swapping a hook silently dropped cache-coherence side
effects the old one had. **When replacing each progress hook, diff the old hook's side effects
against the new one, item by item** — the optimistic local writes in `useSetMyProgress` and
`useDeleteMyProgress` are exactly that kind of side effect, and their GraphQL replacements need
cache updates that produce the same observable result.

## 6. The link modal

`useUserBookList` fetches a user's entire library and filters it **client-side** as the user types.
That does not translate to a paginated connection. It becomes
`Library.entries(filter: { query, entryType: BOOK })` — server-side filtering, the same mechanism the
library grid's search already uses.

**This is a real interaction change, and belongs in §15:** filtering becomes a round trip per query
instead of an instant local filter. The trade is not pulling an entire library into memory to filter
it, and it is the only shape that works against a bounded connection.

## 7. What retires, and what does not

- **`ProgressProvider` is DELETED**, along with all **ten** hooks under `provider/progress/hook/`
  and the context. (Ten, counted directly: my/user variants of list, single and delete, the two
  fetch hooks, plus set and link.) This requires removing two `renameProgressKey` calls that survive into step 9 —
  `use-patch-book-metadata.ts:125` and `use-replace-book.ts:145`. Once every reader of the REST
  progress map is migrated, the map is **write-only**, and those calls maintain state nobody
  consults. Their real purpose — keeping progress attached across an id rotation — is already served
  server-side: `bookStore.resolveBookId` resolves old ids through `book_id_history`, and
  `reimportBook` migrates the `Progress` row inside the rotation's own transaction. Both were
  verified during step 7 and recorded in the parent spec's §15.
- **`useBook` and `use-fetch-book.ts` become dead** — the two progress rows are their last
  non-test consumers, confirmed by direct count. **Do NOT delete them here.** Step 10 owns
  `BookProvider`, and half-dismantling it across two steps is how the survivor counts in steps 6 and
  7 both went wrong. Record them as step 10's, with the trace.
- **`useWithTargetUser` is unaffected** — verified, not assumed: zero files under
  `provider/progress/` reference it, so the count stays at 7. Re-verify at the sweep anyway; this
  class of prediction has been wrong twice, and a trace is what caught it both times.

## 8. What this step closes from earlier steps

- **The STEP-8 BRIDGE.** `SetProgressModal`'s `onSaved` prop and `page/book`'s `refetch` wiring exist
  only because the modal wrote over REST while the page read from Apollo. Once `progressSet`
  normalizes onto the same `Progress` entity, both become dead weight. The prop's doc comment names
  this migration as its deletion trigger.
- **The missing-`ProgressProvider` fixture gap** in `my-progress-row` and `user-progress-row`'s test
  files — the same gap that let step 6 ship a silently broken clear-progress path. It disappears with
  the provider, but the replacement tests must genuinely exercise the mutations rather than inherit
  no-op stubs.

## 9. Testing

Migrate to `renderWithApollo` / `renderHookWithApollo` (`test-utils.tsx`, real `InMemoryCache` +
`MockLink`; no MSW). Carry over every existing case; name any judged inapplicable.

Standing disciplines bind, and three are worth restating:

- **Fragment masking is COMPILE-TIME ONLY here.** `FragmentType` is a type-only marker, `useFragment`
  an identity cast, `dataMasking` never enabled — masked data is NOT stripped at runtime. Never
  assert `not.toHaveProperty(...)` to "prove masking"; prove it at the type level.
- **Compose the harness the way `App.tsx` composes.** Step 7's page test mounts a real
  `UploadProvider` for this reason.
- **Seen-to-fail on every property-protecting test**, re-run at the branch tip.

Error surfacing follows §14.6: screen hooks return `error: string | undefined`; a first-page failure
with no data is the empty-error state, a `fetchMore` failure keeps existing rows and offers retry.

## 10. Definition of done

- Both progress screens and the link modal read and mutate entirely over GraphQL.
- `Progress.book` shipped with a batching loader and its tests.
- `ProgressProvider`, its context, and all ten hooks deleted; the two `renameProgressKey` calls
  removed.
- `useBook`/`use-fetch-book` confirmed dead and recorded as step 10's, not deleted here.
- Both suites green, lint + codegen + SDL clean, `test:cost` green with no document over 70%.
- The link modal's filtering change and any other user-visible divergence recorded in §15.

## 11. Out of scope

Steps 9 and 10: upload/replace, `BookProvider`'s deletion, and the final `apiFetch` sweep. Also out:
step 7's parked follow-ups — the truthy-guard bug that prevents clearing a field to empty string, and
`Library.series` going stale when a save creates a new series. Both belong to whoever next works in
those files.
