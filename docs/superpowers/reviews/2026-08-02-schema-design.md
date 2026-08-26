> Preserved 2026-08-02 from the pre-client-polish planning session scratchpad. Commit reviewed: `8aa685c5`. Covers: fresh-eyes design review of the Bookplate GraphQL schema (`app/server/graphql/schema.generated.graphql`) — blockers/should-fix/nice-to-have/fine-as-is, judged as a client developer meeting the schema with no access to the design docs. Content below is verbatim from the source review.

# Bookplate GraphQL schema — fresh-eyes design review

**Artifact reviewed:** `app/server/graphql/schema.generated.graphql` (922 lines, 72 object types, 26 inputs, 24 unions, 11 enums) at `8aa685c5`, plus resolvers under `app/server/graphql/schema/`.
**Stance:** judged as a client developer meeting it today, with no access to the design docs. Docs consulted only to check whether a wart was adjudicated or accidental.
**Scoring:** Blocker = fix before the client starts. Should-fix = cheap now, expensive once fragments freeze (renames, arg reshapes, id semantics). Nice-to-have. Fine-as-is = checked, passes.

**Counts: 4 Blockers · 8 Should-fix · 8 Nice-to-have · 14 Fine-as-is.**

---

## Headline

The schema is unusually well-built for a first cut: naming is consistent across all 23 mutations, auth is uniformly gated, pagination shares REST's actual cursor functions rather than a re-derivation, and five of the seven app screens genuinely collapse to one query — two of them (admin devices, admin users) collapsing an N+1 the REST client has today.

What it gets wrong is concentrated in one place: **the boundary between the Relay ID dialect and the raw content-hash dialect**. The `book-relay-id` change removed `Book.bookId` on the stated premise that "No other output field exposes the raw hash." That premise is false as shipped — four output/arg positions still speak raw hashes — and the resulting one-way street is the root of Blockers 1 and 2 and a contributor to Blocker 3. Everything else is small.

---

# BLOCKERS

### B1. Book has two id dialects and no bridge between them

`Book` exposes only the Relay global ID (`Book.bookId` removed at `b8fb8976`). But raw content-hash book ids are still all over the schema, and none of them can be joined back to a `Book`:

| Position | File | Dialect |
|---|---|---|
| `Library.book(id: String!)` | `app/server/graphql/schema/library/model.ts:100-109` | raw hash |
| `Progress.document: String!` | `app/server/graphql/schema/progress/model.ts:6` | raw hash |
| `LinkedDocument.oldId` / `.newId` | `app/server/graphql/schema/linked-document/` | raw hash |
| `Suggestion.value` (for `SuggestionType.BOOK`) | `book-store.ts` `getSearchSuggestions` | raw hash |
| `BookLinkDocumentInput.documentId`, `BookUnlinkDocumentInput.documentId` | book mutations | raw hash |
| `Book.id`, all 10 book mutation inputs | `book/model.ts:24` | `base64(Book:["userId","bookId"])` |

The design doc at `docs/superpowers/specs/2026-08-02-book-relay-id-design.md` asserts *"No other output field exposes the raw hash: `coverUrl`/`downloadUrl` are server-computed strings and `ScanStatus` carries no book ids."* It checked the two fields it removed and missed the four above.

Concrete consequences for the client:

1. **Routing breaks.** `app/client/src/page/book/index.tsx` is mounted at `/library/book/:id` keyed on the raw hash. From `Library.entries` a client can no longer produce one. It must either base64-decode the global ID in the browser (defeating the opacity the whole change was for) or move routes to URL-encoded global IDs — which embed a `userId`, so the *same book* has a different URL for its owner and for an admin, and today's stable, shareable content-hash URLs are gone.
2. **Lineage is unreadable.** REST's `GET /api/books/:id/lineage` returned `{ currentId, entries }`. `Book.lineage: [LinkedDocument!]!` dropped `currentId`, and `Book` no longer exposes the raw id it would be compared against — so the lineage modal (`app/client/src/provider/book/hook/use-book-lineage.ts`) renders `oldId`/`newId` pairs with nothing to anchor them to.
3. **Search suggestions dead-end.** Picking a `BOOK` suggestion yields `Suggestion.value` — a raw hash. The only door it opens is `Library.book(id:)`, which is a *second* round trip from a field that already knew which book it meant.

