# Spec 2, Step 7 — Book edit — Design

Status: approved (design), 2026-08-17
Parent spec: `2026-08-03-apollo-client-migration-design.md` (§9 sequencing row 7). Read its **§14**
(lessons from executing steps 0–2) and **§15** (known behaviour changes) before planning.
Predecessor: `2026-08-11-step6-book-detail-series-design.md` — step 6's identity-seam lessons bind
this step directly; see §4.
Base: `a2cdf000`, server 2012/2012, client 1110/1110, `test:cost` 33/33, lint + codegen + SDL clean,
branch pushed.

## User rulings

- **Scope is metadata + staged cover only.** Not the pending-fix guard, not the upload queue.
- **The cover stages on Save**, not when the file is picked.

## 1. Scope correction — §9 row 7 is stale

The parent spec's row 7 reads "Book edit — staged cover, metadata, validation, pending fixes,
lineage". Two of those five shipped in step 6:

- **validation** — `Validation.counts`, the detail modal, and `editingBlocked` all landed there.
- **lineage** — `Book.lineage` and `bookUnlinkDocument` landed there; `use-book-lineage.ts` and
  `use-unlink-book-lineage.ts` were deleted.

A third is out by ruling:

- **pending fixes** — `page/book-edit`'s guard calls `usePendingFixesForBook`, which reads
  `useUploadQueue`'s **in-memory** items (`provider/upload/hook/use-pending-fixes-for-book.ts`), not
  the server. The queue also *writes* those rows over REST (`putPendingFix`/`deletePendingFix`).
  Migrating the guard alone would create two sources of truth for one piece of state; migrating the
  queue is step 9's work. **The `UploadFixGuardModal` path is untouched by this step.**

So step 7 is: the edit page's reads, the edit form, Save, and the two series helpers. Correct §9
row 7 in place when this step completes.

## 2. `BookEditDocument` — a separate document, not an extension

`BookDetailDocument` is NOT extended. The form needs `titleSort`, `authorSort` and `identifiers`,
which the detail page never renders, and `BookDetail` already measures breadth 50 (50.0%) against a
70% gate. A second document also keeps each screen's selection honest under the cost gate.

Rooted like every library-scoped screen (parent spec §2): `node(id: $libraryId) { id ... on Library
{ id book(id: $bookId) { … } } }` — `id` on the `Node` interface AND inside the inline fragment.

Selection, derived from the form's actual state initialisers
(`component/book-edit-form/index.tsx:83-161`): `id`, `documentId`, `title`, `titleSort`, `author`,
`authorSort`, `description`, `publisher`, `publishDate`, `series { id name }`, `seriesIndex`,
`subjects`, `identifiers { scheme value }`, `hasCover`, `coverUrl`, `validation { valid }`.

**Two shape changes the form must absorb:**

- `Book.series` is a `Series` object, not a string. The form's `series` state and its `isSeries`
  switch both read `book.series?.name`, and the diff compares against that.
- `Book.description` is `String!` — non-null. The form's `original.description ?? ''` fallbacks are
  dead once the source is GraphQL.

