# EPUB Collections Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Stop EPUB 3 `set` collections from becoming a book's series, and store and show sets as "Collections".

**Architecture:** The parser matches each `belongs-to-collection` to its own refining `collection-type` and `group-position`. It returns `series`/`seriesIndex` from real series and a `collections` list from sets. Two new per-user tables (`collections`, `book_collections`) are kept in sync by `addBook`/`reimportBook`, the same way `Series` is. GraphQL exposes `Book.collections`, a `Collection` node, a library filter and a suggestion group. The client, OPDS and MCP consume those.

**Tech Stack:** TypeScript, Express, Pothos (prisma + relay plugins), Prisma/SQLite, Vitest, React + Apollo, graphql-codegen, oxlint/oxfmt.

**Spec:** `docs/superpowers/specs/2026-11-17-epub-collections-design.md`

## Global Constraints

- Work only in `.claude/worktrees/epub-collections` (branch `epub-collections`, based on `origin/main`). Run `git branch --show-current` before any command that moves HEAD.
- TDD: write the test first and watch it fail. Run focused tests only, e.g. `cd app/server && npx vitest run services/epub-parser.test.ts`. The full server suite takes over an hour on this machine; GitHub CI runs it.
- Lint from the repo root: `npm run lint`. After any GraphQL schema change: `npm run graphql:schema -w app/server`. After any client operation change: `npm run codegen -w app/client`, then `cd app/server && npm run test:cost`.
- UI name: **Collections** (singular "Collection"). Never "sets" or "lists" in UI copy.
- Collections come from files only. No create, rename or reorder mutation, and no change to `services/epub-writer.ts`.
- No backfill: existing books change only when re-imported.
- `Library.entries` stays `Book | Series`. Collections never appear as grid tiles.
- Subagents: sonnet by default, opus at most, never Fable.
- No push, merge or PR without the user's approval.

## Review Focus

1. **Collection names with URL-hostile characters** ("The Guardian's Best 100 Novels in English (2015)", names with `/`, `?`, `#` or `&`). The book-page link, the collection page route and the search chip must round-trip the exact name. Test in Task 8.
2. **Malformed refinements.** A `collection-type` with no `refines` (the existing multilingual tests use this), a `refines` pointing at a missing id, or a `group-position` that is empty, non-numeric or `"1.5"`. These must not throw. An unattached type is ignored. Positions parse to a float, or to `null` for sets / `0` for series, never `NaN`. Test in Task 1.
3. **A re-import whose file no longer has a collection.** The join row is removed, and a collection left empty is deleted, also when the book id rotates. Test in Task 3.
4. **Two users with the same collection name.** Separate rows. A user cannot fetch another user's collection by node id or by name. Test in Task 4.
5. **A collection whose last book is deleted.** The collection row is gone, `collectionByName` returns `null`, and the collection page shows its not-found state instead of crashing. Tests in Tasks 3, 4 and 8.

---

### Task 1: Parser — typed collections, correct series index

**Files:**
- Modify: `app/server/services/epub-parser.ts:441-455` (the `calibreSeries`/`collectionCandidates`/`groupPosition` loop)
- Modify: `app/server/types.ts` (`EpubMeta`, ~line 40)
- Test: `app/server/services/epub-parser.test.ts` (new `describe('EPUB 3 collections', …)` after the multilingual series tests, ~line 950)

**Interfaces:**
- Produces: `EpubMeta.collections: { name: string; position: number | null }[]`, always present (empty array when none). `EpubMeta.series`/`seriesIndex` keep their types.

Rules (from spec §1):
- `calibre:series` and `calibre:series_index` still win.
- A collection is **typed** when a `<meta property="collection-type" refines="#<its id>">` exists. Unattached `collection-type` metas are ignored.
- Series candidates are the collections typed `series`. If there are none, every **untyped** collection is a candidate. `pickLang` chooses among the candidates.
- The series index is the chosen collection's own refining `group-position`. When it has none, and **no collection in the file is typed**, fall back to the old rule: the last `group-position` in the file. Otherwise the index is 0.
- Sets are the collections typed `set`, never series candidates. Position is the set's own refining `group-position`, or `null`. Names go through `decodeEntities` and `trim`. Empty names are dropped. A duplicate name keeps its first entry.
- Any other `collection-type` value (unknown) is treated as untyped.
- Use `parseFloat`, and treat a non-finite result as missing.