**Fix (pick one, both are additive):** re-add a raw-id output on `Book` named for what it is (`documentId: String!` — it *is* the kosync document id), **or** add the missing typed edges: `Progress.book: Book`, `LinkedDocument.book: Book`, `Suggestion.book: Book`. The second is the better schema; the first is one line. Doing either after fragments freeze means touching every book fragment in the app.

---

### B2. `Progress` has no link to its `Book` — the schema hard-codes the client's worst remaining N+1

Today `app/client/src/component/my-progress-row/index.tsx` and `.../component/user-progress-row/index.tsx` each issue `GET /api/books/:id` **per progress row**, purely to render `titleSort || title`. Worst case on `/users`: users × progress-entries requests.

GraphQL preserves this exactly. `Library.progress` yields `Progress { document, percentage, timestamp, ... }` with no `book` edge, so the "My progress" settings card and the admin users screen must fire one aliased `Library.book(id: $doc)` per row — the textbook per-item-query-that-should-be-a-connection-field pattern the review brief asks about.

This stings more because the *sibling* N+1 on the same screen **is** fixed: `viewer { users { library { progress(first: 20) { … } } } }` collapses the per-user `GET /api/users/:username/progress` loop into one query. So the admin screen goes from two nested N+1s to one — and the one that remains is a missing field, not a missing capability.

Note also that `Library.progress` is the only ordering in the schema that is `timestamp DESC` (recently-read). `Library.entries(filter: {status: IN_PROGRESS})` is title-ordered, so it is **not** a substitute for a "continue reading" shelf.

**Fix:** `Progress.book: Book` (nullable — a document id can outlive its book). The batching pattern already exists three times in this codebase (`progress-loader.ts`, `pending-fix-loader.ts`, `chapter-spine-map-loader.ts`); this is a fourth instance of the same shape.

---

### B3. `coverUrl` / `downloadUrl` / `thumbnailUrl` are broken for admin sessions and drop the cache token

`app/server/graphql/schema/book/model.ts:60-65`:

```ts
coverUrl:     t.string({ resolve: (book) => `/api/books/${book.id}/cover` }),
downloadUrl:  t.string({ resolve: (book) => `/api/books/${book.id}/download` }),
thumbnailUrl: t.string({ args: { width: … }, resolve: (book, args) => `/api/books/${book.id}/cover?width=${args.width}` }),
```

Both REST handlers go through `resolveOwner` (`app/server/routes/ui.ts:150-171`), which **400s an admin session that does not pass `?user=<username>`**:

> `res.status(400).json({ error: 'user query parameter is required for admin sessions' })`

The admin library-switcher (`app/client/src/page/library/index.tsx` + `provider/user/hook/use-user-list.ts`) is exactly this case. Today the client compensates with a `withTargetUser()` wrapper. Under GraphQL the URL is handed over pre-built with no `?user=`, so **every cover and every download link is a 400 for an admin browsing a user's library.** The resolver has `book.userId` and `context.loadOwner` right there; it just doesn't use them.

Second, smaller defect in the same three fields: the cover endpoint switches to `Cache-Control: max-age=31536000, immutable` only when a non-empty `v` query param is present (`ui.ts:964`), and the client mints it from `mtime` (`app/client/src/lib/cover-url.ts:19`). The schema's URLs carry no `v`, so every GraphQL-sourced cover falls back to `max-age=0, must-revalidate` — a real caching regression on the grid, where covers are the dominant request. And because `coverUrl` has no query string while `thumbnailUrl` does, a client appending `v` itself has to branch on `?` vs `&`.

**Fix:** build the whole URL server-side — `?user=` when the viewer is an admin, and `&v=<mtime>` always. Both inputs are already in scope.

---

### B4. Four mutated entity types have no cache key

A normalizing client cache (Houdini, which is phase 2, and Apollo alike) keys on `id`. These four have none, and all four are things mutations change:

