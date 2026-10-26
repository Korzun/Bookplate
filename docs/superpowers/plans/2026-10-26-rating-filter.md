# Rating Filter Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Filter the library, in the SPA and through the MCP `search_library` tool, by minimum rating per dimension and by "unrated", with qualifying series members expanded into their own rows and the Overall glyph shown on every rated library row.

**Architecture:** One filter path. `services/library-page.ts`'s `listBooksPage` gains rating clauses on both the book and the series `where`, and treats an active rating filter like a text query for series-member expansion. The GraphQL `LibraryFilter` input grows `minRating`/`unrated` and the resolver validates 1–5 by rejecting, not clamping. The SPA sends only `minRating.overall` or `unrated` from a new `Rating` quick-pick group; the MCP tool sends any of the five. `BookRowFragment` picks up `rating { overall }` for the glyph.

**Tech Stack:** TypeScript, Express + Pothos GraphQL + Prisma (SQLite), React + Apollo Client with codegen fragment masking, MCP SDK with zod, vitest on both sides.

**Spec:** `docs/superpowers/specs/2026-10-26-rating-filter-design.md`

## Global Constraints

- Rating values are integers 1–5; unrated is `null` in the DB, GraphQL and MCP. Zero is never a rating.
- Minimums outside 1–5 are rejected with a GraphQL error (`extensions.code`, `http.status: 400`), never clamped. `@pothos/plugin-validation` is banned (`graphql/schema/builder.ts`); validate in the resolver.
- `BookListFilters` (`app/server/types.ts`) and `LibraryFilter` (`entries-filter.ts`) mirror each other field for field.
- Dimension order everywhere: overall, story, characters, writing, ideas (`RATING_FIELDS` in `services/rating.ts`). `RATING_COLUMNS` is the only field-to-column mapping.
- Rating clauses are appended to `bookWhere.AND`, never assigned over `bookWhere`, so the cursor predicate survives.
- Glyphs are the rating picker's `EmojiIcon`s in `currentColor`. No CSS filter, no fixed hex.
- `CHANGELOG.md` is not hand-edited; the PR title is the entry.
- Server verification: `npm test -w app/server -- <path>` and `npm run lint -w app/server`. Client: `npm test -w app/client -- <path>` and `npm run lint -w app/client` (includes `codegen:check`). Regenerate with `npm run graphql:schema -w app/server` and `npm run codegen -w app/client`.
- Commit after each task; do not push.

## Review Focus

Inputs the spec implies but no requirement names, each pinned by a test in the owning task:

1. `minRating: {}` with every dimension null must behave as "no rating filter": no narrowing and no series-member expansion. (Task 1, Task 2)
2. A pasted URL with `minOverall=7`, `minOverall=abc` or `unrated=0` must be ignored rather than sent as a filter or rendered as a chip. (Task 4)
3. A rating filter on page two, resumed from a cursor that ended on a series, must not re-include or skip the member books now interleaved as rows. (Task 1)
4. `entryType: 'series'` plus a rating filter must return series rows only, with no member expansion, since standalones are excluded. (Task 1)
5. A DB row with an out-of-range `ratingOverall` (legacy or hand-edited) must render no glyph rather than crash the grid. (Task 6)

---

### Task 1: Service filter and expansion

**Files:**
- Modify: `app/server/types.ts:75-82` (`BookListFilters`)
- Modify: `app/server/services/library-page.ts:200-260`
- Test: `app/server/services/library-page.test.ts`

**Interfaces:**
- Consumes: `RATING_FIELDS`, `RATING_COLUMNS`, `RatingFieldName` from `services/rating.ts`.
- Produces:
  - `BookListFilters.minRating?: Partial<Record<RatingFieldName, number>>` and `BookListFilters.unrated?: boolean`.
  - `export function ratingFilterActive(filters: BookListFilters | undefined): boolean` in `library-page.ts`: true when `unrated === true` or any `minRating` value is a number.
  - `export function ratingClauses(filters: BookListFilters | undefined): Prisma.BookWhereInput[]` in `library-page.ts`: one `{ [RATING_COLUMNS[field]]: { gte: n } }` per set dimension, plus `{ ratingOverall: null }` when `unrated`. Empty array when inactive.