**Measure it before building on it** (step 6's §7 lesson, which paid off): `costOf()` in
`app/server/graphql/cost-test-support.ts`, numbers recorded in the document's doc comment per the
convention `graphql/book.ts` already sets.

## 3. Save — two phases, cover first

The form already computes a **partial** patch: every unchanged field is `undefined`
(`index.tsx:170-198`). That maps directly onto `BookUpdateMetadataInput`, whose fields are all
optional except `id`. No reshaping needed.

Save becomes, in order:

1. **Only if the cover changed:** `POST /api/books/cover-staging` with the bytes → a staged id.
   This is a **permanent REST seam** (parent spec §9.1) and stays REST forever.
   **No client staging helper exists yet** — a repo-wide grep for `cover-staging`/`replace-staging`
   in `app/client/src` returns nothing. Step 7 writes the first one. Build it as a small, focused
   module the replace flow (step 9) can reuse rather than inlining it in the form; step 9 needs the
   identical shape against `replace-staging`.
2. `bookUpdateMetadata({ id: book.id, …changedFields, stagedCoverId })`.

The server closes the failure gap between them: staged uploads carry a 30-minute TTL with a lazy
sweep and one-time `consume` (`services/replace-staging.ts`), so a staged cover orphaned by a failed
mutation cleans itself up. No client-side compensation is needed.

**The two phases fail differently and must say so.** "Couldn't upload the cover" and "couldn't save
your changes" are different problems for the user, and today's single multipart request cannot tell
them apart. Do not collapse both into one toast.

## 4. The identity seam — step 6's dominant defect class, and why it bites here

**Editing metadata changes the book's content hash**, so BOTH its raw id and its Relay global id
change on a successful save. Three consequences:

- **Navigate with the payload's new `book.id`**, never the id the page was opened with.
- **Evict the old cache entity** when the payload's `book.id` differs from the requested id — the
  same conditional eviction `use-regen-chapters.ts` already implements for the same reason.
- **The pending-fix guard needs the RAW id.** It stays on the raw-keyed upload queue, so it must be
  fed `book.documentId` (the display-only raw hash added in step 6), never `book.id`.

**This step must also close a known open gap.** `component/fix-review/index.tsx:239` passes a raw id
to `path.bookEdit()`. That is survivable only while this page resolves ids through REST; the moment
it queries `Library.book(id:)` — declared `t.arg.globalID({ required: true, for: book })` — that
link lands on an unrenderable page. It is the fourth instance of the defect class step 6's final
review found, and step 7 owns the page it breaks. The fix needs a global id at that call site;
determine where the upload flow can get one, and if it cannot, escalate rather than inventing a
client-side encoder — **the client never encodes or decodes a global ID.**

## 5. The two series helpers

`useSeriesNames` → `Library.series` (names only). `useFetchSeriesNextIndex` → `Library.seriesNextIndex(name:)`.
Both are small, both already have exact server counterparts. `useLibrarySubjects` is ALREADY on
GraphQL (step 5) and is not touched.

## 6. What retires

- **`useWithTargetUser`: 9 → 7.** Only `use-series-names.ts` and `use-fetch-series-next-index.ts`
  go — `BookEditForm` is their sole non-test caller.
  **`use-patch-book-metadata.ts` SURVIVES**, and an earlier draft of this spec wrongly predicted it
  would retire. It has a second caller: `use-upload-queue.ts:139` (step 9), whose own doc comment
  records that it depends on the returned `id` being the RAW hash because it threads it into further
  REST calls. Step 7 removes `BookEditForm` as a caller, nothing more. This is the same mistake
  step 6's surface map made about `use-fetch-book` — caught here only by running the transitive
  trace ([[dead-code-claims-need-transitive-traces]]) before planning rather than after.
  The surviving 7: `use-download-book` (permanent seam), `use-fetch-book`, `use-fetch-book-list`,
  `use-patch-book-metadata`, `use-replace-book`, `use-upload-book-list`, `use-upload-queue`.
- **`useBook` loses `page/book-edit`**, leaving `component/my-progress-row` and
  `component/user-progress-row` — both step 8. `useBook` and `use-fetch-book.ts` therefore SURVIVE;
  do not delete them.
- **`PatchBookMetadataResult.globalId` does NOT become dead — this prediction was wrong, corrected
  at task 8's sweep.** That field — both the REST response field and the client type — was added
  during step 6's final fix wave solely for this form's Save navigation, and this section originally
  predicted it would go unused once `BookEditForm` stopped calling `usePatchBookMetadata`. But step 7
  itself made it load-bearing again for a DIFFERENT caller: `use-upload-queue.ts`'s `applyPatch` and
  `undo` paths now read `patched.globalId` and thread it into the queue's own `bookGlobalId`, so a
  still-pending flag-only proposal's `FixReview` Edit link (which needs a global id, since
  `page/book-edit` now queries `Library.book(id:)`) stays correct after a patch rotates the item's
  raw `bookId`. `use-upload-queue.ts`'s own doc comment on `bookGlobalId` records this. **Do not
  remove `globalId` from either the client type or the `bookGlobalId` REST helper
  (`routes/ui.ts`)** — task 8's transitive trace confirmed four live call sites still populate it:
  the upload response, the pending-fixes reseed row, the metadata PATCH response, and the replace
  response.

## 7. Error handling and cache

Error surfacing follows the settled policy (parent spec §14.6): screen hooks return
`error: string | undefined`; a book the library does not have is `undefined` with NO error.
Mutation result unions are narrowed with `provider/apollo/unwrap-result.ts`.
`BookUpdateMetadataResult` is the richest union this migration has consumed — five error members
beside the payload: `BookHashCollisionError`, `BookNotValidatedError`, `EpubValidationError`,
`InvalidInputError`, `StagedUploadNotFoundError`. Verify that list against the SDL at implementation
time rather than trusting this sentence, and do not add branches the schema lacks.

Two of them are reachable in ways the REST form never had to express: a metadata edit rewrites the
file and can **collide with an existing book's hash**, and `StagedUploadNotFoundError` is precisely
the two-phase seam — a staged cover consumed, expired, or never found. Each needs a message a user
can act on, not a generic failure.

The one hand-written cache update is the conditional eviction in §4. Where Apollo's normalization
suffices, say so in the doc comment AND assert the cache, so a future normalization change is
caught — and where a hand-written update stays, demonstrate it failing without its update function.

## 8. Testing

Migrate the page and form tests to `renderWithApollo`/`renderHookWithApollo` (`test-utils.tsx`, real
`InMemoryCache` + `MockLink`). Carry over every existing case; name any judged inapplicable.

Standing disciplines bind, and two are worth restating because step 6 needed them:

- **Fragment masking is COMPILE-TIME ONLY here.** `FragmentType` is a type-only marker, `useFragment`
  an identity cast, `dataMasking` never enabled. Never assert `not.toHaveProperty(...)` to "prove
  masking" — prove it at the type level with `@ts-expect-error`.
- **Compose the test harness the way the app composes.** Step 6's clear-progress bug shipped because
  `ProgressProvider` was never mounted by the harness, so a whole provider's setters were silent
  no-ops. Before testing this page, check which providers it genuinely depends on.

## 9. Definition of done

- `page/book-edit` and `BookEditForm` read and save entirely over GraphQL; the cover stages first.
- `useWithTargetUser` is down to **7**, each survivor accounted for by name.
- `fix-review`'s `path.bookEdit()` call site passes a global id, or the blocker is escalated.
- Both suites green, lint + codegen + SDL clean, `test:cost` green with no document over 70%.
- §9 row 7 corrected; any user-visible divergence recorded in the parent spec's §15.

## 10. Out of scope

Steps 8–10: the pending-fix guard and upload queue, the progress screens, upload/replace, and the
final `apiFetch` sweep. Also out: the two follow-ups step 6 parked — `use-replace-book`'s now-live
`bookList` alias sweep, and the missing-`ProgressProvider` fixture gap in the two progress-row test
files. Both belong to the steps that own those files.