| Type | Key today | Consequence |
|---|---|---|
| `Progress` | none (`document` is unique per user but not named `id`) | `progressSet` / `progressDelete` cannot merge into `Book.progress` or `Library.progress` |
| `Validation` | none, and no `book` back-edge | `bookValidate`'s payload is un-attachable — see S1 |
| `PendingFix` | none (has `book`, which *is* keyed) | `bookResolvePendingFix` cannot update `Library.pendingFixes` |
| `ScanStatus` | `jobId: ID!` — **named wrong** | `Subscription.scanProgress` events will not merge into `Library.scanStatus` |

`ScanStatus.jobId → id` is the one that must happen before the freeze: it is a **rename**, the expensive-after-freeze class. The other three are additive, but the client's cache configuration is an architectural decision made *before* the first fragment is written, not after — which is what makes this a blocker rather than a should-fix.

The three types that got this right — `Book`, `Series`, `User` (all `prismaNode`) and `Device` and `Library` — show the intended shape. `MetadataFix`, `LinkedDocument`, `Identifier`, `InputIssue`, `Suggestion`, `UndoSnapshot` are genuine value objects and correctly have no id.

---

# SHOULD-FIX

### S1. Mutation payloads don't reach the parent the mutation invalidates

Surveying all 23 payloads against "what does the client's cache need after this?":

| Payload | Has | Missing | Forced refetch |
|---|---|---|---|
| `BookValidatePayload` | `validation` | `book` | **Yes** — `Validation` is un-keyable (B4), so `Book.validation` never updates. The most common action on the book-detail screen. |
| `BookResolvePendingFixPayload` | `book` | `library` | Yes — `Library.pendingFixes` and the nav badge |
| `DeviceCreatePayload` | `device` | `viewer` | Yes — `Viewer.devices` list insert |
| `DeviceDeletePayload` | `deletedDeviceId: String!` | `viewer`, and a global ID | Yes — see N4 |
| `UserRegisterPayload` | `user`, `password` | `viewer` | Yes — `Viewer.users` list insert |
| `UserDeletePayload` | `deletedId`, `deletedUserId` | `viewer` | Partly — `deletedId` evicts, but the list doesn't shrink |

Payloads that get it right and set the precedent: `BookDeletePayload { deletedId, library }`, `ProgressDeletePayload { deletedDocument, library }`, `ProgressSetPayload { progress, library }`, `LibraryScanPayload { library, scanStatus }`, `BookClearEditionsPayload { book, clearedCount }`, `DeviceEnableUserPayload { device, user }` (both sides of the edge — nicely done).

`BookValidatePayload` is the one worth calling a near-blocker: it is the only payload that returns an object the cache is structurally incapable of placing.

### S2. Validation severity counts are gone

REST's `ValidationReport` (`app/server/services/epub-validator.ts:74`) carries `counts: Record<Severity, number>`, and there is a summary-string builder at `:108-115` producing "3 errors, 5 warnings". GraphQL's `Validation` has `valid`, `threshold`, `validatedAt`, and `messages` **as a connection** — so a client cannot render the summary without draining every page of messages.

Same gap in two more places:
- `EpubValidationError` — the thrown store error carries `counts` (`epub-validator.ts:121,134`); the GraphQL type exposes only `message` + `messages`.
- `BookAnalyzeReplacePayload` — REST's `POST /api/books/:id/replace/analyze` returns `counts` **and** `threshold`; the GraphQL payload has neither.

**Fix:** a small `ValidationCounts` object (or `Validation.messageCount(severity: ValidationSeverity)`) on all three. `ValidationMessage.segments` is *correctly* omitted — it's a pure presentation split the client can re-derive.

### S3. `acceptedFixKeys` requires a key the schema never exposes

`BookReplaceInput.acceptedFixKeys: [String!]!` is required, but `MetadataFix` has eight fields and none of them is a key. The format is `` `${field}:${kind}:${from}` `` and it is **already duplicated**:

- `app/server/services/epub-import-pipeline.ts:40` — `export const fixKey = (f: MetadataFix): string => …`
- `app/client/src/provider/book/hook/use-upload-queue.ts:60` — an identical re-implementation

A client dev reading only the SDL cannot construct a valid `acceptedFixKeys` value at all. Expose `MetadataFix.key: String!` and delete the client copy; two independent copies of a string format that must agree is exactly the drift this codebase elsewhere refuses to accept.