- [ ] **Step 1: Write the failing tests** in a new `describe('listBooksPage() — rating filters')` block. Seed with `seedBook` then `prisma.book.update({ where: { userId_id: { userId: OWNER.userId, id } }, data: { ratingOverall, ratingIdeas, … } })`.

```ts
it('minRating.overall keeps standalones at or above it and drops unrated', ...)
  // seed a=5, b=4, c=null; { minRating: { overall: 4 } } → [a, b] by title
it('two minimums AND together', ...)
  // a: overall 5 ideas 4; b: overall 5 ideas 2; { minRating: { overall: 5, ideas: 4 } } → [a]
it('a minimum on one dimension ignores nulls in the others', ...)
  // a: ideas 4, overall null; { minRating: { ideas: 4 } } → [a]
it('unrated keeps standalones with null overall regardless of sub-ratings', ...)
  // a: overall null story 3; b: overall 2; { unrated: true } → [a]
it('an empty minRating object is no filter and does not expand series members', ...)
  // one series with one member rated 5, one standalone unrated; { minRating: {} } → [series, standalone] only
it('keeps a series when one member qualifies and expands that member as a row', ...)
  // series "The Expanse": s1 "Abaddon's Gate" overall 5, s2 "Leviathan Wakes" overall 3
  // { minRating: { overall: 5 } } → [{standalone s1}, {series The Expanse}]
  // (series sortKey is the name minus a leading article, case kept: "Expanse"; 'A' < 'E')
it('drops a series when no member qualifies', ...)
it('unrated keeps a series with an unrated member and expands only that member', ...)
it('entryType=series with a rating filter returns series rows only', ...)
  // same seed as the expansion test; { minRating: { overall: 5 }, entryType: 'series' } → [series]
it('seriesName with a rating filter returns only the named series, no member rows', ...)
it('rating filter composes with a text query as the intersection', ...)
  // s1 "Abaddon's Gate" overall 5, s2 "Caliban's War" overall 5, standalone "Gateway" overall 2
  // { query: 'gate', minRating: { overall: 5 } } → [s1, series]; "Gateway" absent
it('rating filter survives a cursor that ended on a series (page two)', ...)
  // seed series "Alpha Series" (member "Zed" overall 5) and standalones "Beta" 5, "Gamma" 5;
  // take 1 → [series]; resume with nextCursor, take 10 → ["Beta","Gamma","Zed"] in title order, no duplicates
it('rating filter survives a cursor that ended on a book (page two)', ...)
```

- [ ] **Step 2: Run to verify they fail**

Run: `npm test -w app/server -- services/library-page`
Expected: FAIL, the new cases only (type errors on `minRating` count).

- [ ] **Step 3: Extend `BookListFilters`** with the two fields above; keep the doc comment's "mirrors `LibraryFilter`" rule intact.

- [ ] **Step 4: Implement in `library-page.ts`**
  - Add `ratingFilterActive` and `ratingClauses` (exported, pure).
  - Rename `queryExpandsToSeriesBooks` to `expandsToSeriesBooks = (!!filters?.query || ratingFilterActive(filters)) && filters?.seriesName === undefined && filters?.entryType !== 'standalone'`; update its three uses and the comment above it.
  - After the subjects block, when `ratingFilterActive`: append `ratingClauses(filters)` to `bookWhere.AND` using the same normalise-then-spread pattern the query block uses (extract that into a local `withAnd(where, clauses)` helper and use it in both places), and set `seriesWhere = { ...seriesWhere, books: { some: { AND: ratingClauses(filters) } } }`.

- [ ] **Step 5: Run the file's tests**

