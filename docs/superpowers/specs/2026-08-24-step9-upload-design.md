# Step 9 — `/upload` and Replace onto GraphQL

**Parent spec:** `docs/superpowers/specs/2026-08-03-apollo-client-migration-design.md` (§9, row 9)
**Status:** approved 2026-08-24
**Predecessors:** step 6 (book detail + series), step 7 (book edit), step 8 (progress screens)

---

## 1. Scope

Move the upload queue and the Replace-file modal onto GraphQL. Binary transfer stays REST.

**In scope**

- `provider/book/hook/use-upload-queue.ts` (the 572-line engine) and everything it calls
- `provider/upload/` — `api.ts` deleted, hooks reshaped
- `provider/book/hook/use-replace-book.ts` + `control/upload-replace-modal`
- `provider/book/hook/use-patch-book-metadata.ts` — retires with its last consumer
- The post-upload and post-scan library-grid refresh (§6) — a live defect, see §6.1
- Re-homing `useFetchBookList`'s stale-library-target self-healing (§6.3)
- Server: two additions to `bookResolvePendingFix` (§3)

**Explicitly out of scope**

- `POST /api/books/upload` — stays REST. Multer + XHR is the only way to get upload
  progress; sanctioned seam 3 in the parent spec §9.1.
- `POST /api/books/replace-staging` — stays REST, sanctioned seam 4, reached through
  the existing `lib/staged-upload.ts`.
- Deleting `BookProvider` and its now-fully-dead book-list cache. **Step 10 owns this.**
  See §7.3 for why this is deliberate rather than an oversight.
- `GET /api/public-config` (`provider/config/provider.tsx`). Discovered during
  exploration: it uses raw `fetch`, not `apiFetch`, so the parent spec's four-seam
  sweep assertion would not catch it. It is genuinely pre-auth (the password-reset
  page renders the library name before login) and `Query.config` is authenticated, so
  it cannot move. Recorded here so step 10 can decide whether to widen the sanctioned
  list to five rather than rediscover it.

---

## 2. Decisions

**D1 — The server owns pending-fix state.** Today the client owns it: it applies fixes
itself via `PATCH /api/books/:id/metadata`, then syncs the resulting state blob back
with `PUT`/`DELETE /api/books/:id/pending-fixes`. After this step the client owns none
of it. `bookResolvePendingFix` gains a fix-subset argument so per-fix Accept/Reject is
just a one-element subset, and the whole duplicated apply path leaves the client.

Rejected: mirroring `PUT` as a `bookSetPendingFix` mutation taking an opaque state
blob. It would have been the smaller diff, but it perpetuates client-owned state,
keeps subject-split folding implemented twice, and leaves `bookResolvePendingFix` as
dead schema.

Also rejected: using `bookResolvePendingFix` exactly as shipped and dropping per-fix
Accept/Reject from `FixReview`. That is a user-facing feature removal — the same call
ruled against in step 8 when an implementer dropped the Link affordance.

**D2 — The Replace modal is in scope.** The parent spec's row reads `/upload`, and
step 10 is described as a deletion-only sweep, but `use-replace-book.ts` is still on
REST and step 10's sweep asserts `apiFetch` is confined to four seams. Something has
to migrate it; step 9 is the step that keeps step 10 honest. Both consumers of
`FixReview` then move together, so its prop shape changes once.

**D3 — Fix the grid staleness at both call sites.** §6.1 documents the defect. The
upload path is in scope by definition; `useScanLibrary` has the identical dead
`fetchBookList()` call and a scan mutates far more rows than one upload. Shipping the
grid correct after uploads but stale after scans would be an unexplainable half-fix.

**D4 — Re-home the stale-target self-heal onto the GraphQL read.** §6.3.

---

## 3. Server changes

All three touch surface with **zero client consumers today** — the client is still on
REST for pending fixes — so reshaping is free. Server tests are the only callers.

### 3.1 `ACCEPT` captures `originalMetadata` — persisted, NOT exposed

`types.ts:179` already carries `originalMetadata?: Record<string, string | string[]>`
on the domain `UndoSnapshot`, but `bookResolvePendingFix`'s `ACCEPT` never writes it
(`resolve-pending-fix.ts:369` arms `undo` with `kind`/`proposals`/`appliedFixes` only).
It must, or `UNDO` (§3.3) has nothing to revert to.