### S4. Input identifier naming is inconsistent across entity families

All ten book mutations take `id: ID!`. Nothing else does:

- `UserDeleteInput.userId`, `UserResetPasswordInput.userId`, `UserRegenerateSyncPasswordInput.userId`, `LibraryScanInput.userId` — all single-target inputs that should be `id` by the book precedent
- `DeviceDeleteInput.deviceId`, `DeviceUpdateInput.deviceId` — same
- `DeviceEnableUserInput { deviceId, userId }`, `DeviceDisableUserInput { deviceId, userId }`, `ProgressDeleteInput { document, userId }` — these genuinely need two and are correctly named

The rule is legible once you notice it ("`id` when the mutation names one thing") but it is violated by six inputs. Renames are the expensive-after-freeze class; pick one convention now.

### S5. You start a scan with a `userId` and watch it with a `libraryId`

```graphql
libraryScan(input: { userId: ID! }): LibraryScanResult          # User global ID
scanProgress(libraryId: ID!): ScanStatus!                       # Library global ID
```

`Library`'s global ID is the user id under a different type name (`library/model.ts:66-71`), so the two are the same bytes wearing different `__typename` prefixes and are **not** interchangeable through `encodeGlobalID`. The round trip works (`LibraryScanPayload.library.id` is what the subscription wants), but a client dev holding a `userId` from the switcher and wanting to subscribe has to go fetch a library first. Make `libraryScan` take `libraryId: ID!` and it's symmetric.

### S6. `Progress.deviceId` and `Device.id` are unrelated, identically-shaped, and undocumented

`Progress.deviceId: String!` is a KOReader-reported sync device string. `Device.id: ID!` / `DeviceDeleteInput.deviceId: String!` are a Bookplate device-profile row. Different namespaces, same name, both `String`-ish, no description on either. A client dev will try to join `Progress.deviceId` to `Viewer.devices` and get an empty result with no explanation. `Progress.device` (the human-readable name) makes it worse by looking like the other half of the pair.

Cheapest possible fix: one description on each. Better: rename to `syncDeviceId` / `syncDeviceName`.

### S7. Description coverage is inverted — errors are documented, domain types are not

Measured over the SDL: 35 type-level and 60 field-level description blocks. Almost all of them sit on the 14 `UserError` types, the `Mutation` fields, and `ScanStatus`/`ScanResult`. Every domain type has **zero** type-level description: `Book`, `Library`, `Series`, `Device`, `User`, `Viewer`, `Progress`, `Validation`, `PendingFix`, `MetadataFix`, `Config`, `Suggestion`, `Identifier`, `LinkedDocument`, `UndoSnapshot`, and all 26 inputs.

The ones that will actually cost a client dev time, in priority order:

1. **`MetadataFix`** — 0/8 fields documented, and it holds the schema's only `JSON` leaf (`changes`). What is `kind`? When is `to` null but `toChips` set? What is a "chip"? (Answer, from `epub-import-pipeline.ts:244-247`: a `subjects-split` fix carries an *empty* `changes` and its payload lives in `fromChips`/`toChips` — completely unguessable from the SDL.)
2. **`Book`** — 0/29 fields documented. `chapterSpineMap` vs `chapterNames`; `size` units; `mtime` vs `addedAt`; `titleSort`/`authorSort` derivation; `hasCover` vs a non-null `coverUrl` that may 404.
3. **`Library.book(id: String!)`** — the single most confusing arg in the schema (B1) and it has no description at all.
4. **`Progress.document`** — the join key for the entire progress model, undocumented. (`Progress.position` *is* documented — the one field that needed it least.)
5. **`Viewer.syncPassword`** (null for admins, `viewer/model.ts:38`) and **`Viewer.library`** (null for admins) — two nullables whose null means "you are an admin", not "missing".
6. **Enums**: `LibraryEntryStatus`, `LibraryEntryType`, `PendingFixResolution`, `UndoKind`, `ValidationThreshold.NONE` (what does thresholding at NONE mean — reject nothing, or reject everything?).

### S8. No series-level progress aggregate — the grid must over-fetch to draw a progress bar