- [ ] **Step 1: Write the failing tests.** Build the OPFs inline with `AdmZip` and `sharedContainerXml`, the way the multilingual tests do. Each test is one `it`:

```ts
it('treats a set-only book as having no series (Dracula)', () => {
  // collections: id=c1 "The Guardian's Best 100 Novels in English (2015)" type set pos 77;
  //              id=c2 "The BBC's 100 Greatest British Novels (2015)" type set pos 40
  expect(meta.series).toBe('');
  expect(meta.seriesIndex).toBe(0);
  expect(meta.collections).toEqual([
    { name: "The Guardian's Best 100 Novels in English (2015)", position: 77 },
    { name: "The BBC's 100 Greatest British Novels (2015)", position: 40 },
  ]);
});
it('takes the series index from the series collection, not the last group-position (Sherlock)', () => {
  // c1 "Sherlock Holmes" type series pos 3; then c2/c3/c4 type set with pos 10, 20, (none)
  expect(meta.series).toBe('Sherlock Holmes');
  expect(meta.seriesIndex).toBe(3);
  expect(meta.collections.map((c) => c.position)).toEqual([10, 20, null]);
});
it('keeps a single clean series as before (The Martian)', () => {
  // c1 "The Martian" type series pos 1
  expect(meta.series).toBe('The Martian');
  expect(meta.seriesIndex).toBe(1);
  expect(meta.collections).toEqual([]);
});
it('treats an untyped collection as a series and uses its own group-position', () => { /* c1 untyped pos 2, no other collections → series c1, index 2 */ });
it('falls back to the last group-position when nothing is typed', () => { /* untyped collection without id; unattached <meta property="group-position">4</meta> → index 4 */ });
it('ignores a collection-type refining a missing id', () => { /* type set refines #nope; collection c1 untyped → series c1, collections [] */ });
it('parses a fractional set position and nulls a non-numeric one', () => { /* sets with group-position "1.5" and "abc" → positions 1.5 and null */ });
it('drops empty set names and collapses duplicates keeping the first position', () => { /* sets "", "A"(1), "A"(2) → [{ name: 'A', position: 1 }] */ });
it('prefers calibre:series over a typed series collection', () => { /* calibre "X" #5 + series collection "Y" #2 → X / 5; collections [] */ });
```