**It is deliberately NOT added to the GraphQL `UndoSnapshot` type.** An earlier draft of
this spec exposed it. That was wrong, and D1 is why: once the server owns the revert,
the server reads the persisted snapshot directly and the client never needs the field.
Traced in the UI — `fix-review/index.tsx` reads exactly two things from a snapshot,
whether it exists (`:100,:136`) and its `kind` for the button label (`:141`). Nothing
renders `proposals`, `appliedFixes`, or `originalMetadata`.

`undo-snapshot/model.ts`'s existing comment ("`originalMetadata` is deliberately left
off — it is not part of the cleanup spec's SDL for this type and no field here reads
it") therefore stands unchanged after this step. Update it only to cite this spec as a
second reader that also does not need it.

Snapshot the same five editable fields the client's `fetchBookSnapshot` took:
`title`, `titleSort`, `author`, `authorSort`, `subjects`.

### 3.2 A fix subset on `bookResolvePendingFix`

```graphql
input MetadataFixKeyInput { field: String!, kind: String!, from: String! }

input BookResolvePendingFixInput {
  id: ID!
  action: PendingFixResolution!
  fixes: [MetadataFixKeyInput!]   # NEW — omit = every proposal (today's behaviour)
}
```

The triple is the client's existing `fixKey` (`use-upload-queue.ts`'s
`` `${fix.field}:${fix.kind}:${fix.from}` ``), which exists precisely because fixes
carry no server id and multiple compound-subject splits share field+kind. Positional
addressing is rejected: a stale index silently resolves the wrong fix.

Unmatched keys are ignored rather than erroring — the same "already resolved" race the
existing no-op branches already tolerate.

### 3.3 Four actions, not two

```graphql
enum PendingFixResolution { ACCEPT, DISMISS, UNDO, CLEAR }
```

| Action | Behaviour | Relation to shipped code |
|---|---|---|
| `ACCEPT` | Apply the named (or all) **actionable** proposals in one `applyEpubChanges`; arm `undo{APPLY}` carrying `originalMetadata` | exists, minus subset and minus `originalMetadata` |
| `DISMISS` | Remove the named (or all) proposals **without applying**; arm `undo{DISMISS}` | **semantics change** — currently deletes the row |
| `UNDO` | Revert metadata to `originalMetadata`, clear organic edit lineage, restore `proposals`/`appliedFixes` from the snapshot, clear `undo` | new |
| `CLEAR` | Delete the `PendingFix` row | this is today's `DISMISS` |

`ACCEPT` keeps its existing `actionable = proposals.filter(f => f.to !== null)` filter
and its existing strict no-op branch: an advisory-only fix folds to empty `EpubChanges`
and must not trigger a rewrite that mints a pointless new content-hash id.

Capturing `originalMetadata` is free — the resolver already holds `targetBook` before
calling `applyEpubChanges`.

`UNDO` routes through `applyEpubChanges` too, so it inherits the
`BookHashCollisionError` / `EpubValidationError` union members already declared, and
the `targetBook.valid !== true` gate applies to it for the same reason it applies to
`ACCEPT`. `DISMISS` and `CLEAR` never touch the EPUB and stay ungated.

Lineage clearing on `UNDO` reuses `bookClearEditLineage`'s store call and stays
best-effort: the revert stands even if cleanup fails, matching today's client.

---

## 4. Client architecture

### 4.1 Most of the engine is deleted, not ported

Once the server owns fix state these have no reason to exist client-side:

`serializeState`, `stateOf`, `syncedRef` + the sync effect, `applyPatch`, `applySplit`,
`changesToPatch`, `fetchBookSnapshot`, `isSubjectSplit`, and the whole of
`provider/upload/api.ts`. Subject-split folding stops being implemented twice.

### 4.2 The remainder splits by responsibility

| File | Owns | Transport |
|---|---|---|
| `provider/upload/hook/use-upload-transport.ts` | XHR, rolling concurrency, progress, `addFiles` | REST (sanctioned) |
| `provider/upload/hook/use-pending-fixes.ts` | reads `Library.pendingFixes` | GraphQL |
| `provider/upload/hook/use-fix-actions.ts` | the four `bookResolvePendingFix` calls | GraphQL |
| `provider/upload/hook/use-upload-queue.ts` | merges the two sources, exposes today's `UseUploadQueue` | — |

