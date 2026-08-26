# Step 6 surface map — regenerated 2026-08-13, corrected 2026-08-16 (task 13 sweep)

The step-6 design spec cites `scratchpad/step6-surface-map.md` (session-scoped). That file was
lost with its session; this is the regenerated evidence, kept under `docs/superpowers/` so it
survives. Originally measured at `ebc6ae53`; the survivor table below was corrected by task 13's
sweep, which found the original "12 retire / 8 survive" split undercounted survivors by one — see
the callout right after the retiring table (`use-fetch-book.ts`) for why, and parent spec §9's
`[^step6-count]` footnote for the fuller account.

## `useWithTargetUser` — 20 non-test consumers, 11 retired in step 6, 9 survive

Command: `grep -rn 'useWithTargetUser(' app/client/src --include='*.ts' --include='*.tsx' | grep -v '\.test\.'`

### Retired here (11) — one fewer than spec §5's original 12

| # | File | Why it retired |
|---|---|---|
| 1 | `component/book-row/from-book.tsx` | file deleted |
| 2 | `page/book/index.tsx` | cover comes from `Book.coverUrl` (server-built `?user=`/`v=`) |
| 3 | `page/series/index.tsx` | covers come from `Book.thumbnailUrl` |
| 4 | `provider/book/hook/use-book-lineage.ts` | → `Book.lineage` |
| 5 | `provider/book/hook/use-unlink-book-lineage.ts` | → `bookUnlinkDocument` |
| 6 | `provider/book/hook/use-clear-book-editions.ts` | → `bookClearEditions` |
| 7 | `provider/book/hook/use-delete-book.ts` | → `bookDelete` |
| 8 | `provider/book/hook/use-regen-chapters.ts` | → `bookRegenChapters` |
| 9 | `provider/book/hook/use-series.ts` | deleted (task 13) — zero non-test consumers; `page/series` now reads `useSeriesDetail` (`Library.seriesByName`) instead |
| 10 | `provider/book/hook/use-series-book-list.ts` | deleted (task 13) — its only two callers, `useMySeriesProgress`/`useUserSeriesProgress`, were themselves already unreachable (see below) |
| 11 | `provider/book/hook/use-validate-book.ts` | → `bookValidate` |

**`provider/book/hook/use-fetch-book.ts` was originally miscounted as a 12th retiree.** It does
not retire in this step: it backs `useBook`, which still has three non-test consumers —
`page/book-edit`, `component/my-progress-row`, `component/user-progress-row` — none of which this
plan touches (book edit is step 7, progress rows are step 8). This document's own "Hooks whose
consumers do NOT all retire here" section already said as much about `useBook`; it just didn't
draw the corollary for the hook `useBook` itself calls. Confirmed by `tsc --noEmit` staying clean
after task 13's other deletions and by `use-fetch-book.ts` still appearing in the
`useWithTargetUser(` grep at the sweep's tip.

### Surviving by design (9) — one more than spec §5's original 8, `use-fetch-book.ts` added

| File | Owner step |
|---|---|
| `provider/book/hook/use-download-book.ts` | permanent REST seam (§9.1) |
| `provider/book/hook/use-fetch-book-list.ts` | step 10 sweep (`BookProvider`) |
| ~~`provider/book/hook/use-fetch-book.ts`~~ | ~~step 7 (`page/book-edit`) / step 8 (`my-progress-row`, `user-progress-row`), via `useBook`~~ **dead — step 10** |
| ~~`provider/book/hook/use-fetch-series-next-index.ts`~~ | ~~step 7 (edit)~~ **retired in step 7** — migrated onto `SeriesNextIndexDocument` in place, no longer calls `useWithTargetUser` |
| `provider/book/hook/use-patch-book-metadata.ts` | step 7 (edit) — SURVIVES step 7; `use-upload-queue.ts` (step 9) is its second, and now sole, caller |
| ~~`provider/book/hook/use-series-names.ts`~~ | ~~step 7 (edit)~~ **retired in step 7** — migrated onto `SeriesNamesDocument` in place, no longer calls `useWithTargetUser` |
| `provider/book/hook/use-replace-book.ts` | step 9 (upload/replace) |
| `provider/book/hook/use-upload-book-list.ts` | step 9 |
| `provider/book/hook/use-upload-queue.ts` | step 9 |

**Updated at step 7's sweep (task 8, `2026-08-22`):** the two rows struck through above retired that
step — both hooks were migrated onto their GraphQL counterparts in place (not deleted), and neither
calls `useWithTargetUser` anymore. `useWithTargetUser` is down to **7** of this table's original 9;
see the parent spec's §9 `[^step7-count]` footnote for the current name-by-name list and count.