Run: `npm test -w app/server -- services/library-page`
Expected: PASS, including the existing "fetches every book exactly once" and cursor tests.

- [ ] **Step 6: Commit**

```bash
git add app/server/types.ts app/server/services/library-page.ts app/server/services/library-page.test.ts
git commit -m "feat(server): library page filters by rating minimums and unrated, expanding qualifying series members"
```

---

### Task 2: GraphQL input, resolver mapping, validation

**Files:**
- Modify: `app/server/graphql/schema/library/entries-filter.ts`
- Modify: `app/server/graphql/schema/library/model.ts:366-374`
- Modify: `app/server/graphql/schema/pagination.ts` (new helper beside `rejectOversizePage`)
- Regenerate: `app/server/graphql/schema.generated.graphql`
- Modify: `docs/superpowers/specs/2026-10-25-book-ratings-design.md:91-93` (one-line pointer)
- Test: `app/server/graphql/schema/library/entries-filter.test.ts`

**Interfaces:**
- Consumes: Task 1's `BookListFilters.minRating`/`unrated`.
- Produces:
  - GraphQL `input RatingMinimums { overall: Int, story: Int, characters: Int, writing: Int, ideas: Int }` (all `required: false`), `LibraryFilter.minRating: RatingMinimums`, `LibraryFilter.unrated: Boolean`, with the descriptions from the spec.
  - `export const rejectRatingOutOfRange = (fieldName: string, minimums: Partial<Record<string, number | null | undefined>> | null | undefined): void` in `pagination.ts`, throwing `GraphQLError` with `extensions: { code: 'RATING_OUT_OF_RANGE', http: { status: 400 } }` and message `` `${fieldName}.minRating.${dim} must be an integer from 1 to 5 (got ${n}).` `` for the first offending dimension.

- [ ] **Step 1: Write the failing tests** in `entries-filter.test.ts`. In `beforeEach`, after the three books exist, rate them: Leviathan Wakes (in series) `ratingOverall: 5, ratingIdeas: 4`; Dune `ratingOverall: 4`; Neuromancer unrated.

```ts
it('minRating.overall selects rated entries and expands the qualifying series member', async () => {
  expect(await labels({ minRating: { overall: 5 } })).toEqual(['Expanse', 'Leviathan Wakes']);
  expect(await labels({ minRating: { overall: 4 } })).toEqual(['Dune', 'Expanse', 'Leviathan Wakes']);
});
it('minRating ANDs dimensions', async () => {
  expect(await labels({ minRating: { overall: 4, ideas: 4 } })).toEqual(['Expanse', 'Leviathan Wakes']);
});
it('unrated selects entries with no overall rating', async () => {
  expect(await labels({ unrated: true })).toEqual(['Neuromancer']);
});
it('an all-null minRating is no filter', async () => {
  expect(await labels({ minRating: {} })).toEqual(UNFILTERED);
  expect(await labels({ minRating: { overall: null } })).toEqual(UNFILTERED);
});
it.each([0, 6])('rejects minRating.overall %i with RATING_OUT_OF_RANGE', async (n) => {
  const result = await harness.execute(QUERY, { viewer: harness.aliceViewer, variables: { filter: { minRating: { overall: n } } } });
  expect(result.errors?.[0]?.extensions?.code).toBe('RATING_OUT_OF_RANGE');
  expect(result.errors?.[0]?.message).toContain('minRating.overall');
});
it('rejects a non-integer minimum at coercion', async () => {
  const result = await harness.execute(QUERY, { viewer: harness.aliceViewer, variables: { filter: { minRating: { ideas: 2.5 } } } });
  expect(result.errors).toBeDefined();
  expect(result.data ?? null).toBeNull();
});
```

- [ ] **Step 2: Run to verify they fail**

Run: `npm test -w app/server -- graphql/schema/library/entries-filter`
Expected: FAIL with unknown field `minRating` / `unrated` on `LibraryFilter`.