`UseUploadQueue`'s public shape is preserved, so `page/upload` and `FixReview` change
only where the id type changes (§4.3). `useUploadQueueEngine` moves out of
`provider/book` into `provider/upload`, where its remaining REST call belongs.

`maxConcurrentUploads` comes from `Query.config` instead of `GET /api/config`. This is
the first client consumer of `Query.config`.

### 4.3 One id, not two

`UploadItem` currently carries `bookId` (raw) **and** `bookGlobalId`, with a comment
explaining that every other REST call the queue makes needs the raw id. After this step
no client call needs a raw book id: the upload POST takes no book id, and every
mutation takes a global one. The queue keys on global ids only.

This deletes one HALF of the dual-id hazard: the raw-vs-global *kind* confusion, the
defect class that produced the C-2 navigation bugs in step 6. It does **not** delete the
other half — id *rotation*. A book's id is its content hash, so `ACCEPT`, the `UNDO` of
an apply-snapshot, and `bookReplace` all mint a new one; keying on global ids only makes
every id the same KIND, it does not make any of them STABLE.

*Corrected after the whole-step review (finding C-1), which found the original claim
above too strong and the omission live.* `TransportItem.bookGlobalId` was written once,
in `xhr.onload`, and the queue joins its server rows on it — so the first accept of any
this-session upload left the live item pointing at an id the server no longer resolves,
and the re-keyed row rendered as a second card for the same book. The deleted REST engine
had handled this (it rewrote `bookGlobalId: patched.globalId` after each patch); the
rewrite dropped the mechanism and kept the promise. The fix threads the mutation
payload's `book.id` back onto the matching transport item — see §4.4.

### 4.4 Item identity across an id rotation

`PendingFix.id` is derived from the book id, so a successful `ACCEPT` that rewrites the
EPUB rotates it. A seeded row keyed on `PendingFix.id` therefore remounts after an
accept. The REMOUNT is cosmetic (the row re-renders with the same content) but must be
chosen deliberately: key seeded rows on `PendingFix.id`, and accept the remount rather
than carry a synthetic stable id whose only job is to hide it.

**The rotation itself is NOT cosmetic** — corrected after the whole-step review (finding
C-1), which is the whole of §4.4's original error. Calling it "cosmetic — a seeded row
remounts" reasoned only about the React key of a SEEDED row and never about the JOIN.
`bookGlobalId` is both the seeded row's identity and the key `items` merges the live
transport against the server's rows on, so a rotation the client does not follow breaks
that join outright: two cards for one book, a dead Edit link, and `undo`/`dismissFix`/
`dismissCompleted` resolving `missing` on the live card.

The mechanism, therefore: `bookResolvePendingFix` already selects `book { id }` for
exactly this purpose, `useFixActions`' actions resolve a `FixOutcome` carrying it (their
internal contract only — `UseUploadQueue` stays boolean), and the queue's
`applyFix`/`applyAllProposals`/`undo` mappers call `useUploadTransport`'s
`remapBookGlobalId(oldGid, newGid)` when the two differ. `DISMISS`/`CLEAR` are not
routed through it: neither calls `applyEpubChanges`, so neither can rotate an id.

One render-wide window survives by construction: the payload's re-keyed row list is
normalized into the cache DURING the mutation, while the remap runs AFTER it resolves.
`mergeRow`'s `everSeen` guard covers that render (it renders "no proposals" rather than
the transport's stale upload-time list). That guard was documented as defensive-only,
with the 7-day `Library.pendingFixes` TTL as its "only theoretical trigger"; the review
found that wrong, and a render-capturing test now proves it load-bearing — the real
trigger is this rotation window, on every accept.

### 4.5 Replace modal

`analyzeReplacement` / `commitReplacement` become: stage the file through the existing
`lib/staged-upload.ts` seam, then call `bookAnalyzeReplace` / `bookReplace` with the
returned `stagedUploadId`. Exactly the pattern step 7 established for staged covers.

`use-replace-book.ts`'s `bookList` sweep is deleted, not ported. Its own comment
already records that the sweep became an unconditional dead no-op once `page/book`
moved to GraphQL and began passing a global id where the sweep compares raw ids.

---

## 5. Data flow — the four fix operations

Per-fix and bulk differ only in whether `fixes` is populated:

| UI affordance | Call |
|---|---|
| `FixReview` per-fix Accept | `ACCEPT`, `fixes: [thatKey]` |
| `FixReview` per-fix Reject | `DISMISS`, `fixes: [thatKey]` |
| item "Accept all" | `ACCEPT`, `fixes` omitted |
| item "Reject all" | `DISMISS`, `fixes` omitted |
| item Undo | `UNDO` |
| item "Clear upload" / page "Clear finished" | `CLEAR` |

A live session item that has never reached `done` has no server row; `CLEAR` on it is
purely local queue removal, and `CLEAR` on a missing row is a server no-op — matching
today's `deletePendingFix`, which is unconditional.

---

## 6. Cache coherence

### 6.1 The grid-staleness defect (fixed here)

`use-delete-book.ts` and `use-update-book-metadata.ts` both evict `Library.entries`
after mutating. The upload queue instead calls `fetchBookList()`, which refreshes the
REST book-list cache — and **nothing renders from that cache any more** (§7.2).
`LibraryEntriesDocument` is cache-first, so after an upload the new book does not
appear in `/library` until an unrelated mutation happens to evict entries or the user
hard-reloads.

This is a live defect on the branch, introduced at step 5 when the grid moved to
GraphQL while the upload queue kept refreshing the cache it had stopped feeding.
`useScanLibrary` has the identical defect.

### 6.2 What each path does

| Trigger | Action |
|---|---|
| upload completes (XHR, no payload to write from) | evict `Library.entries` + `cache.gc()`; refetch `Library.pendingFixes` |
| scan completes | evict `Library.entries` + `cache.gc()` |
| `ACCEPT` | payload selects `library { pendingFixes { … } }` → list reconciles in place; **plus** evict `Library.entries` (metadata changed, so sort position may have), **plus** evict the old `Book:<id>` when the payload's `book.id` rotated |
| `UNDO` | payload selection **plus** both `ACCEPT` evictions — a revert changes metadata, and rotates the id, exactly as an accept does |
| `DISMISS` / `CLEAR` | payload selection alone; no eviction — neither touches the EPUB |
| `bookReplace` | evict `Library.entries` + `cache.gc()`, **plus** evict the old `Book:<id>` when the payload's id rotated — a replace swaps the EPUB, rotates the id, AND rewrites title/author from the new file |

`bookReplace` was missing from this table entirely until the whole-step review (finding
I-1), and `useReplaceBook` performed no cache update at all to match: the pre-step-9
version cleared the REST book-list caches, this step correctly deleted those (they fed a
dead cache, §7.2) and never added the GraphQL equivalent. `BookReplacePayload` carries
only `book` — no `library { id }` the way `BookDeletePayload` does — so the library id
comes from `useCurrentLibraryId()`, exactly as `use-update-book-metadata.ts` already
resolves it for the same reason.

`BookResolvePendingFixPayload` already carries both `book` and `library`; the `library`
field exists specifically so a cache can update the pending-fix list in place, which is
exactly what this consumes.

**Seen-to-fail requirement:** deleting the `Library.entries` eviction must fail a test
that asserts an uploaded book appears in the grid. The defect in §6.1 existed precisely
because no such test did.

### 6.3 Re-homing the stale-target self-heal

`useFetchBookList` clears a stale `targetLibraryId` in two cases: an admin target that
resolves to no username, and a 404 from `/api/books`. Removing both `fetchBookList()`
callers retires that behaviour whether or not the file is deleted.

The switcher's own effect already covers the first case proactively. The second moves
onto the GraphQL read: when `node(id: libraryId)` resolves to `null` or a non-`Library`
and the viewer is an admin holding a target, clear it. This is strictly better than the
REST version — it fires wherever the library is read, not only on screens that happened
to call `fetchBookList`.

### 6.4 Two consumers get simpler

- `useUploadBadge` counts `Library.pendingFixes` rows rather than local queue items, so
  it is correct after a reload instead of empty until something re-seeds the queue.
- `usePendingFixesForBook` becomes a `Book.pendingFix` selection on book-edit's existing
  query, removing that page's dependency on `UploadProvider` entirely.

---

## 7. Retirements

### 7.1 Deleted by this step

- `provider/upload/api.ts`
- `provider/book/hook/use-patch-book-metadata.ts` (+ test) — last consumer gone
- `use-replace-book.ts`'s REST body and its dead `bookList` sweep

### 7.2 Already dead, confirmed by direct trace