**Updated at step 8's sweep (progress screens, `2026-08-23`):** `use-fetch-book.ts`'s "owner step"
column above was wrong on both halves, not just the step-8 half. `page/book-edit` never actually
called `useBook` — step 7 built it on a differently-named NEW hook, `useBookEdit`
(`provider/book/hook/use-book-edit.ts`'s own doc comment says so explicitly), so that claim was
already stale the day step 7 shipped, this document just hadn't been re-checked against it. Step 8
retired the other half for real: `my-progress-row`/`user-progress-row` now read
`ProgressRowFragment` off GraphQL instead of calling `useBook`. Net: `useBook` (and, transitively,
`use-fetch-book.ts`, which only `useBook` calls) has **zero** non-test, non-barrel consumers as of
this sweep — confirmed by `grep -rn 'import.*useBook\b' app/client/src` returning nothing outside
`provider/book/index.ts`/`hook/index.ts`'s own re-exports. Left in place, not deleted: step 10 owns
`BookProvider`, and half-dismantling it across two steps is exactly the mistake
`use-series-book-list.ts` caused once already (see the "Retired here" table's #10 above). `use-fetch-
book.ts` still appears in the `useWithTargetUser(` grep — it calls the hook directly itself,
independent of whether anything calls `useFetchBook` in turn — so the count of 7 is unaffected by
any of this.

### Transitive traces recorded at cleanup (task 13)

Per [[dead-code-claims-need-transitive-traces]], each candidate below was traced past its direct
importers, including barrel re-exports in `provider/*/index.ts`, before deciding its fate.

- **`use-series.ts`** — `grep -rn 'useSeries('` (word-boundary, excluding `useSeriesDetail`/
  `useSeriesNames`/`useSeriesBookList`/`useFetchSeriesNextIndex`) turned up only its own
  definition, its own test, and the `provider/book/{index.ts,hook/index.ts}` barrel re-exports.
  `page/series` — its only prior consumer — now calls `useSeriesDetail` instead. Trace clean:
  **deleted**, along with `use-series.test.ts` and both barrel entries (including the `SeriesMeta`
  type export).
- **`use-series-book-list.ts`** — direct callers: `use-my-series-progress.ts` and
  `use-user-series-progress.ts` (confirmed via `grep -n 'useSeriesBookList('`, no other call
  sites — the hits in `component/series-row`, `component/cover-stack`, `component/library-
  switcher`, and `provider/library/hook/use-series-detail.ts` are all doc-comment prose, not
  imports). Both of those callers were traced one level further:
  - `useMySeriesProgress` — its only non-test, non-barrel reference anywhere in `app/client/src`
    is the `export` line in `provider/progress/hook/index.ts`. `component/series-row/index.tsx`'s
    own doc comment confirms why: it now reads `unmasked.progressPercentage` off
    `SeriesRowFragment` (`Series.progressPercentage`, added in an earlier task) and no longer calls
    the hook at all — a `grep` for the literal string `useMySeriesProgress` outside comments and
    barrels returns nothing.
  - `useUserSeriesProgress` — same result: zero non-test, non-barrel, non-comment references
    anywhere in the app. Nothing ever called it outside its own test.
  - Both wrapper hooks' own dependency, `calculateSeriesProgressPercent`
    (`provider/progress/helper.ts`), had no consumers left once they were removed — confirmed via
    `grep -rln 'calculateSeriesProgressPercent'` before deleting it.
  Trace clean end to end: **deleted** — `use-series-book-list.ts`, `use-my-series-progress.ts`,
  `use-user-series-progress.ts`, `provider/progress/helper.ts`, and all four `.test.ts` files,
  plus their barrel entries (`provider/book/{index.ts,hook/index.ts}`,
  `provider/progress/{index.ts,hook/index.ts}`). `useMyProgressList`/`useUserProgressList`, the
  two hooks these wrappers also depended on, were NOT touched — both have other live consumers
  (`use-my-progress.ts`, `component/my-progress`, `component/my-progress-content`, `use-user-
  progress.ts`, `component/user-row-content`).
- **`use-fetch-book.ts`** — see the corrected retiring/surviving tables above. Trace: `useFetchBook`
  → `useBook` (`provider/book/hook/use-book.ts`) → `page/book-edit/index.tsx`,
  `component/user-progress-row/index.tsx`, `component/my-progress-row/index.tsx` (all direct
  `useBook(` call sites, confirmed by grep). Not clean for retirement — **left in place**; none of
  its three consumers belong to this plan.

## The raw-id / global-ID seam — the step's biggest risk

Once `page/book` reads GraphQL, the only identifier it holds is `Book.id`, a **Relay global ID**.
Step 5 gave global-ID decoding (`resolveBookLocalId`, `app/server/routes/ui.ts:491`) to exactly
**five** routes:

- `GET /api/books/:id` (:1148)
- `GET /api/books/:id/download` (:1341)
- `DELETE /api/books/:id` (:1369)
- `DELETE /api/books/:id/editions` (:1392)
- `POST /api/books/:id/validate` (:1655)

Three of those five migrate to GraphQL in this step, leaving `/download` as the only surviving
consumer of the existing decoding. The routes that survive step 6 and are reached **with an id
from `page/book`** do NOT decode a global ID today:

| Route | Reached from | Owner step |
|---|---|---|
| `PATCH /api/books/:id/metadata` (:1456) | "Edit metadata" → `page/book-edit` | 7 |
| `GET /api/books/:id/cover` (:1251) | `page/book-edit` | 7 |
| `DELETE /api/books/:id/pending-fixes` (:1132) | `page/book-edit` | 7 |
| `POST /api/books/:id/replace/analyze` (:1765) | `UploadReplaceModal` | 9 |
| `POST /api/books/:id/replace` (:1805) | `UploadReplaceModal` | 9 |
| `PUT /api/my/progress/:document` | `SetProgressModal` | 8 |

**User ruling (2026-08-13):** extend server-side decoding to these, per the precedent step 5 set —
the client never decodes and never holds a raw id. Rejected alternatives: adding `Book.documentId`
to the schema (reverses the Book-Relay-ID pass), and pulling steps 8/9 forward (spec §5 forbids).

`GET/POST/DELETE /api/books/:id/lineage` and `/link/:documentId` also lack decoding, but they
migrate to GraphQL in this step, so they need no bridge.

## Progress: a second-order consequence of the same seam

`ProgressSetInput.document` is a **raw** KOReader content hash, so even the GraphQL progress
mutation (step 8) is raw-id-keyed. `page/book` therefore cannot key `useMyProgress(book.id)` once
`book.id` is a global ID — the client-side map is keyed by `Progress.document`.

Resolution for this step: `page/book` reads progress from the book query (`Book.progress
{ percentage currentChapter }`), the same way `BookRowFromEntry` already does, and stops calling
`useMyProgress`. `SetProgressModal` stays REST and writes through `ProgressProvider`, so the
Apollo copy goes stale after a write — bridged by an explicit refetch on modal success, a seam
step 8 deletes.

## Hooks whose consumers do NOT all retire here

- `useBook` — at the time this document was written, predicted to survive for `page/book-edit` (7),
  `component/my-progress-row`, `component/user-progress-row` (8), with `control/unlink-book-lineage-
  button` retiring here by taking a `bookTitle` prop. **`useBook` calls `useFetchBook` internally**
  (`provider/book/hook/use-book.ts`), so `use-fetch-book.ts` survives for exactly the same reason —
  this was the corollary the original version of this document missed, which is why it double-
  counted `use-fetch-book.ts` as a 12th retiree below. See the corrected `useWithTargetUser` tables
  above. **Corrected at step 8's sweep (`2026-08-23`): both predicted survivors were wrong.**
  `page/book-edit` was built on `useBookEdit`, a differently-named new hook, not `useBook`; step 8
  moved the two progress rows onto GraphQL fragments. `useBook`/`use-fetch-book.ts` have zero
  non-test consumers today — left in place for step 10, not deleted. See the "Surviving by design"
  table's `use-fetch-book.ts` row above for the trace.
- `useSeriesBookList` — resolved at cleanup (task 13), see "Transitive traces" above: both of its
  remaining callers, `useMySeriesProgress` and `useUserSeriesProgress`, turned out to have zero
  non-test consumers by the time the sweep ran (`page/series` reads `Series.progressPercentage`
  instead, same as this document already predicted for `useMySeriesProgress`). All three, plus
  `calculateSeriesProgressPercent`, were deleted.

## Test surface

`~120` cases across 17 files touch the migrating hooks/components. Existing Apollo seam:
`renderWithApollo` / `renderHookWithApollo` in `app/client/src/test-utils.tsx` (real
`InMemoryCache(cacheConfig)` + `MockLink`; no MSW).
