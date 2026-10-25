# Book Ratings Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Let a reader rate each book 1–5 (Bad/Okay/Nice/Great/Awesome) overall and on Story, Characters, Writing and Ideas, inline on the book page and through the MCP server, plus a taste-profile read for assistants.

**Architecture:** Six nullable columns on `books` (five ratings, `rated_at`), exposed as `Book.rating: BookRating!` and written by one owner-only `bookRate` mutation; a `Library.ratingProfile` field aggregates them. The SPA renders a radio-group icon picker in the book header and mutates with an optimistic response. MCP tools `rate_book` and `get_taste_profile` run those same GraphQL documents in-process, as every existing tool does.

**Tech Stack:** Prisma 6 on SQLite, Pothos GraphQL (relay, scope-auth, prisma plugins), zod 4, MCP TypeScript SDK, React 19, Apollo Client 4, react-jss, vitest, Testing Library.

**Spec:** `docs/superpowers/specs/2026-10-25-book-ratings-design.md`

## Global Constraints

- Worktree root is `/Users/korzun/.herdr/worktrees/Bookplate/book-ratings`; every command below runs from there unless it says `cd app/server` or `cd app/client`. No `node_modules` exists yet: Task 1 runs `npm ci` first.
- Rating values are integers 1–5 or null. Never 0 in the database, GraphQL, or any MCP output. `rate_book` alone accepts 0 as a synonym for null.
- Field order everywhere: overall, story, characters, writing, ideas. Names: 1 Bad, 2 Okay, 3 Nice, 4 Great, 5 Awesome.
- A column on `books` is added in `db/migrate.ts` (`runDataMigration`), never in a Prisma DDL migration; the DDL migration is a `SELECT 1` no-op (precedent: `app/server/prisma/migrations/20261024000000_add_book_cover_normalized/migration.sql`).
- `bookRate` is OWNER-ONLY (`progressSet`'s scope shape), not `ownerOf`. It never touches the EPUB, never changes the id, and is not gated on validation.
- Every new SDL change is followed by `npm run graphql:schema -w app/server`; every client document change by `npm run codegen -w app/client`. `npm run lint` from the worktree root fails if either artifact is stale.
- Client colours, spacing, radii and fonts come only from `theme` (`~/provider/theme`). Icons follow `app/client/src/icon/props.ts` with `defaultStrokeIconProps`.
- Tests: server `cd app/server && npx vitest run <path-relative-to-app/server>`; client `cd app/client && npx vitest run <path-relative-to-app/client>`. Final check is `npm run lint` from the root plus both workspaces' full `npm test`.
- Commit after every task with the message given; do not push.

## Review Focus

1. `rate_book` called with only `bookId` must be a no-op that returns the detail, not an error (Task 7 test "no fields is a no-op").
2. `bookRate` with all five explicitly null must clear every rating and still stamp `ratedAt` (Task 4 test "explicit null clears").
3. `ratingProfile` on a library with no rated books must return `ratedCount 0`, `mean null` for every field, empty favourites, with no division by zero (Task 5 service test "empty library").
4. The book page must revert the optimistic selection and toast when the mutation fails (Task 11 test "reverts and toasts on failure").
5. `RatingPicker` handed a value outside 1–5 (a stale or corrupt cache) must render with nothing checked rather than throw (Task 9 test "out-of-range value").

---

### Task 1: Columns and migration

**Files:**
- Modify: `app/server/prisma/schema.prisma` (model `Book`, after `pageCount`)
- Create: `app/server/prisma/migrations/20261026000000_add_book_ratings/migration.sql`
- Modify: `app/server/db/migrate.ts` (append after `data_v23_mcp`)
- Test: `app/server/db/migrate.test.ts`

**Interfaces:**
- Produces: Prisma `Book` fields `ratingOverall`, `ratingStory`, `ratingCharacters`, `ratingWriting`, `ratingIdeas` (all `Int?`) and `ratedAt` (`Float?`), mapped to `rating_overall`, `rating_story`, `rating_characters`, `rating_writing`, `rating_ideas`, `rated_at`.

- [ ] **Step 1: Install dependencies**

Run: `npm ci`
Expected: completes; `app/server/node_modules/.prisma/client` exists (postinstall runs `prisma generate`).

- [ ] **Step 2: Write the failing migration test** in `app/server/db/migrate.test.ts`, next to the `data_v22` test:

```ts
it('data_v24: adds the six nullable rating columns to books and is idempotent', async () => {
  await runMigrations(prisma, booksRoot);
  const columns = await prisma.$queryRawUnsafe<Array<{ name: string; notnull: number | bigint; type: string }>>(
    `PRAGMA table_info("books")`
  );
  for (const name of ['rating_overall', 'rating_story', 'rating_characters', 'rating_writing', 'rating_ideas']) {
    const col = columns.find((c) => c.name === name);
    expect(col, name).toBeDefined();
    expect(Number(col!.notnull)).toBe(0);
    expect(col!.type).toBe('INTEGER');
  }
  const ratedAt = columns.find((c) => c.name === 'rated_at');
  expect(ratedAt).toBeDefined();
  expect(ratedAt!.type).toBe('REAL');
  await prisma.book.create({
    data: { userId: 'usr_test000000000000000', id: 'bk-rating', title: 'T', size: 1, mtime: 0, addedAt: 0 },
  });
  const row = await prisma.book.findUniqueOrThrow({
    where: { userId_id: { userId: 'usr_test000000000000000', id: 'bk-rating' } },
    select: { ratingOverall: true, ratedAt: true },
  });
  expect(row.ratingOverall).toBeNull();
  expect(row.ratedAt).toBeNull();
});
```

- [ ] **Step 3: Run it to verify it fails**

Run: `cd app/server && npx vitest run db/migrate.test.ts -t "data_v24"`
Expected: FAIL (TypeScript: `ratingOverall` is not a known select field, or PRAGMA finds no column).

- [ ] **Step 4: Add the Prisma fields** to `model Book` after `pageCount`, in this order, each with a one-line comment pointing at the spec:

```prisma
  ratingOverall    Int?   @map("rating_overall")
  ratingStory      Int?   @map("rating_story")
  ratingCharacters Int?   @map("rating_characters")
  ratingWriting    Int?   @map("rating_writing")
  ratingIdeas      Int?   @map("rating_ideas")
  ratedAt          Float? @map("rated_at")
```

Then `npm run prisma:generate -w app/server`.

- [ ] **Step 5: Add the no-op DDL migration** `20261026000000_add_book_ratings/migration.sql` with the same comment the `cover_normalized` one carries (why `data_v11_per_user_libraries` would drop a DDL-added column) and `SELECT 1;`.

- [ ] **Step 6: Add `data_v24_book_ratings`** to `db/migrate.ts` after `data_v23_mcp`: read `PRAGMA table_info(books)` once, then for each of the six columns missing, `ALTER TABLE "books" ADD COLUMN "<name>" INTEGER` (or `REAL` for `rated_at`). Nullable, no default.

- [ ] **Step 7: Run the migration tests**

Run: `cd app/server && npx vitest run db/migrate.test.ts`
Expected: PASS, including the existing idempotency tests.

- [ ] **Step 8: Commit**

```bash
git add app/server/prisma app/server/db
git commit -m "feat(server): rating columns on books via data_v24 migration"
```

---

### Task 2: Rating vocabulary module

**Files:**
- Create: `app/server/services/rating.ts`
- Test: `app/server/services/rating.test.ts`

**Interfaces:**
- Produces:
  - `RATING_FIELDS = ['overall', 'story', 'characters', 'writing', 'ideas'] as const`; `type RatingFieldName = (typeof RATING_FIELDS)[number]`
  - `type RatingValue = 1 | 2 | 3 | 4 | 5`
  - `RATING_NAMES: Record<RatingValue, string>` = Bad, Okay, Nice, Great, Awesome
  - `RATING_COLUMNS: Record<RatingFieldName, 'ratingOverall' | 'ratingStory' | 'ratingCharacters' | 'ratingWriting' | 'ratingIdeas'>`
  - `isRatingValue(n: unknown): n is RatingValue`
  - `formatRating(value: number | null): string` → `Great (4)` / `unrated`
  - `type BookRatingShape = Record<RatingFieldName, number | null>`
  - `ratingOf(row: Pick<Book, 'ratingOverall' | 'ratingStory' | 'ratingCharacters' | 'ratingWriting' | 'ratingIdeas'>): BookRatingShape`

- [ ] **Step 1: Write the failing tests**

```ts
describe('isRatingValue', () => {
  it.each([1, 2, 3, 4, 5])('accepts %s', (n) => expect(isRatingValue(n)).toBe(true));
  it.each([0, 6, 2.5, -1, NaN, Infinity, '3', null, undefined])('rejects %s', (n) =>
    expect(isRatingValue(n)).toBe(false)
  );
});
describe('formatRating', () => {
  it.each([[1, 'Bad (1)'], [2, 'Okay (2)'], [3, 'Nice (3)'], [4, 'Great (4)'], [5, 'Awesome (5)'], [null, 'unrated']])(
    '%s → %s', (v, out) => expect(formatRating(v)).toBe(out)
  );
});
it('ratingOf maps the five columns in field order', () => {
  expect(ratingOf({ ratingOverall: 4, ratingStory: null, ratingCharacters: 5, ratingWriting: 2, ratingIdeas: null }))
    .toEqual({ overall: 4, story: null, characters: 5, writing: 2, ideas: null });
  expect(Object.keys(ratingOf({ ratingOverall: null, ratingStory: null, ratingCharacters: null, ratingWriting: null, ratingIdeas: null })))
    .toEqual([...RATING_FIELDS]);
});
```

- [ ] **Step 2: Run to verify failure**

Run: `cd app/server && npx vitest run services/rating.test.ts`
Expected: FAIL, module not found.

- [ ] **Step 3: Implement `services/rating.ts`** with the exports above. `isRatingValue` is `Number.isInteger(n) && n >= 1 && n <= 5`.

- [ ] **Step 4: Run to verify pass**

Run: `cd app/server && npx vitest run services/rating.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add app/server/services/rating.ts app/server/services/rating.test.ts
git commit -m "feat(server): rating vocabulary (fields, names, validation)"
```

---

### Task 3: `Book.rating` in GraphQL

**Files:**
- Create: `app/server/graphql/schema/book-rating/model.ts`, `app/server/graphql/schema/book-rating/index.ts`
- Modify: `app/server/graphql/schema/index.ts` (add `import './book-rating';` in alphabetical position)
- Modify: `app/server/graphql/schema/book/model.ts` (after `chapterCount`)
- Modify: `app/server/graphql/schema.generated.graphql` (regenerated)
- Test: `app/server/graphql/schema/book/model.test.ts`

**Interfaces:**
- Consumes: `ratingOf`, `BookRatingShape` from Task 2.
- Produces: SDL `type BookRating { overall: Int story: Int characters: Int writing: Int ideas: Int }` and `Book.rating: BookRating!` (description from the spec); `model` export of `book-rating/model.ts` is `builder.objectRef<BookRatingShape>('BookRating')`.

- [ ] **Step 1: Write the failing test** in `book/model.test.ts`:

```ts
it('rating resolves the five columns, null for unrated', async () => {
  await harness.prisma.book.update({
    where: { userId_id: { userId: harness.aliceOwner.userId, id: BOOK_ID } },
    data: { ratingOverall: 4, ratingCharacters: 5 },
  });
  const result = await harness.execute(
    `{ viewer { library { book(id: "${bookGlobalId(harness.aliceOwner.userId, BOOK_ID)}") { rating { overall story characters writing ideas } } } } }`,
    { viewer: harness.aliceViewer }
  );
  expect(result.errors).toBeUndefined();
  expect((result.data as any).viewer.library.book.rating).toEqual({
    overall: 4, story: null, characters: 5, writing: null, ideas: null,
  });
});
```

- [ ] **Step 2: Run to verify failure**

Run: `cd app/server && npx vitest run graphql/schema/book/model.test.ts -t "rating resolves"`
Expected: FAIL, `Cannot query field "rating" on type "Book"`.

- [ ] **Step 3: Implement** `book-rating/model.ts` (objectRef with five `t.int({ nullable: true, resolve })` fields reading the shape), `index.ts` re-exporting `model`, register in `schema/index.ts`, and add to `Book`:

```ts
rating: t.field({
  type: bookRating,
  description: 'The reader’s ratings, each 1 (bad) to 5 (awesome) or null when unrated. Never derived from the EPUB.',
  resolve: (book) => ratingOf(book),
}),
```

Import `../book-rating/model` (the model file, not the index; see the import-rule comments at the top of `book/model.ts`).

- [ ] **Step 4: Regenerate the SDL and run the tests**

Run: `npm run graphql:schema -w app/server && cd app/server && npx vitest run graphql/schema/book/model.test.ts graphql/print-schema.test.ts`
Expected: PASS; `git diff app/server/graphql/schema.generated.graphql` shows `BookRating` and `rating: BookRating!`.

- [ ] **Step 5: Commit**

```bash
git add app/server/graphql
git commit -m "feat(graphql): Book.rating"
```

---

### Task 4: `bookRate` mutation

**Files:**
- Create: `app/server/graphql/schema/book/mutation/rate.ts`
- Modify: `app/server/graphql/schema/book/index.ts` (add `import './mutation/rate';`)
- Modify: `app/server/graphql/schema.generated.graphql` (regenerated)
- Test: `app/server/graphql/schema/book/mutation/rate.test.ts`

**Interfaces:**
- Consumes: `isRatingValue`, `RATING_FIELDS`, `RATING_COLUMNS` (Task 2); `invalidInputError` from `../../invalid-input-error`; `parseCompoundId` from `../../node-scope`; `model as book` from `../model`.
- Produces: SDL exactly as the spec's GraphQL section (`BookRateInput`, `BookRatePayload { book: Book! }`, `union BookRateResult = BookRatePayload | InvalidInputError`, `Mutation.bookRate(input: BookRateInput!): BookRateResult` with the spec's description). Payload shape `{ __typename: 'BookRatePayload'; owner: Owner; bookId: string }` with `book` as a `t.prismaField` fresh lookup (copy `clear-editions.ts`'s payload).

- [ ] **Step 1: Write the failing tests** in `rate.test.ts` (harness, `seedEditableBook`, `bookGlobalId` helper as in `clear-editions.test.ts`; `MUTATION` selects `__typename`, `... on BookRatePayload { book { id rating { overall story characters writing ideas } } }`, `... on InvalidInputError { issues { path message } }`). A `ratingRow(userId, id)` helper selects the six columns.

```ts
it('sets all five ratings and stamps ratedAt', ...)
  // input { id, overall: 4, story: 3, characters: 5, writing: 2, ideas: 1 } → payload rating equals input; ratingRow().ratedAt is a number near Date.now()
it('sets one field and leaves the other four untouched', ...)
  // seed overall 4 via prisma, send { id, story: 5 } → rating { overall: 4, story: 5, others null }
it('explicit null clears, including all five at once, and still stamps ratedAt', ...)
  // seed all five = 3, ratedAt = 1; send all five null → all null; ratedAt > 1
it('an input with only id is a no-op that returns the payload', ...)
it.each([0, 6, -1])('returns InvalidInputError naming the field for %s and writes nothing', ...)
  // { id, writing: v } → __typename InvalidInputError, issues[0].path = ['writing']; ratingRow unchanged (ratedAt still null)
it('resolves to null when the book does not exist for the viewer', ...)
it('refuses another reader with FORBIDDEN and null data, leaving the row unchanged', ...)
  // bobViewer on alice's id → result.errors[0].extensions.code === 'FORBIDDEN'
it('refuses the admin viewer with FORBIDDEN (owner-only, unlike other book mutations)', ...)
it('survives a title edit that changes the book id', ...)
  // rate overall 5, then run bookUpdateMetadata { title: 'Renamed' } (copy update-metadata.test.ts's vi.mock of epub-validator and reimportBook call-through); decode new id with rawBookId; ratingRow(newId).ratingOverall === 5
```

- [ ] **Step 2: Run to verify failure**

Run: `cd app/server && npx vitest run graphql/schema/book/mutation/rate.test.ts`
Expected: FAIL, `Unknown type "BookRateInput"`.

- [ ] **Step 3: Implement `rate.ts`**

- Input: `builder.inputType('BookRateInput', { fields: t => ({ id: t.globalID({ required: true, for: book }), overall: t.int({ required: false }), … }) })`.
- Zod: `const value = z.number().int().min(1, 'Must be 1–5').max(5, 'Must be 1–5'); const inputSchema = z.object(Object.fromEntries(RATING_FIELDS.map(f => [f, value.nullable().optional()])))`. `.nullable().optional()` keeps `undefined` (omitted) distinct from `null` (clear).
- `authScopes: (_p, args, context) => { const parsed = parseCompoundId(args.input.id.id); return parsed !== null && context.viewer !== null && context.viewer.userId === parsed[0]; }` with a doc comment citing `progress/mutation/set.ts` and the spec's anti-goal.
- Resolver: parse → on failure `invalidInputError(parsed.error)`; `loadOwner(userId)` null → null; `findUnique` the row → null → null; build `data` from the defined keys via `RATING_COLUMNS`, add `ratedAt: Date.now()`; one `book.update`; return the payload.
- Union: `builder.unionType('BookRateResult', { types: [payload, invalidInputErrorModel] })`.
- Register in `book/index.ts`.

- [ ] **Step 4: Regenerate SDL, run tests**

Run: `npm run graphql:schema -w app/server && cd app/server && npx vitest run graphql/schema/book/mutation/rate.test.ts graphql/print-schema.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add app/server/graphql
git commit -m "feat(graphql): owner-only bookRate mutation"
```

---

### Task 5: Rating profile service and `Library.ratingProfile`

**Files:**
- Create: `app/server/services/rating-profile.ts`, `app/server/services/rating-profile.test.ts`
- Create: `app/server/graphql/schema/rating-field/{index,model}.ts`, `app/server/graphql/schema/rating-field-summary/{index,model}.ts`, `app/server/graphql/schema/library-rating-profile/{index,model}.ts`
- Modify: `app/server/graphql/schema/index.ts` (three imports), `app/server/graphql/schema/pagination.ts` (`CONNECTION_LIMITS.ratingFavourites: { maxSize: 100, defaultSize: 25 }`), `app/server/graphql/schema/library/model.ts` (field after `authors`)
- Test: `app/server/graphql/schema/library/rating-profile.test.ts`

**Interfaces:**
- Consumes: `RATING_FIELDS`, `RATING_COLUMNS`, `RatingFieldName` (Task 2); `model as book` from `../book/model`.
- Produces (service):
  - `type RatingFieldSummary = { field: RatingFieldName; count: number; mean: number | null; distribution: [number, number, number, number, number] }`
  - `ratingSummaries(prisma: PrismaClient, userId: string): Promise<RatingFieldSummary[]>` (one entry per field, in `RATING_FIELDS` order; one `book.groupBy` per field over `where: { userId, [column]: { not: null } }`)
  - `ratedCount(prisma, userId): Promise<number>` (`ratingOverall` not null)
  - `favouriteBooks(prisma, userId, minOverall: number, first: number): Promise<Book[]>` (`ratingOverall >= minOverall`, `orderBy: [{ ratedAt: 'desc' }, { title: 'asc' }]`, `take: first`; the caller clamps)
- Produces (SDL): `enum RatingField { OVERALL STORY CHARACTERS WRITING IDEAS }`, `type RatingFieldSummary { field: RatingField! count: Int! mean: Float distribution: [Int!]! }`, `type LibraryRatingProfile { ratedCount: Int! fields: [RatingFieldSummary!]! favourites(minOverall: Int = 5, first: Int = 25): [Book!]! }`, `Library.ratingProfile: LibraryRatingProfile!`, descriptions as in the spec.

- [ ] **Step 1: Write the failing service tests** (harness; seed with `prisma.book.create` rows carrying rating columns, as `book/model.test.ts` seeds):

```ts
it('empty library: ratedCount 0, every mean null, zero distributions, no favourites', ...)
it('counts, means and distributions per field over a mixed library', ...)
  // three books: A {overall 5, story 4}, B {overall 3, story 4, writing 1}, C {nothing}
  // ratedCount 2; overall {count 2, mean 4, distribution [0,0,1,0,1]}; story {count 2, mean 4}; writing {count 1, mean 1}; characters/ideas {count 0, mean null}
it('favourites honour minOverall, order by ratedAt desc, and take first', ...)
  // A ratedAt 3, B ratedAt 2, D {overall 4, ratedAt 1}; minOverall 4, first 2 → [A, D]; minOverall 5 → [A]
it('ignores another reader’s books', ...)
```

- [ ] **Step 2: Run to verify failure**

Run: `cd app/server && npx vitest run services/rating-profile.test.ts`
Expected: FAIL, module not found.

- [ ] **Step 3: Implement `services/rating-profile.ts`.** Mean is computed from the distribution (`sum(v * count) / count`), never a float aggregate, so it is exact.

- [ ] **Step 4: Run the service tests**

Run: `cd app/server && npx vitest run services/rating-profile.test.ts`
Expected: PASS.

- [ ] **Step 5: Write the failing GraphQL test** `library/rating-profile.test.ts`:

```ts
it('resolves the profile for the owner, with favourites as real Book nodes', ...)
  // seed as above; query viewer { library { ratingProfile { ratedCount fields { field count mean distribution } favourites(minOverall: 4, first: 10) { id title rating { overall } } } } }
  // fields[0].field === 'OVERALL'; favourites titles in ratedAt order; favourites[0].rating.overall === 5
it('clamps first to 100 and defaults minOverall to 5', ...)
  // favourites(first: 1000) does not error; favourites with no args returns only overall-5 books
it('an admin reads a named reader’s profile through user(id:).library', ...)
```

- [ ] **Step 6: Run to verify failure**

Run: `cd app/server && npx vitest run graphql/schema/library/rating-profile.test.ts`
Expected: FAIL, `Cannot query field "ratingProfile"`.

- [ ] **Step 7: Implement the three schema entities and the Library field.** `rating-field/model.ts`: `builder.enumType('RatingField', { values: ['OVERALL','STORY','CHARACTERS','WRITING','IDEAS'] as const })`. `rating-field-summary/model.ts`: objectRef over the service type; `field` resolves `s.field.toUpperCase()`. `library-rating-profile/model.ts`: objectRef over `Owner`; `ratedCount`, `fields`, and `favourites` as `t.prismaField({ type: [book], args: { minOverall: t.arg.int({ defaultValue: 5 }), first: t.arg.int({ defaultValue: 25 }) }, resolve })` clamping `minOverall` to 1–5 and `first` to 1–`CONNECTION_LIMITS.ratingFavourites.maxSize`. `Library.ratingProfile: t.field({ type: libraryRatingProfile, resolve: (owner) => owner })`. Model files import `../book/model` and `../builder` only (see the import-cycle rule in `library/model.ts`).

- [ ] **Step 8: Regenerate SDL, run tests, re-run cost calibration**

Run: `npm run graphql:schema -w app/server && cd app/server && npx vitest run graphql/schema/library/rating-profile.test.ts graphql/print-schema.test.ts && npm run test:cost`
Expected: all PASS.

- [ ] **Step 9: Commit**

```bash
git add app/server/services/rating-profile.ts app/server/services/rating-profile.test.ts app/server/graphql
git commit -m "feat(graphql): Library.ratingProfile with per-field summaries and favourites"
```

---

### Task 6: MCP read side: ratings in `get_book`, summaries, and `get_taste_profile`

**Files:**
- Modify: `app/server/mcp/tools/shared.ts`, `app/server/mcp/tools/get-book.ts`
- Create: `app/server/mcp/tools/get-taste-profile.ts`
- Modify: `app/server/mcp/server.ts` (register in `registerReadTools`)
- Test: `app/server/mcp/server.test.ts`

**Interfaces:**
- Consumes: `formatRating`, `RATING_FIELDS`, `RATING_NAMES` (Task 2).
- Produces in `shared.ts`:
  - `RATING_FIELDS_GQL = 'rating { overall story characters writing ideas }'`
  - `type RatingGql = { overall: number | null; story: …; characters: …; writing: …; ideas: … }`
  - `ratingSchema = z.object({ overall: z.number().nullable(), … })`
  - `describeRating(r: RatingGql): string` → `Rating: Great (4) · Story: Awesome (5) · Characters: Nice (3) · Writing: Okay (2) · Ideas: unrated`, or `Rating: not rated` when all null
  - `BOOK_SUMMARY_FIELDS` gains `rating { overall }`; `BookSummaryGql.rating: { overall: number | null }`; `bookSummarySchema.overallRating: z.number().nullable()`; `summarizeBook` maps it; `describeBook` appends `rated Great` when set.
- Produces in `get-book.ts`: `BOOK_DETAIL_FIELDS` gains `RATING_FIELDS_GQL`; `BookDetailGql.rating: RatingGql`; `bookDetailSchema.rating: ratingSchema`; `toBookDetail` copies it; `describeBookDetail` inserts `describeRating(b.rating)` after the series line.
- Produces tool `get_taste_profile` with the spec's input (`minOverall` int 1–5 default 5, `first` int 1–100 default 25), output `{ ratedCount, fields: [{ field, count, mean, distribution }], favourites: [bookSummary & { rating }] }`, and the spec's description text.

- [ ] **Step 1: Write the failing tests** in `server.test.ts`. In `beforeEach`, after seeding, set ratings directly: Alpha `{ ratingOverall: 5, ratingCharacters: 5, ratingWriting: 3, ratedAt: 2 }`, Beta `{ ratingOverall: 4, ratedAt: 1 }` via `harness.prisma.book.update`.

```ts
// in READ_TOOLS add 'get_taste_profile'
it('get_book carries the rating and describes it by name', ...)
  // structuredContent.rating → { overall: 5, story: null, characters: 5, writing: 3, ideas: null }; textOf contains 'Rating: Awesome (5) · Story: unrated · Characters: Awesome (5) · Writing: Nice (3) · Ideas: unrated'
it('search_library summaries carry overallRating', ...)
  // Alpha entry overallRating 5, Beta 4; a Bob book is absent
it('get_taste_profile reports counts, means and the favourites in ratedAt order', ...)
  // default args: ratedCount 2; fields[0] = { field: 'OVERALL', count: 2, mean: 4.5, distribution: [0,0,0,1,1] }; favourites = [Alpha] (overall 5 only)
  // { minOverall: 4 } → favourites [Alpha, Beta]; textOf starts with a line per field
it('get_taste_profile rejects first above 100 and minOverall of 0', ...)
  // result.isError true for each
it('get_taste_profile works on a read-only connection', ...)
```

- [ ] **Step 2: Run to verify failure**

Run: `cd app/server && npx vitest run mcp/server.test.ts -t "taste_profile|carries the rating|overallRating"`
Expected: FAIL.

- [ ] **Step 3: Implement** the `shared.ts` and `get-book.ts` additions and `get-taste-profile.ts` (document: `viewer { library { ratingProfile { ratedCount fields { field count mean distribution } favourites(minOverall: $minOverall, first: $first) { ${BOOK_SUMMARY_FIELDS} ${RATING_FIELDS_GQL} } } } }`; text: one line per field `Overall: 2 rated, mean 4.5, 1/2/3/4/5 = 0/0/0/1/1`, a blank line, then `Favourites (overall ≥ 5):` and per book `describeBook(summary)` followed by an indented `describeRating` line). Register with `registerReadTools`.

- [ ] **Step 4: Run the MCP tests**

Run: `cd app/server && npx vitest run mcp/server.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add app/server/mcp
git commit -m "feat(mcp): ratings in get_book and summaries; get_taste_profile tool"
```

---

### Task 7: MCP `rate_book`

**Files:**
- Create: `app/server/mcp/tools/rate-book.ts`
- Modify: `app/server/mcp/server.ts` (register in `registerWriteTools`)
- Test: `app/server/mcp/server.test.ts`

**Interfaces:**
- Consumes: `fetchBookDetail`, `describeBookDetail`, `bookDetailSchema` (get-book.ts); `unwrapPayload`, `userErrorFields(['InvalidInputError'])` (mutation.ts); `guarded`, `decodeBookId`, `NOT_FOUND_BOOK`, `ok`, `ToolError` (execute.ts).
- Produces tool `rate_book`: input `bookId: z.string()`, five fields `z.number().int().min(0).max(5).nullable().optional()` with the spec's `.describe` text; 0 → null before the mutation; `guarded(deps, { write: true }, …)`; annotations `{ readOnlyHint: false, destructiveHint: false, idempotentHint: true, openWorldHint: false }`; output `bookDetailSchema`; text `Rated.\n` + `describeBookDetail(book)`.

- [ ] **Step 1: Write the failing tests** in `server.test.ts`:

```ts
// in WRITE_TOOLS add 'rate_book'
it('rate_book sets ratings and returns the detail with names', ...)
  // { bookId: betaId, overall: 3, story: 5 } → structuredContent.rating.overall 3, story 5; textOf starts 'Rated.'
it('rate_book clears with null and with 0', ...)
  // alpha: { writing: null } → writing null; { characters: 0 } → characters null; overall untouched (5)
it('rate_book with only bookId is a no-op that returns the detail', ...)
it('rate_book rejects 6 and 2.5 before reaching GraphQL', ...)
  // isError true; textOf mentions the field
it('rate_book refuses another reader’s id with the not-found message', ...)
// extend 'a read-only connection is refused by every write tool' with rate_book
```

- [ ] **Step 2: Run to verify failure**

Run: `cd app/server && npx vitest run mcp/server.test.ts -t "rate_book"`
Expected: FAIL, unknown tool.

- [ ] **Step 3: Implement `rate-book.ts`** on the `update-book-metadata.ts` template, with the description from the spec (what each sub-rating judges; overall is the gut verdict, not an average; leave a sub-rating unrated when the reader has no opinion).

- [ ] **Step 4: Run the MCP tests**

Run: `cd app/server && npx vitest run mcp/server.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add app/server/mcp
git commit -m "feat(mcp): rate_book tool"
```

---

### Task 8: Consent page permission lines

**Files:**
- Modify: `app/client/src/page/connect/index.tsx` (`PERMISSIONS`)
- Test: `app/client/src/page/connect/index.test.tsx`

**Interfaces:**
- Produces: two new lines in `PERMISSIONS`, in this order: `{ text: 'Read your ratings and taste profile', write: false }` directly after `Read book and series details`, and `{ text: 'Rate books', write: true }` directly after `Edit book metadata`. Ten lines total.

- [ ] **Step 1: Update the failing test** "names the client and lists each permission; read-only marks the write lines as not granted": the expected text list becomes the ten lines in the order above; `toHaveLength(10)`; the granted array after the switch flips becomes `['true','true','true','false','false','false','false','false','false','false']`.

- [ ] **Step 2: Run to verify failure**

Run: `cd app/client && npx vitest run src/page/connect/index.test.tsx`
Expected: FAIL on the list comparison.

- [ ] **Step 3: Add the two lines to `PERMISSIONS`** and extend its doc comment with one sentence: the read line covers `get_taste_profile` and the rating on every book read; the write line covers `rate_book`.

- [ ] **Step 4: Run the test**

Run: `cd app/client && npx vitest run src/page/connect/index.test.tsx`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add app/client/src/page/connect
git commit -m "feat(client): consent page lists rating permissions"
```

---

### Task 9: Client icons and `RatingPicker` control

**Files:**
- Create: `app/client/src/icon/thumb-down.tsx`, `thumb-up.tsx`, `hand-ok.tsx`, `hands-clap.tsx`, `hand-horns.tsx`; modify `app/client/src/icon/index.ts`
- Create: `app/client/src/control/rating-picker/index.tsx`, `style.ts`, `index.test.tsx`; modify `app/client/src/control/index.ts`

**Interfaces:**
- Produces icons `ThumbDownIcon`, `ThumbUpIcon`, `HandOkIcon`, `HandsClapIcon`, `HandHornsIcon` (`IconProps`, `defaultStrokeIconProps`, 24 viewBox, the Tabler source URL comment; `thumb-up`/`thumb-down` paths copied from Tabler; `hand-horns` adapted from Tabler `hand-love-you` with the thumb folded; `hand-ok` and `hands-clap` drawn in the same stroke style and legible at 20px).
- Produces control:
  - `type RatingValue = 1 | 2 | 3 | 4 | 5`
  - `RATING_OPTIONS: ReadonlyArray<{ value: RatingValue; name: string; Icon: (p: IconProps) => JSX.Element }>` in order Bad/Okay/Nice/Great/Awesome
  - `control/index.ts` exports `RatingPicker` and `type { RatingValue }`.
  - `RatingPicker({ value, onChange, size = 'md', label, showNames = false })` with `value: RatingValue | null`, `onChange?: (v: RatingValue | null) => void` (absent = read-only), `size?: 'sm' | 'md'`, `label: string`, `showNames?: boolean`.
  - Markup: `role="radiogroup"` with `aria-label={label}`; five `<button type="button" role="radio" aria-checked aria-label={name}>`; roving `tabIndex` (checked one, else the first); read-only adds `aria-disabled="true"` to each radio and the group, `tabIndex={-1}` on all.
  - Keys on the group: ArrowRight/ArrowUp next (no wrap), ArrowLeft/ArrowDown previous (no wrap), Home 1, End 5, Digit1–5 select, Backspace/Delete clear, Space/Enter on the focused radio toggle (select; clear if it is the checked one).
  - Pointer: click selects; click the checked one clears.

- [ ] **Step 1: Write the failing control tests** (`renderWithProviders`, `userEvent`, as `segmented-control/index.test.tsx` does):

```ts
it('renders a radiogroup with five radios named Bad, Okay, Nice, Great, Awesome')
it('marks the value as checked and nothing when null')
it('click selects; clicking the checked radio clears', ...)        // onChange(4) then onChange(null)
it('ArrowRight from Great selects Awesome and from Awesome does nothing (no wrap)')
it('ArrowLeft from Bad does nothing; Home selects Bad; End selects Awesome')
it('digit keys select directly; Backspace and Delete clear')
it('read-only (no onChange) renders aria-disabled radios and ignores clicks and keys')
it('shows names under the icons only when showNames is set')
it('out-of-range value renders with nothing checked', ...)        // value={0 as never} → no radio aria-checked="true", no throw
```

- [ ] **Step 2: Run to verify failure**

Run: `cd app/client && npx vitest run src/control/rating-picker/index.test.tsx`
Expected: FAIL, module not found.

- [ ] **Step 3: Add the five icons** and export them from `icon/index.ts`.

- [ ] **Step 4: Implement `RatingPicker` and its styles.** Styles: `root` is a flex row with `gap: theme.space.sm`; each `radio` is a borderless transparent button that centres the icon in a circle (`borderRadius: theme.radius.circle`; `md` 40px, `sm` 32px; icon 24px / 20px) and carries `theme.recipe.focusRing`; `checked` fills the circle with `theme.color.brand.default` and colours the icon `theme.color.text.onPrimary`; unchecked icons use `theme.color.text.secondary`, `&:hover` to `theme.color.text.primary` (no hover when read-only); `name` under the icon at `theme.fontSize.xs`, `text.secondary`, `text.primary` when checked. The group carries `title={checked name}` at `sm`.

- [ ] **Step 5: Run the control tests**

Run: `cd app/client && npx vitest run src/control/rating-picker/index.test.tsx`
Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add app/client/src/icon app/client/src/control
git commit -m "feat(client): rating icons and RatingPicker control"
```

---

### Task 10: `BookRating` component

**Files:**
- Create: `app/client/src/component/book-rating/index.tsx`, `style.ts`, `index.test.tsx`; modify `app/client/src/component/index.ts` (export `BookRating`)

**Interfaces:**
- Consumes: `RatingPicker`, `RatingValue` (Task 9).
- Produces:
  - `type RatingFieldKey = 'overall' | 'story' | 'characters' | 'writing' | 'ideas'`
  - `type BookRatingValues = Record<RatingFieldKey, number | null>`
  - `BookRating({ rating, bookTitle, readOnly, onRate })` with `rating: BookRatingValues`, `bookTitle: string`, `readOnly: boolean`, `onRate: (field: RatingFieldKey, value: RatingValue | null) => void`.
  - Renders the Overall picker at `md` with `showNames`, `label` `Overall rating for ${bookTitle}`; then a grid of four rows `Story`, `Characters`, `Writing`, `Ideas`, each a `<span>` label plus a `sm` picker labelled `${Label} rating for ${bookTitle}`. Grid: two columns, `gridTemplateColumns: '1fr'` under `@media (max-width: ${theme.breakpoint.mobile})`.

- [ ] **Step 1: Write the failing tests**

```ts
it('renders five radiogroups labelled for the book', ...)   // getByRole('radiogroup', { name: 'Overall rating for Dune' }) etc.
it('reports the field and value on change', ...)           // click Awesome in the Story group → onRate('story', 5)
it('passes readOnly through to every picker', ...)         // all radios aria-disabled
```

- [ ] **Step 2: Run to verify failure**

Run: `cd app/client && npx vitest run src/component/book-rating/index.test.tsx`
Expected: FAIL.

- [ ] **Step 3: Implement the component and styles.**

- [ ] **Step 4: Run the tests**

Run: `cd app/client && npx vitest run src/component/book-rating/index.test.tsx`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add app/client/src/component
git commit -m "feat(client): BookRating block"
```

---

### Task 11: Book page wiring and the `BookRate` mutation

**Files:**
- Modify: `app/client/src/graphql/book.ts` (add `BookRateDocument`), `app/client/src/page/book/query.ts` (`BookDetailDocument` selects `rating { overall story characters writing ideas }`; update the measured breadth/complexity numbers in its doc comment), `app/client/src/page/book/index.tsx`, `app/client/src/page/book/style.ts`
- Regenerate: `app/client/src/gql/**` via codegen
- Test: `app/client/src/page/book/index.test.tsx`

**Interfaces:**
- Consumes: `BookRating`, `RatingFieldKey` (Task 10); `useToast` (`showToast(message, 'error')`); `useIsAdmin`.
- Produces: `BookRateDocument`:

```graphql
mutation BookRate($input: BookRateInput!) {
  bookRate(input: $input) {
    __typename
    ... on BookRatePayload { book { id rating { overall story characters writing ideas } } }
    ... on InvalidInputError { message }
  }
}
```

- [ ] **Step 1: Add the documents and regenerate client types**

Add `BookRateDocument` (above) to `~/graphql/book.ts` with a doc comment in that file's style (payload re-selects `rating` so it normalizes onto `Book:<id>`; `InvalidInputError` is the union's one error member, schema-verified in `rate.ts`), add the `rating { … }` selection to `BookDetailDocument` in `query.ts`, then run `npm run codegen -w app/client`.
Expected: `src/gql/graphql.ts` gains `BookRateMutation`, `BookRating`.

- [ ] **Step 2: Write the failing page tests.** Add `rating: { __typename: 'BookRating', overall: 4, story: null, characters: 5, writing: null, ideas: null }` to `bookMock`'s default book. Add a `bookRateMock(input, rating)` factory (`request: { query: BookRateDocument, variables: { input } }`, result `bookRate: { __typename: 'BookRatePayload', book: { __typename: 'Book', id: BOOK_ID, rating: { __typename: 'BookRating', ...rating } } }`) and a `bookRateErrorMock(input)` with `error: new Error('rate failed')`.

```ts
describe('rating', () => {
  it('renders the current ratings from BookDetail', ...)
    // within group 'Overall rating for A Wizard of Earthsea', radio Great aria-checked true; Characters group Awesome checked; Story group nothing checked
  it('rating a sub-field sends only that field and updates from the payload with no refetch', ...)
    // ONE bookMock; click Awesome in Story group; mock input { id: BOOK_ID, story: 5 }; afterwards Story Awesome checked, Overall still Great
  it('clicking the checked overall clears it', ...)               // input { id: BOOK_ID, overall: null }
  it('reverts and toasts on failure', ...)                        // bookRateErrorMock; after click, waitFor Story Awesome checked (optimistic) then unchecked; toast text contains 'rate failed'
  it('is read-only for an admin viewer', ...)                     // renderPage(..., { user: { username: 'admin', isAdmin: true } }); radios aria-disabled
});
```

- [ ] **Step 3: Run to verify failure**

Run: `cd app/client && npx vitest run src/page/book/index.test.tsx -t "rating"`
Expected: FAIL.

- [ ] **Step 4: Wire the page.** `const [runRate] = useMutation(BookRateDocument);` and

```ts
const handleRate = useCallback((field: RatingFieldKey, value: RatingValue | null) => {
  if (book === undefined) return;
  void runRate({
    variables: { input: { id: book.id, [field]: value } },
    optimisticResponse: { bookRate: { __typename: 'BookRatePayload', book: { __typename: 'Book', id: book.id, rating: { __typename: 'BookRating', ...book.rating, [field]: value } } } },
  }).then((r) => { if (r.data?.bookRate?.__typename === 'InvalidInputError') showToast(r.data.bookRate.message, 'error'); })
    .catch((err: unknown) => showToast(err instanceof Error ? err.message : 'Failed to save rating', 'error'));
}, [book, runRate, showToast]);
```

Render `<BookRating rating={book.rating} bookTitle={book.title} readOnly={isAdmin} onRate={handleRate} />` inside `styles.info` after the author block, wrapped in a `styles.rating` div with `marginTop: theme.space.md`. If Apollo logs a "Cache data may be lost" warning for `BookRating` in the tests, add `BookRating: { merge: true }` to the cache `typePolicies` (grep `typePolicies` under `app/client/src`).

- [ ] **Step 5: Run the page tests, then the whole client suite**

Run: `cd app/client && npx vitest run src/page/book/index.test.tsx && npx vitest run`
Expected: PASS; no "Missing field 'rating'" warnings in output.

- [ ] **Step 6: Re-measure cost and update the doc comment**

Run: `cd app/server && npm run test:cost`
Expected: PASS; copy the reported `BookDetail` breadth and complexity into `page/book/query.ts`'s "Measured" paragraph.

- [ ] **Step 7: Commit**

```bash
git add app/client/src app/server
git commit -m "feat(client): inline book ratings on the book page"
```

---

### Task 12: Whole-branch verification

**Files:** none new.

- [ ] **Step 1: Lint from the root** (both workspaces, schema and codegen checks)

Run: `npm run lint`
Expected: exit 0.

- [ ] **Step 2: Full server and client suites**

Run: `npm test -w app/server && npm test -w app/client`
Expected: all PASS.

- [ ] **Step 3: See it in the app.** Use the `run` skill to start the dev stack for THIS worktree (per-worktree stacks; see memory), open a book, rate it, reload, confirm it persisted; rate through `rate_book` over MCP if a client is connected, else via the GraphQL endpoint; confirm both themes render the icons legibly at the sub-rating size.

- [ ] **Step 4: Commit any fix-ups**

```bash
git commit -am "chore: book ratings verification fix-ups"
```