`useBook`, `useFetchBook`, `useBookList`, `useStandaloneBookList`, `useBookListItems`,
`useUploadBookList` all have zero live callers. Nothing renders from `BookContext`'s
`bookList` / `completeBookIds` / `bookListItems`.

Verified by identifier trace across all non-test files, then re-verified by word-level
grep — the first pass and the second disagreed on `useStandaloneBookList` and
`useBookList` until comment-only mentions in `library-switcher/index.tsx` were excluded.
That file's own comment independently records both as "fully dead (no live caller)".

### 7.3 Deliberately NOT deleted here

The dead hooks above and `BookProvider`'s book-list state. **Step 10 owns
`BookProvider`.** Step 8 set this precedent explicitly: half-dismantling a provider
across two steps is how the survivor counts in steps 6 and 7 both went wrong.

### 7.4 `useWithTargetUser` prediction

7 → **5** after this step: `use-download-book` (permanent seam), `use-fetch-book`,
`use-fetch-book-list`, `use-upload-book-list` (three dead, deleted at step 10), and the
upload transport — which keeps it, because admin-on-behalf uploads still need `?user=`
on the multipart POST.

Step 10 should then land on **2**.

This is a prediction to verify by direct count at the sweep, not a result. The
equivalent prediction was wrong at step 6 and again at step 7, both times because a
wrapper hook hid a live caller.

**Verified by task 12's sweep: the count is exactly 5**, by the same five names
predicted above. Unlike steps 6 and 7, this prediction held.

---

## 8. Testing and guardrails

**Server**

- Subset filtering: `ACCEPT` with one key applies only that fix; the others survive as
  proposals. Unmatched keys are ignored.
- `ACCEPT` captures `originalMetadata`; `UNDO` reverts to it and restores the snapshot.
- `DISMISS` no longer deletes the row; `CLEAR` does.
- `UNDO` on a row with no armed snapshot is a no-op, not an error.
- The existing `ACCEPT` no-op branches (no row, resolved row, advisory-only proposals)
  keep behaving identically with `fixes` omitted.

**Client**

- The merge: a live item and a seeded row for the same book render once, not twice.
- Each of the six affordances in §5 issues the right action + `fixes` shape.
- Grid eviction after upload and after scan, both seen-to-fail (§6.2).
- The re-homed target self-heal (§6.3), including that it does **not** fire for
  non-admins or when no target is held.

**Cost**

`Library.pendingFixes` must be measured in the first task that adds a document reading
it — see §9.1.

**Gates:** server + client suites, `test:cost`, root lint, client lint, codegen and SDL
in sync. Same set as steps 6–8.

---

## 9. Risks and stop conditions

### 9.1 `Library.pendingFixes` is unpaginated — MEASURED, resolved

It is `[PendingFix!]!` with no `first`. A pre-planning hand-probe via `costOf`/`accepts`
against the real schema, before `PendingFixRowFragment` was designed, checked a LEAN
selection (`undo { kind }` only, omitting `appliedFixes`):

| Selection | Breadth | Complexity | Verdict |
|---|---|---|---|
| Everything, incl. `undo { proposals { … } appliedFixes { … } }` | 60 (60.0%) | 5703 (17.3%) | accepted |
| LEAN pre-planning probe — `undo { kind }` only, no `appliedFixes` | 30 (30.0%) | 2703 (8.2%) | accepted |
| `Book.pendingFix` with `state { proposals { … } }` (book-edit) | 14 (14.0%) | 14 (0.0%) | accepted |

That LEAN row is **not what this step ships**. `appliedFixes` is a field the UI genuinely
renders (the auto-fix toast in `page/upload/index.tsx`, and `FixReview`), so
`PendingFixRowFragment` selects it. The real shipped shape, measured via
`npm run test:cost -w app/server` against the shipped `LibraryPendingFixesDocument`:

| Selection | Breadth | Complexity | Verdict |
|---|---|---|---|
| **What this step ships** — `LibraryPendingFixesDocument` (full `PendingFixRowFragment`, incl. `appliedFixes`) | **55 (55.0%)** | **4807 (14.6%)** | accepted |

**No `first` argument is needed and the stop condition does not fire.** The shipped
shape sits at 55% of breadth and 14.6% of complexity, both under the 0.7 headroom gate —
with less margin than the LEAN probe suggested, but still comfortably inside it.