- [ ] **Step 3: Add the input types** in `entries-filter.ts` (new `ratingMinimums` input, two new fields on `libraryFilter`, descriptions from the spec's GraphQL block).

- [ ] **Step 4: Add `rejectRatingOutOfRange`** to `pagination.ts` next to `rejectOversizePage`, with a doc comment citing the reject-not-clamp ruling and the spec.

- [ ] **Step 5: Map in the resolver** (`model.ts`): call `rejectRatingOutOfRange('Library.entries', args.filter?.minRating)` right after `rejectOversizePage`; extend the `filters` object with `minRating` (null values stripped, `undefined` when the object is absent) and `unrated: args.filter.unrated ?? undefined`.

- [ ] **Step 6: Regenerate the schema and run the tests**

Run: `npm run graphql:schema -w app/server && npm test -w app/server -- graphql/schema/library`
Expected: PASS; `schema.generated.graphql` diff shows only `RatingMinimums` and the two new `LibraryFilter` fields.

- [ ] **Step 7: Point the old spec here.** In the ratings spec's non-goals bullet about "Library browsing by rating", append: "Answered by `2026-10-26-rating-filter-design.md`."

- [ ] **Step 8: Lint and commit**

Run: `npm run lint -w app/server`
Expected: clean.

```bash
git add app/server/graphql app/server/types.ts docs/superpowers/specs/2026-10-25-book-ratings-design.md
git commit -m "feat(graphql): LibraryFilter gains minRating and unrated, rejecting out-of-range minimums"
```

---

### Task 3: MCP search_library arguments and full rating on summaries

**Files:**
- Modify: `app/server/mcp/tools/search-library.ts`
- Modify: `app/server/mcp/tools/shared.ts` (`BOOK_SUMMARY_FIELDS`, `BookSummaryGql.rating`, `bookSummarySchema`, `summarizeBook`)
- Modify: `app/server/mcp/tools/get-taste-profile.ts` (drop its now-duplicate `${RATING_FIELDS_GQL}` and `rating: b.rating`)
- Test: `app/server/mcp/server.test.ts`

**Interfaces:**
- Consumes: Task 2's `LibraryFilter.minRating`/`unrated`.
- Produces: `search_library` input fields `minOverall`, `minStory`, `minCharacters`, `minWriting`, `minIdeas` (`z.number().int().min(1).max(5).optional()`) and `unrated: z.boolean().optional()`; `bookSummarySchema.rating: ratingSchema` alongside the kept `overallRating`.

- [ ] **Step 1: Write the failing tests** in the `read tools` describe (fixtures: Alpha overall 5 / characters 5 / writing 3; Beta overall 4).

```ts
it('search_library filters by rating minimums, ANDed', async () => {
  // { minOverall: 5 } → ['Alpha Book']; { minOverall: 4 } → both; { minOverall: 4, minCharacters: 5 } → ['Alpha Book']
});
it('search_library unrated lists books with no overall rating', async () => {
  // rate Beta back to null first via prisma.update; { unrated: true } → ['Beta Book']
});
it('search_library rejects minIdeas 0, 6 and 2.5 before reaching GraphQL', async () => {
  // each call: result.isError true, textOf(result) mentions minIdeas
});
it('search_library summaries carry the full rating', async () => {
  // Alpha: { overall: 5, story: null, characters: 5, writing: 3, ideas: null }; overallRating still 5
});
it('search_library describes the rating semantics', async () => {
  // tools/list: description contains 'unrated' and 'listed individually alongside their series'
});
```

- [ ] **Step 2: Run to verify they fail**

Run: `npm test -w app/server -- mcp/server`
Expected: FAIL on the new cases.

- [ ] **Step 3: Implement**
  - `shared.ts`: `BOOK_SUMMARY_FIELDS` ends with `${RATING_FIELDS_GQL}` instead of `rating { overall }`; `BookSummaryGql.rating: RatingGql`; schema gains `rating: ratingSchema`; `summarizeBook` sets both `rating: b.rating` and `overallRating: b.rating.overall`. `describeBook` unchanged.
  - `search-library.ts`: add the six inputs; build `filter.minRating` from the five (omit the key when none set) and `filter.unrated`; extend the description with the spec's sentence.
  - `get-taste-profile.ts`: remove the extra selection and mapping now provided by the summary.

- [ ] **Step 4: Run and lint**

Run: `npm test -w app/server -- mcp && npm run lint -w app/server`
Expected: PASS, clean.

- [ ] **Step 5: Commit**

```bash
git add app/server/mcp
git commit -m "feat(mcp): search_library filters by per-dimension rating minimums and unrated; summaries carry the full rating"
```

---

### Task 4: Client filter type, URL state, wire mapping

**Files:**
- Regenerate: `app/client/src/gql/graphql.ts`, `app/client/src/gql/gql.ts` (`npm run codegen -w app/client`)
- Modify: `app/client/src/lib/book-types.ts:60-67`
- Modify: `app/client/src/lib/use-book-list-filter.ts` (export `filterFromSearchParams`)
- Modify: `app/client/src/page/library/to-library-filter.ts`
- Modify: `app/client/src/page/library/index.tsx:244-248` (`isSearchActive`)
- Test: `app/client/src/lib/use-book-list-filter.test.ts` (new), `app/client/src/page/library/to-library-filter.test.ts`

**Interfaces:**
- Produces: `BookListFilter.minOverall?: 1 | 2 | 3 | 4 | 5` and `BookListFilter.unrated?: true`; URL params `minOverall=<1-5>` and `unrated=1`; `toLibraryFilter` emits `minRating: { overall }` and `unrated`.

- [ ] **Step 1: Write the failing tests**

`use-book-list-filter.test.ts` (pure functions, no React):
```ts
it.each(['1','2','3','4','5'])('reads minOverall=%s', (s) => expect(filterFromSearchParams(new URLSearchParams(`minOverall=${s}`)).minOverall).toBe(Number(s)));
it.each(['0','6','7','abc','2.5'])('ignores minOverall=%s', (s) => expect(filterFromSearchParams(new URLSearchParams(`minOverall=${s}`)).minOverall).toBeUndefined());
it('reads unrated=1 and ignores any other value', () => { /* '1' → true; '0', 'true', '' → undefined */ });
it('round-trips minOverall and unrated through filterToSearchParams', () => { /* both directions, both fields */ });
```

`to-library-filter.test.ts`:
```ts
it('maps minOverall onto minRating.overall', () => expect(toLibraryFilter({ minOverall: 4 }).minRating).toEqual({ overall: 4 }));
it('passes unrated through and leaves minRating undefined', () => { /* { unrated: true } → unrated: true, minRating: undefined */ });
```
Update the first existing test's expected object to include `minRating: undefined, unrated: undefined`.

- [ ] **Step 2: Regenerate codegen, run to verify they fail**

Run: `npm run codegen -w app/client && npm test -w app/client -- use-book-list-filter to-library-filter`
Expected: FAIL (fields missing).

- [ ] **Step 3: Implement** the type, the two URL functions (strict parse as the test table says), the mapping, and add `|| !!bookListFilter.minOverall || !!bookListFilter.unrated` to `isSearchActive`.

- [ ] **Step 4: Run, lint, commit**

Run: `npm test -w app/client -- use-book-list-filter to-library-filter page/library && npm run lint -w app/client`
Expected: PASS, clean.

```bash
git add app/client/src/gql app/client/src/lib app/client/src/page/library
git commit -m "feat(client): rating filter in URL state and on the LibraryFilter wire shape"
```

---

### Task 5: Search bar quick picks and chip

**Files:**
- Modify: `app/client/src/component/search-bar/use-search-suggestions.ts`
- Modify: `app/client/src/component/search-bar/index.tsx`
- Modify: `app/client/src/component/search-bar/style.ts` (`chipRating`, `dropdownItemTypeRating`)
- Modify: `app/client/src/provider/theme/theme.ts` (`color.chip.rating` type, light, dark)
- Modify: `app/client/src/control/index.ts` (export `RATING_OPTIONS`)
- Test: `app/client/src/component/search-bar/use-search-suggestions.test.ts`

**Interfaces:**
- Consumes: Task 4's `BookListFilter.minOverall`/`unrated`; `RATING_OPTIONS` (value, name, Icon) from `control/rating-picker`.
- Produces in `use-search-suggestions.ts`:
  - `Suggestion['type']` gains `'rating'`; `GROUP_LABEL.rating = 'Rating'`.
  - `export const RATING_QUICK_PICKS: ReadonlyArray<{ label: string; value: '5' | '4' | '3' | 'unrated' }>` = Love / Great or better / Nice or better / Unrated.
  - `export function ratingFilterLabel(filter: Pick<BookListFilter, 'minOverall' | 'unrated'>): string | null`: `'Unrated'`, `'Love'` for 5, `` `${name} or better` `` for 1–4 (name from `RATING_OPTIONS`), `null` when neither is set.

- [ ] **Step 1: Write the failing tests** (mirror the Status cases):

```ts
it('returns Type, Status and Rating quick-pick groups when inputValue is empty', () => { /* groups[2].type === 'rating', 4 items, values ['5','4','3','unrated'] */ });
it('omits the Rating group when minOverall is set, and when unrated is set', () => { /* two probes */ });
it('surfaces a matching Rating item for typed input', async () => { /* 'lov' → one rating item value '5'; 'unr' → 'unrated' */ });
it('ratingFilterLabel names every URL-reachable threshold', () => {
  // {minOverall:5}→'Love', 4→'Great or better', 3→'Nice or better', 2→'Okay or better', 1→'Bad or better', {unrated:true}→'Unrated', {}→null
});
```
Update the existing "returns Type and Status quick-pick groups" assertion from `toHaveLength(2)` to 3, and "omits both Type and Status groups when both are already set" to expect the Rating group alone (length 1).

- [ ] **Step 2: Run to verify they fail**

Run: `npm test -w app/client -- search-bar`
Expected: FAIL.

- [ ] **Step 3: Implement the hook**: add the options, the label helper, the empty-input group after Status, and the typed-input match loop beside the Status one, both gated on `!filter.minOverall && !filter.unrated`.

- [ ] **Step 4: Implement the bar** (`index.tsx`):
  - `ChipDef` gains `{ kind: 'rating'; value: string; glyph: 1|2|3|4|5 | null }`; `filterToChips` pushes it from `ratingFilterLabel`; `removeChip` clears both fields; `applySelection` for `'rating'` sets `minOverall: Number(value)` or `unrated: true` and clears the other.
  - `TYPE_CHIP_CLASS.rating = 'chipRating'`, `TYPE_CHIP_LABEL.rating = 'Rating'`, `TYPE_DROPDOWN_CLASS.rating = 'dropdownItemTypeRating'`.
  - Render the glyph (`RATING_OPTIONS[n-1].Icon`, `aria-hidden`, width/height 14) before the label in the chip and before `dropdownItemText` in a rating dropdown item whose value is numeric.
- [ ] **Step 5: Theme and style**: add `rating` to the `chip` type and both palettes (builder's choice of hue, distinct from the seven existing; a reasonable default is a burnt orange: light `text '#b5451b'`, dark `text '#F2A07B'`, with bg/border alphas matching the neighbours), and the two style classes following `chipStatus`/`dropdownItemTypeStatus`.

- [ ] **Step 6: Run, lint, commit**

Run: `npm test -w app/client -- search-bar && npm run lint -w app/client`
Expected: PASS, clean.

```bash
git add app/client/src/component/search-bar app/client/src/provider/theme app/client/src/control/index.ts
git commit -m "feat(client): Rating quick picks and chip in the search bar"
```

---

### Task 6: Overall glyph on library rows, Apollo merge policy, cost re-measure

**Files:**
- Modify: `app/client/src/component/book-row/index.tsx`
- Modify: `app/client/src/component/book-row/from-entry.tsx` (fragment + prop)
- Modify: `app/client/src/provider/apollo/cache.ts`
- Modify: `app/client/src/page/library/index.tsx:20-60` (cost comment numbers)
- Test: `app/client/src/component/book-row/index.test.tsx`, `from-entry.test.tsx`, `app/client/src/provider/apollo/cache.test.ts`

**Interfaces:**
- Consumes: `RATING_OPTIONS` from `~/control`.
- Produces: `BookRowProps.overallRating?: 1 | 2 | 3 | 4 | 5`; `BookRowFragment` selects `rating { overall }`; `cacheConfig.typePolicies.BookRating = { merge: true }`.

- [ ] **Step 1: Write the failing tests**

`index.test.tsx`:
```ts
it('appends the Overall glyph and name to the meta line when rated', () => {
  const { getByText, container } = renderWithApollo(<BookRow {...baseProps} overallRating={4} />);
  expect(getByText('Great')).toBeInTheDocument();           // name in its own span
  expect(container.querySelector('svg[aria-hidden="true"]')).not.toBeNull();
});
it('renders no rating when overallRating is absent', () => { /* queryByText(/Great|Love|Nice|Okay|Bad/) null */ });
```
`from-entry.test.tsx`: extend `makeBookRowData` with `rating: { __typename: 'BookRating', overall: null }`; add
```ts
it('passes the overall rating through to the row', () => { /* rating.overall 5 → getByText('Love') */ });
it('treats an out-of-range overall as unrated', () => { /* rating.overall 7 → no glyph, no crash */ });
```
`cache.test.ts`:
```ts
it('merges BookRating so a one-field selection does not clobber the five-field one', () => {
  expect(cacheConfig.typePolicies?.BookRating).toEqual({ merge: true });
});
```

- [ ] **Step 2: Run to verify they fail**

Run: `npm test -w app/client -- book-row apollo/cache`
Expected: FAIL.

- [ ] **Step 3: Implement**
  - `BookRow`: the meta line becomes a `ReactNode[]` joined with `' · '` separators; when `overallRating` is set, push `<span key="rating"><Icon aria-hidden width={14} height={14} className={styles.ratingGlyph} /> <span>{name}</span></span>` using `RATING_OPTIONS[overallRating - 1]`. Add `ratingGlyph: { verticalAlign: '-2px', marginRight: theme.space.xxs }` to `style.ts`. Colour inherits from `meta`.
  - `from-entry.tsx`: add `rating { overall }` to the fragment; map with a local `toRatingValue` guard (1–5 else `undefined`).
  - `cache.ts`: add the `BookRating` policy with a two-line comment on why.

- [ ] **Step 4: Regenerate, run, re-measure cost**

Run: `npm run codegen -w app/client && npm test -w app/client -- book-row apollo/cache page/library`
Expected: PASS.

Run: `npm run test:cost -w app/server`
Expected: PASS; copy the new `LibraryEntries` breadth/complexity into the doc comment in `page/library/index.tsx` (replacing "breadth 47 (47.0%), complexity 6007 (18.2%)"), noting `rating { overall }` as the cause.

- [ ] **Step 5: Lint both workspaces and run the full suite**

Run: `npm run lint && npm test`
Expected: clean, all green.

- [ ] **Step 6: Commit**

```bash
git add app/client/src/component/book-row app/client/src/provider/apollo app/client/src/page/library/index.tsx app/client/src/gql
git commit -m "feat(client): library rows show the Overall rating glyph; BookRating merges in the Apollo cache"
```