- [ ] **Step 2: Run them and check they fail.** Run: `cd app/server && npx vitest run services/epub-parser.test.ts`. Expected: the new tests FAIL (`collections` is undefined, Dracula's series is not ''). Existing tests PASS.
- [ ] **Step 3: Implement.** Add `collections` to `EpubMeta`. In `parseEpub`, replace the loop: gather `belongs-to-collection` metas, plus maps from `refines` id to `collection-type` and to `group-position`. Apply the rules above. Keep `pickLang` for choosing among candidates.
- [ ] **Step 4: Run the whole parser file.** Run: `npx vitest run services/epub-parser.test.ts`. Expected: all PASS, including the four multilingual series tests (~line 884). Also run `npx vitest run services/import-epub.test.ts services/epub-import-pipeline.test.ts`. Expected: PASS. Fix any test helper that builds a full `EpubMeta` literal by adding `collections: []`.
- [ ] **Step 5: Commit.** `git commit -am "fix(parser): only typed series collections become the series; capture sets"`

### Task 2: Schema and migration

**Files:**
- Modify: `app/server/prisma/schema.prisma` (add `Collection` and `BookCollection` as in spec §2. Add `collections BookCollection[]` to `Book` and `collections Collection[]` to `User`)
- Create: `app/server/prisma/migrations/20261118000000_add_collections/migration.sql` (a no-op `SELECT 1;` with a comment, like `20261025000000_add_mcp`)
- Modify: `app/server/db/migrate.ts` (append `data_v25_collections` after `data_v24_book_ratings`)
- Test: `app/server/db/migrate.test.ts`

**Interfaces:**
- Produces: Prisma models `collection` (`id`, `userId`, `name`, `sortKey`, unique `userId_name`) and `bookCollection` (`userId`, `bookId`, `collectionId`, `position Float?`, id `userId_bookId_collectionId`). Tables `collections` and `book_collections`.

Why the data migration: the books and users tables are rebuilt by `data_v10`/`data_v11` from explicit column lists, so FKs created in the DDL pass get dropped (see `data_v23_mcp`'s comment).

- [ ] **Step 1: Write the failing test** in `migrate.test.ts`. After `runMigrations` on a fresh tmp DB, `PRAGMA table_info(collections)` lists `id, user_id, name, sort_key`, and `PRAGMA table_info(book_collections)` lists `user_id, book_id, collection_id, position`. Deleting a `books` row cascades its `book_collections` rows. Updating a book's `id` carries its rows along (`ON UPDATE CASCADE`). `collections_user_id_name_key` exists in `PRAGMA index_list(collections)`.
- [ ] **Step 2: Run** `npx vitest run db/migrate.test.ts`. Expected: FAIL (no such table).
- [ ] **Step 3: Implement** the schema models, the no-op DDL file and `data_v25_collections` (`CREATE TABLE IF NOT EXISTS`). FKs: `book_collections(user_id, book_id) → books(user_id, id)` ON DELETE CASCADE ON UPDATE CASCADE; `collection_id → collections(id)` ON DELETE CASCADE; `collections.user_id → users(id)` ON DELETE CASCADE. Add a unique index on `collections(user_id, name)` and an index on `book_collections(collection_id)`. Then run `npm run prisma:generate -w app/server`.
- [ ] **Step 4: Run** `npx vitest run db/migrate.test.ts`. Expected: PASS.
- [ ] **Step 5: Commit.** `git commit -am "feat(db): collections and book_collections tables"`

### Task 3: Keep collections in sync on import, re-import and delete

**Files:**
- Create: `app/server/services/book-collections.ts`
- Modify: `app/server/services/book-lifecycle.ts` (`addBook` ~line 160, `reimportBook` ~line 326 both id branches, the delete path ~line 221, `removeStaleBook`)
- Test: `app/server/services/book-collections.test.ts`, `app/server/services/book-lifecycle.test.ts` (new `describe('collections', …)`)

**Interfaces:**
- Consumes: `EpubMeta.collections` (Task 1), the Prisma models (Task 2).
- Produces:
  - `syncBookCollections(tx: Prisma.TransactionClient, userId: string, bookId: string, collections: EpubMeta['collections']): Promise<void>` replaces the book's join rows. It upserts each `Collection` by `userId_name`, with `id: randomUUID()` and `sortKey: seriesSortKey(name)`.
  - `pruneEmptyCollections(tx: Prisma.TransactionClient, userId: string): Promise<void>` runs `collection.deleteMany({ where: { userId, books: { none: {} } } })`.

- [ ] **Step 1: Write the failing tests.**
  - `book-collections.test.ts`: syncing `[{A,1},{B,null}]` then `[{B,2}]` leaves one row for B with position 2. Collection A survives sync but is removed by `pruneEmptyCollections`. The same name for two users makes two `Collection` rows.
  - `book-lifecycle.test.ts`: `addBook` with a Dracula-like meta creates two collections and two join rows, and `book.series` is ''. `reimportBook` after rewriting the file without one set removes that join row and deletes the now-empty collection, in both the same-id path and the id-rotation path. Deleting the book deletes collections that are left empty and keeps ones shared with another book.
- [ ] **Step 2: Run** `npx vitest run services/book-collections.test.ts services/book-lifecycle.test.ts`. Expected: the new tests FAIL.
- [ ] **Step 3: Implement.** Write `book-collections.ts`. Then, inside each existing transaction in `book-lifecycle.ts`, call `syncBookCollections` after the book row is written under its final id (`id` or `newId`). Call `pruneEmptyCollections` at the end of `addBook` (no-op safe), `reimportBook`, book delete and `removeStaleBook`.
- [ ] **Step 4: Run** the same command. Expected: PASS. Also run `npx vitest run services/import-epub.test.ts services/apply-epub-changes.test.ts`. Expected: PASS.
- [ ] **Step 5: Commit.** `git commit -am "feat(collections): sync book collections on import, re-import and delete"`

### Task 4: GraphQL — Collection node and Book.collections

**Files:**
- Create: `app/server/graphql/schema/collection/{index.ts,model.ts,node-loader.ts,model.test.ts}` (copy the `series/` module's shape)
- Create: `app/server/graphql/schema/book-collection-membership/{index.ts,model.ts}`
- Modify: `app/server/graphql/schema/book/model.ts` (add `collections`), `app/server/graphql/schema/library/model.ts` (add `collectionByName` next to `seriesByName` ~line 475), `app/server/graphql/schema/index.ts` (register the modules), `app/server/graphql/pagination.ts` (`CONNECTION_LIMITS.collectionBooks`, same numbers as `seriesBooks`)
- Regenerate: `app/server/graphql/schema.generated.graphql`

**Interfaces:**
- Consumes: Prisma models (Task 2).
- Produces (SDL):
  - `type Collection implements Node { id: ID!, name: String!, bookCount: Int!, books(first, after, last, before): CollectionBooksConnection! }`. `bookCount` uses `t.relationCount('books')`. `books` is a `t.relatedConnection('books')` over `BookCollection`, cursor `userId_bookId_collectionId`, ordered `[{ position: { sort: 'asc', nulls: 'last' } }, { book: { title: 'asc' } }, { bookId: 'asc' }]`. Nodes are `BookCollectionMembership`.
  - `type BookCollectionMembership { book: Book!, collection: Collection!, position: Float }` is a `prismaObject('BookCollection')`.
  - `Book.collections: [BookCollectionMembership!]!`, sorted by `collection.name` ascending.
  - `Library.collectionByName(name: String!): Collection`.
  - `findUnique` in `collection/node-loader.ts` scopes by viewer exactly like `series/node-loader.ts`.

- [ ] **Step 1: Write the failing tests** in `collection/model.test.ts`, using `createHarness` as `series/model.test.ts` does:
  - `collectionByName` returns name, `bookCount: 2`, and books ordered by position with nulls last.
  - `Book.collections` returns memberships sorted by name, with `position`.
  - Bob gets `null` for alice's collection via `collectionByName` and via `node(id:)`.
  - `collectionByName` for a deleted or unknown name returns `null`.
- [ ] **Step 2: Run** `npx vitest run graphql/schema/collection`. Expected: FAIL.
- [ ] **Step 3: Implement** the modules and fields, then run `npm run graphql:schema -w app/server`.
- [ ] **Step 4: Run** `npx vitest run graphql/schema/collection graphql/schema/book graphql/print-schema.test.ts graphql/cost-calibration.test.ts`. Expected: PASS. If cost calibration needs a weight for the new connection, follow how `seriesBooks` is listed there.
- [ ] **Step 5: Commit.** `git commit -am "feat(graphql): Collection node, Book.collections, Library.collectionByName"`

### Task 5: Library filter and search suggestions

**Files:**
- Modify: `app/server/types.ts` (`BookListFilters.collection?: string`; `SearchSuggestionsResponse` type adds `'collection'`)
- Modify: `app/server/services/library-page.ts` (`listBooksPage`)
- Modify: `app/server/services/search-suggestions.ts`
- Modify: `app/server/graphql/schema/library/entries-filter.ts` (`collection: t.string({ required: false })`), `search-suggestions-filter.ts` (`collection`), `suggestion-type/model.ts` (`COLLECTION: { value: 'collection' }`), and the `entries`/`searchSuggestions` resolvers that map filters
- Test: `app/server/services/library-page.test.ts`, `app/server/graphql/schema/library/entries-filter.test.ts`, `app/server/graphql/schema/library/search-suggestions.test.ts`

**Interfaces:**
- Produces: `LibraryFilter.collection: String`, `SearchSuggestionsFilter.collection: String`, `SuggestionType.COLLECTION`.

Behaviour:
- When `collection` is set, `listBooksPage` returns only books (including books that belong to a series, not series tiles) that have `collections: { some: { collection: { name } } }`, in normal library order. It composes with the other filters via AND, and with the cursor.
- Suggestions add a `collection` group: names matching `likePat` from `collections` for the user, ranked like the series group, `LIMIT 30`. The group is omitted when `filter.collection` is set. Other groups don't narrow by collection.

- [ ] **Step 1: Write the failing tests.**
  - `library-page.test.ts`: with a collection holding a standalone book and a series member, `{ collection }` returns both as book entries, no series entry, and paginates across pages of size 1.
  - `entries-filter.test.ts`: the `collection` filter reaches the service.
  - `search-suggestions.test.ts`: q "guard" returns a `COLLECTION` group with the Guardian name, and no `COLLECTION` group when `filter.collection` is set.
- [ ] **Step 2: Run** `npx vitest run services/library-page.test.ts graphql/schema/library`. Expected: FAIL.
- [ ] **Step 3: Implement**, then run `npm run graphql:schema -w app/server`.
- [ ] **Step 4: Run** the same command. Expected: PASS.
- [ ] **Step 5: Commit.** `git commit -am "feat(library): collection filter and search suggestions"`

### Task 6: OPDS

**Files:**
- Modify: `app/server/services/book-collections.ts` (add the two readers below)
- Modify: `app/server/routes/opds-templates.ts` (`bookEntry` takes optional `collections?: { id: string; name: string }[]` and emits one `<link rel="related" href="${baseUrl}/opds/collections/${id}" type="application/atom+xml;profile=opds-catalog;kind=acquisition" title="${name}"/>` each)
- Modify: `app/server/routes/opds.ts` (new `GET /collections/:collectionId`, next to `/series/:seriesId` ~line 276. Every acquisition feed passes the collection map into `bookEntry`.)
- Test: `app/server/routes/opds.test.ts`

**Interfaces:**
- Produces:
  - `listBooksByCollection(prisma, booksRoot, owner, collectionId): Promise<Book[]>`, ordered by position (nulls last), then title, then id. It returns `[]` for another user's collection.
  - `collectionsForBooks(prisma, owner, bookIds: string[]): Promise<Map<string, { id: string; name: string }[]>>`.

Use the same feed base as the series links (`feedBase`, not `origin`), so device feeds keep their prefix. Look at how `/series/:seriesId` builds hrefs and copy it.

- [ ] **Step 1: Write the failing tests.** The collection feed lists its books in position order and has the collection name as its title. Another user's collection id gives an empty feed. A book entry in the all-books feed carries a `rel="related"` link per collection.
- [ ] **Step 2: Run** `npx vitest run routes/opds.test.ts`. Expected: FAIL.
- [ ] **Step 3: Implement.**
- [ ] **Step 4: Run** the same command. Expected: PASS.
- [ ] **Step 5: Commit.** `git commit -am "feat(opds): collection feeds and related links"`

### Task 7: MCP tools

**Files:**
- Modify: `app/server/mcp/tools/get-book.ts` (`BOOK_DETAIL_FIELDS` adds `collections { position collection { id name } }`; output adds `collections: { id, name, position }[]`)
- Modify: `app/server/mcp/tools/search-library.ts` (optional `collection: z.string().max(200)` passed into `filter`)
- Create: `app/server/mcp/tools/get-collection.ts`, modelled on `get-series.ts`. Input is `id` or `name`. Output: `{ id, name, bookCount, books: BookSummary[] }` in collection order with each book's `position`. Error copy: `'No collection with that id or name in your library'`.
- Modify: the tool registry (wherever `registerGetSeries` is called)
- Test: `app/server/mcp/tools/execute.test.ts`, or the neighbouring tool test that covers `get_series`, following its pattern

- [ ] **Step 1: Write the failing tests.** `get_book` returns collections. `search_library { collection }` returns only member books. `get_collection` by name and by id returns ordered books. An unknown name gives the not-found error.
- [ ] **Step 2: Run** the test file. Expected: FAIL.
- [ ] **Step 3: Implement.** The tool descriptions say collections are curated lists from the book files, distinct from series.
- [ ] **Step 4: Run** the test file. Expected: PASS.
- [ ] **Step 5: Commit.** `git commit -am "feat(mcp): collections in get_book, search_library filter, get_collection"`

### Task 8: Client — book page line and collection page

**Files:**
- Modify: `app/client/src/router/path-internal.ts`, `path.ts`, `path-key.ts`, `path-key-internal.ts` (`collection(name)` → `/library/collection/${encodeURIComponent(name)}`. The path matches the existing `/library/series/:name` convention, not the spec's `/collection/<name>`.)
- Modify: `app/client/src/router/component.tsx` (route)
- Create: `app/client/src/page/collection/{index.tsx,style.ts,index.test.tsx}`, modelled on `page/series`
- Modify: `app/client/src/page/book/query.ts` (select `collections { position collection { id name } }`), `app/client/src/page/book/index.tsx`, `app/client/src/page/index.ts`
- Test: `app/client/src/page/book/index.test.tsx`, `app/client/src/router/path.test.ts`, `app/client/src/page/collection/index.test.tsx`

**Interfaces:**
- Consumes: `Library.collectionByName`, `Collection.books`, `Book.collections` (Task 4).
- Produces: `path.collection(name: string): string`.

UI:
- On the book page, a "Collections" row sits where subjects render. Each name is a link to `path.collection(name)`, followed by ` #<position>` when the position is not null. The row is hidden when the book has no collections.
- The collection page has a header with the name and "N books". Books are listed with the series page's row component, in API order, with `#position` shown when present. A not-found state like the series page's. The back link goes to the library.

- [ ] **Step 1: Write the failing tests.**
  - `path.test.ts`: `path.collection("The Guardian's Best 100 Novels in English (2015)")` and `path.collection('A/B?C#D&E')` round-trip through the route param to the exact name.
  - `book/index.test.tsx`: the Collections row renders names with `#77` and links to the collection path, and is absent with no collections.
  - `collection/index.test.tsx`: renders ordered books with positions. An unknown name renders the not-found state.
- [ ] **Step 2: Run** `cd app/client && npx vitest run src/router/path.test.ts src/page/book src/page/collection`. Expected: FAIL.
- [ ] **Step 3: Implement**, then run `npm run codegen -w app/client` and `cd app/server && npm run test:cost`.
- [ ] **Step 4: Run** the client tests again and `npm run test:cost`. Expected: PASS.
- [ ] **Step 5: Commit.** `git commit -am "feat(client): collections on the book page and a collection page"`

### Task 9: Client — search suggestion and library filter chip

**Files:**
- Modify: `app/client/src/lib/book-types.ts` (`BookListFilter.collection?: string`), `app/client/src/lib/use-book-list-filter.ts` (URL param `collection`), `app/client/src/page/library/to-library-filter.ts`, `app/client/src/page/library/index.tsx` (count `collection` as an active filter, ~line 245)
- Modify: `app/client/src/component/search-bar/index.tsx` (chip kind `'collection'`, label `'Collection'`, add/remove handling, dropdown style key), `use-search-suggestions.ts` (map `COLLECTION`, pass `collection` in the suggestions filter), `app/client/src/graphql/search-suggestions.ts` if it selects the filter
- Test: `use-book-list-filter.test.ts`, `to-library-filter.test.ts`, `component/search-bar/use-search-suggestions.test.ts`, and the search-bar test

- [ ] **Step 1: Write the failing tests.** `?collection=A%2FB` parses to `{ collection: 'A/B' }` and serializes back. `toLibraryFilter({ collection: 'X' }).collection === 'X'`. Choosing a `COLLECTION` suggestion sets `filter.collection` and shows a removable "Collection" chip. The placeholder copy becomes `'Search by title, author, series, collection, subject, status, or type…'`.
- [ ] **Step 2: Run** `cd app/client && npx vitest run src/lib src/page/library src/component/search-bar`. Expected: FAIL.
- [ ] **Step 3: Implement**, then run `npm run codegen -w app/client`.
- [ ] **Step 4: Run** the same command, then `cd app/server && npm run test:cost`. Expected: PASS.
- [ ] **Step 5: Commit.** `git commit -am "feat(client): collection search suggestions and library filter"`

### Task 10: Verify, screenshots, hand-off

**Files:**
- Create: `docs/screenshots/2026-11-18-epub-collections/{book-page.png,collection-page.png,search-suggestions.png}`

- [ ] **Step 1:** From the repo root, run `npm run lint`. Expected: exit 0.
- [ ] **Step 2:** Re-run every focused test file touched in Tasks 1–9. Expected: all PASS.
- [ ] **Step 3:** Start the server and client dev servers and import the Dracula and Sherlock fixtures (`git show origin/docker-deploy:app/server/demo-seed/fixtures/<file>` into a temp dir). Check: Dracula shows no series and two collections. Sherlock shows "Sherlock Holmes #3". Take the three screenshots with `playwright screenshot --full-page <url> <file>` and view each PNG.
- [ ] **Step 4:** Commit the screenshots: `git commit -m "docs: collections screenshots"`.
- [ ] **Step 5:** Stop. Ask the user before pushing, opening the PR (screenshots embedded), or merging into `preview` with `docker-deploy` to check alice's library.