`BookResolvePendingFixDocument` (the accept/dismiss/undo/clear mutation, which also
selects `PendingFixRowFragment` via `library { pendingFixes }`) ships at breadth **67
(67.0%)**, complexity 4819 (14.6%) — the tightest margin in the manifest. This
effectively freezes `PendingFixRowFragment`: roughly two more fields on it would trip the
70% breadth gate. Step 10 should treat any growth to this fragment as needing a fresh
`test:cost` run before merging, not an assumption that headroom still exists.

Re-measure if the fragment grows: `npm run codegen -w app/client` then
`npm run test:cost -w app/server`.

### 9.2 `DISMISS` semantics change

Safe for users — no client consumer exists — but it rewrites existing server tests. The
diff will look larger than the behaviour change is.

### 9.3 `UNDO` can fail

It routes through `applyEpubChanges`, so it can return a hash collision or validation
error, exactly as today's PATCH-based undo can fail. The client must surface it and
leave the snapshot armed for a retry, rather than optimistically clearing it.

### 9.4 Id rotation remount

§4.4. The remount was chosen, not discovered. The rotation's effect on the merge JOIN
was neither — it was missed here and by every per-task review, and only the whole-step
review caught it (C-1). §4.3 and §4.4 above carry the correction.

---

## 10. Definition of done

- `/upload` and the Replace modal read and mutate entirely over GraphQL; the only REST
  left in them is the multipart upload POST and the staging POST.
- `provider/upload/api.ts` and `use-patch-book-metadata.ts` deleted.
- The library grid refreshes after both an upload and a scan, each covered by a
  seen-to-fail test.
- The stale-target self-heal fires from the GraphQL read.
- `useWithTargetUser` at 5 by direct count, or the deviation explained in the sweep.
- All gates green.

---

## 11. Known behaviour changes

1. **Undo after a reload still reverts metadata, by a different route.** Today the
   client round-trips `originalMetadata` through REST and re-PATCHes it itself. After
   this step the server holds it and reverts internally on `UNDO`. Had `ACCEPT` not been
   made to capture it (§3.1), this would have silently regressed into "restores the
   proposal list, leaves the metadata applied" — the failure mode is unchanged, only its
   cause moved.
2. **Per-fix Reject now persists.** Today it mutates local state and reaches the server
   only via the debounced sync effect; it becomes an explicit mutation.
3. **The nav badge survives a reload** (§6.4).
4. **A seeded row remounts after Accept** (§4.4). The live item it merges with does
   NOT remount — it follows the rotated id via `remapBookGlobalId` instead.
5. **The Replace modal lost its `SeverityCounts` validity chips.**
   `BookAnalyzeReplacePayload` omits `counts`/`threshold` by a deliberate, reviewed
   spec-1 decision (`analyze-replace.ts:50-67`). Ruled accepted for step 9 (task 12
   sweep): the replace workflow stays fully usable — both `valid` and the confirm gate
   survive, and `valid` already encodes the threshold verdict — so what is lost is
   granularity (the per-severity counts), not capability. Reversible by adding two
   fields to the payload; the data is already computed server-side.
6. **`analyzeReplacement` swallows typed server errors into a generic message**, while
   `commitReplacement` surfaces them via `commitError`. This is PARITY with the REST
   original (which returned `undefined` on `!res.ok`), not a regression this step
   introduced — but the asymmetry is real and worth closing in a later step.
7. **`BookResolvePendingFix` ships at 67.0% breadth**, the tightest margin in the
   manifest (see §9.1), which effectively freezes `PendingFixRowFragment` — roughly two
   more fields on it would trip the 70% CI gate.

## 12. Sweep verification (task 12) — record for step 10

- `provider/config/provider.tsx` uses a raw `fetch('/api/public-config')` — a FIFTH REST
  seam the parent spec's four-seam sweep assertion would not catch, because it never
  goes through `apiFetch`. It is genuinely pre-auth (the password-reset page renders the
  library name before login) and `Query.config` is authenticated, so it cannot move.
  Step 10 should decide whether to widen the sanctioned-seam list to five rather than
  treat this as an oversight.
- `Library.pendingFixes` pagination headroom at this step's shipped shape: breadth 55%
  (`LibraryPendingFixesDocument`) and 67% (`BookResolvePendingFixDocument`, the tighter
  of the two). Both are under the 70% gate today, but `BookResolvePendingFixDocument`
  has only ~3 points of breadth left before it trips — if the fragment grows again,
  re-measure before merging, don't assume headroom.