`app/client/src/component/series-row/index.tsx` renders a series progress indicator and a `"${bookList.length} book series"` label. REST supplies this for free: the paged `/api/books` response includes a flat `books` side-table with **every member of every series on the page**.

Under `LibraryEntry = Book | Series`, the label is fine (`Series.bookCount` — strictly better than the client's `bookList.length`, which today is computed from a partial cache). The progress bar is not: there is no `Series`-level progress field, so the grid query has to pull `books(first: 100) { edges { node { progress { percentage } } } }` for **every series row on the page** to compute it. That's the schema's one real over-fetch trap.

**Fix:** `Series.completedBookCount: Int!` (or `Series.progressPercentage: Float!`). Cheap on the server, and it removes a 20×100 nested selection from the app's most-run query.

---

# NICE-TO-HAVE

### N1. No `totalCount` on any connection
REST offers none either, so this is honest parity, not a regression — and it is additive later. But it is net-new UI capability: there is no "N books" anywhere in the app today precisely because `/api/books` can't produce one. `Library.entries` is the place.

### N2. Device membership is per-user, so "Save" isn't atomic
`app/client/src/component/device-form/index.tsx` `reconcileUsers` fires a `Promise.all` of one `deviceEnableUser`/`deviceDisableUser` per delta. GraphQL reproduces this shape exactly. A `users: [ID!]` field on `DeviceUpdateInput` (set-semantics) would make the save one round trip and one transaction.

### N3. Six single-member unions, and the nullable-mutation convention on top of them
Single-member: `BookClearEditionsResult`, `BookDeleteResult`, `BookValidateResult`, `UserDeleteResult`, `UserRegenerateSyncPasswordResult`, `UserResetPasswordResult`. (The relay-id doc predicted "5 `InvalidInputError` drops" — accurate, but only *three* of those five landed at one member; `BookRegenChaptersResult` and `BookResolvePendingFixResult` retained 3 and 4. The other three single-member unions predate that change.)

As future-proofing this is defensible and I'd leave it. What makes it grating is the interaction with the **nullable-mutation-field** convention: 20 of 23 mutations return `Result` (nullable) with the description *"Resolves to null when the book does not exist."* So for `bookValidate` the client writes three branches — `null`, `... on BookValidatePayload`, and an unreachable default — for a mutation with exactly one outcome.

The nullability rule itself is *principled* and I'd keep it (see Fine-as-is): nullable ⟺ the mutation looks something up; the only three non-null are `deviceCreate`, `progressSet`, `userRegister`, which don't. But a `NotFoundError implements UserError` member would fold the null branch into the union, collapse three branches to two, and make all six degenerate unions non-degenerate in one move. Worth considering before the freeze, since adding a union member later is a breaking change for exhaustive clients.

### N4. `Device` is not a `Node`, and `deletedDeviceId` can't drive an eviction
Given that `Viewer.devices` and `Device.enabledUsers` are the only entry points and the app never deep-links a device, the raw-id treatment is genuinely fine and the boundary is defensible. Two rough edges: `Device.id: ID!` sits right next to mutations taking `deviceId: String!` (same value, two type names), and `DeviceDeletePayload.deletedDeviceId: String!` isn't the global ID a cache evicts by — which is exactly the asymmetry the relay-id doc noted and consciously left ("Non-Node deletes are untouched — they have no global ID to return").

### N5. `Book.deviceEditionCount` and `Book.lineage` are unbatched per-book store calls
`book/model.ts:210` calls `editionStore.countForBook` and `:183` calls `getBookLineage`, both once per `Book`, with no loader — while `progress`, `pendingFix`, and `chapterSpineMap` all *do* go through request-scoped batchers. On the book-detail screen (one book) this is correct and the comments explain why. Across `Library.entries` (20 books) it is 20 extra queries each. Nothing in the SDL warns a client off selecting them on a list.

### N6. `BookAlreadyExistsError` is genuinely unreachable
Verified programmatically: it is the only `UserError` implementor that is a member of no union, and no field anywhere is typed `UserError`. It's reachable only as a possible-type of an interface nothing returns.

This is **documented and deliberate** (spec §Error model, and it's kept for `to-result.ts`'s exhaustive `instanceof` coverage of all seven store error classes; its only throw site is `addBook`, reached by the scan pipeline and `POST /api/books/upload`, which stays REST). Correct call — but a client's codegen will emit a type it can never receive. A one-line `@deprecated` or a description saying "not currently reachable; reserved for the upload seam" would stop that being a puzzle.

### N7. `@pothos/plugin-errors` is registered but never activates
`builder.ts:68`, explained honestly at `:58-63` — every error type is a plain data shape carrying `owner: Owner`, not a class, so `extractAndSortErrorTypes` can never match and no field declares `errors:`. Zero schema effect; pure dependency and plugin-chain weight. Drop it in the phase-3 cleanup.

### N8. `Viewer` duplicates three fields with `Viewer.user`
`Viewer.username` / `Viewer.mustChangePassword` mirror `Viewer.user.username` / `.mustChangePassword`, and `Viewer.library` mirrors `Viewer.user.library`. Harmless — and `Viewer.username` is load-bearing because `Viewer.user` is null for the config-file admin while `Viewer.username` is not — but a client dev will pick one at random per component.

---

# FINE-AS-IS (checked, passes)

1. **Mutation naming.** All 23 follow `entityVerb` + `<Op>Input` / `<Op>Payload` / `<Op>Result`. Zero exceptions. This is the schema's strongest consistency property.
2. **Enum conventions.** All 11 enums are SCREAMING_SNAKE with no stringly-typed leaks; `CoverFit`, `ValidationSeverity`, `ScanState`, `ScanPhase`, `LineageType`, `UndoKind`, `PendingFixResolution`, `SuggestionType`, `LibraryEntryStatus`, `LibraryEntryType`, `ValidationThreshold`. Values map cleanly onto the lowercase DB/store representations at the resolver boundary.
3. **Mutation-field nullability is principled, not accidental.** Nullable ⟺ the resolver looks a target up and may not find it. The only three non-null (`deviceCreate`, `progressSet`, `userRegister`) are exactly the three that create rather than locate. The convention is stated on every affected field's description.
4. **`UserError` interface with no field returning it is still useful.** `... on UserError { message }` is legal inside every result union (intersecting possible types), so a client gets one shared fallback fragment across all 24 unions and only special-cases the errors it acts on. Not dead weight.
5. **`EpubValidationMessage` vs `ValidationMessage` as distinct types.** Correct, not duplication: a rejected upload has no persisted row and therefore no `seq`. Reusing the Prisma-backed type would have fabricated a field.
6. **Filter parity with REST is complete.** `LibraryFilter` covers all six REST dimensions (`query`, `author`, `seriesName`, `subjects` AND-ed, `status`, `entryType`) with the same defaults and clamps (take 20, range 1..100 — `library/model.ts:123` matches `ui.ts:527`). `SearchSuggestionsFilter` covers all three of `/api/search/suggestions`' filter params, with the same group-suppression semantics.
7. **Sort parity.** REST offers **no** sort or order parameter on any list endpoint, and neither does GraphQL. Verified across `/api/books`, `/api/series`, `/api/my/progress`, `/api/users`, `/api/users/:username/progress`, `/api/devices`. Not a gap. (Side note for the migration: `app/client/src/provider/book/hook/use-book-list.ts:62` re-sorts the local cache by raw `title.localeCompare`, which *disagrees* with the server's `sortKey` cursor order — the GraphQL cut should drop that client sort, not port it.)
8. **Pagination is genuinely shared with REST, not re-derived.** `Library.entries` and `Library.progress` call `decodeCursor` / `decodeProgressCursor` — REST's own functions — and forward the store's `nextCursor` untouched as `endCursor`. Backward pagination is rejected loudly with a machine-readable `extensions.code` (`BACKWARD_PAGINATION_UNSUPPORTED`, `pagination.ts:23-34`) rather than silently returning the leading page, and the two fields that reject it say so in their SDL descriptions. `Series.books` and `Validation.messages` are Prisma `relatedConnection`s and *do* support backward — the asymmetry is real but correctly signposted by the presence/absence of the description.
9. **Connections vs plain lists is a defensible call everywhere.** Paginated: `entries`, `progress`, `Series.books`, `Validation.messages`. Plain lists: `Library.series`, `subjects`, `authors`, `pendingFixes`, `Viewer.users`, `Viewer.devices`, `Device.enabledUsers`, `Book.identifiers`, `Book.lineage`. Every one of the plain ones is bounded by something small and is rendered whole. `Library.progress` being a connection (it grows unbounded with every book opened on any device) is the right call and matches REST.
10. **Five of seven screens are one query.** Library grid (`entries` + `Book.progress` + `thumbnailUrl`, modulo S8); book detail (metadata + `validation { messages }` + `lineage` + `pendingFix { state { undo } }` all in one — this is a *big* win over today's four lazy REST calls); series detail (`seriesByName` + `Series.books` — and it **fixes a live bug**: `app/client/src/provider/book/hook/use-series-book-list.ts` today filters a partial client-side cache, so deep-linking a series whose books are past page 1 renders "Series not found"); admin devices (`Device.enabledUsers` collapses the per-device `/api/devices/:id/users` fetch); settings/account.
11. **Scan progress is a strict improvement.** `Subscription.scanProgress` + `Library.scanStatus` as the reconnect read replaces a 2000 ms poll loop (`use-scan-library.ts`). `ScanStatus` nullable ⟺ REST's `{ status: 'idle' }`. `ScanResult.imported: [Book!]!` upgrades REST's id list into real books. `authorizeOnSubscribe: true` is set and load-bearing.
12. **Admin "act as user" is cleaner than REST.** `?user=<username>` becomes `Query.user(id).library`, with `Viewer.library` correctly null for the config-file admin. Genuinely better modelling. (Its one leak is B3.)
13. **The staged-upload seam is complete, not half-migrated.** `POST /api/books/replace-staging` (`ui.ts:1336`) and `POST /api/books/cover-staging` (`ui.ts:1383`) both exist and mint the `stagedUploadId` / `stagedCoverId` that `bookAnalyzeReplace`, `bookReplace`, and `bookUpdateMetadata` consume. Typing them as `String` rather than `ID` is right — they're opaque service tokens, not node ids. `StagedUploadNotFoundError`'s description honestly names all four indistinguishable causes.
14. **No dead fields found** beyond `ScanResult.importedFilenames`, which is documented REST parity with no current client consumer and is correctly explained in its own description. I checked `Book.chapterSpineMap`/`chapterNames` (used by SetProgressModal), `Series.totalSize`/`totalPages` (series page), `Book.deviceEditionCount` (book detail), `User.progressCount` (admin user row), `Config.maxConcurrentUploads` (REST upload queue — no GraphQL consumer by design, worth a description), `Library.seriesNextIndex` (book edit form), `Library.subjects`/`series` (book edit form). All live.

---

# Carried limitation worth restating before a freeze

Admin sessions have no `userId`, so they **cannot stage files** and therefore cannot run `bookAnalyzeReplace` / `bookReplace` / cover updates through GraphQL at all — they retain that capability only via the legacy REST routes (spec 1, §Seams that stay REST, recorded 2026-08-01). This is not new and not a schema defect, but it means the client cannot fully drop REST for admins, and the phase-3 route deletion silently makes the loss permanent. It should be an explicit decision, not a consequence.

---

# Suggested order of work before the client starts

1. **B1** — add `Progress.book`, `LinkedDocument.book`, `Suggestion.book` (preferred) or re-add a raw `Book.documentId`. Decide the routing story at the same time.
2. **B2** — falls out of B1 if you take the edges route.
3. **B3** — one resolver change to three fields; add `?user=` and `&v=`.
4. **B4** — rename `ScanStatus.jobId → id` (the only freeze-deadline rename), add `id` to `Progress` / `Validation` / `PendingFix`.
5. **S1** — `book` on `BookValidatePayload`; parent refs on the five others.
6. **S3, S4, S5** — `MetadataFix.key`; input-arg renames; `libraryScan(libraryId:)`. All renames/additions that get expensive after the freeze.
7. **S2, S6, S7, S8** — counts, the `deviceId` collision, descriptions, `Series` progress aggregate. Additive; can land during phase 2.
8. Nice-to-haves and the plugin cleanup — phase 3.
