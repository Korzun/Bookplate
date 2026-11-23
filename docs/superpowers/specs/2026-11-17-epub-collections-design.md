# EPUB collections (sets) and the series importer fix

Date: 2026-11-17
Branch: `epub-collections`, based on `main`

## Intent

EPUB 3 tags a book's collections with `<meta property="belongs-to-collection">`.
A refining `collection-type` meta says whether it is a `series` (a real series)
or a `set` (a curated list, e.g. "The Guardian's Best 100 Novels in English
(2015)"). Bookplate's importer ignores the type, so Standard Ebooks books land
in reading lists as their "series", often with the position from a different
collection. Alice's preview library shows four "series" tiles that are mostly
reading lists.

We want:

1. The importer to put only real series into `Book.series`, with the right index.
2. Sets kept as their own first-class thing ("Collections" in the UI): a book
   belongs to any number of them, each with an optional position, and users can
   see and browse them.

## Goals

- Correct series and index for every newly imported or re-imported book.
- Collections captured on import and shown on the book page, on a collection
  page, in search suggestions, as a library filter, in OPDS and MCP.

## Non-goals

- Hand-made collections. Collections come from files only: no create, rename,
  add/remove or reorder. The data model leaves room to add this later.
- Writing collections back to the EPUB. `services/epub-writer.ts` stays as is;
  it already leaves `belongs-to-collection` metas untouched, so edits preserve
  them.
- An index page listing all collections, a top-level OPDS collections
  navigation feed, or a `list_collections` MCP tool. Collections are reached
  from a book and from search. Easy to add later.
- Fixing already-imported books (see Existing books).
- Changes to the demo seed. It imports through the real pipeline and will show
  the right data once this lands.

## Anti-goals

- Collections must not appear as tiles in the library grid or collapse books
  the way a series does. A book in three sets must still appear once.
- A `set` must never become a book's series.
- Regressing current behaviour for untyped `belongs-to-collection`,
  `calibre:series` precedence, or the multilingual series handling
  (`services/epub-parser.test.ts`, ~line 884).

## Decisions

### 1. Importer fix (`services/epub-parser.ts`, ~lines 441–455)

Group collection metas by their `id`. For each `belongs-to-collection` element
with an id, find the metas that refine `#<id>`: `collection-type` and
`group-position`.

- **Series:** `calibre:series` (with `calibre:series_index`) still wins when
  present. Otherwise, take the collections typed `series` and choose among them
  with the existing `pickLang` (language preference), so multilingual files
  behave as today. The index is that collection's own refining
  `group-position`, or 0.
- **No typed series, but untyped collections:** keep today's behaviour. An
  untyped `belongs-to-collection` (no `collection-type` refinement) is still a
  series candidate via `pickLang`. Its index is its own refining
  `group-position` when it has one. When it has none, fall back to today's rule
  (the last unattached `group-position` in the file) only when no collection has
  a type, so files that relied on the old behaviour still import the same way.
- **Sets:** every collection typed `set` becomes an entry in the book's
  collections, with its own refining `group-position` as the position (null
  when absent). A `set` is never a series candidate.
- Collection names go through `decodeEntities` and trimming, like series. Empty
  names are dropped. Duplicate names within one book collapse to one entry and
  keep the first position seen.
- `EpubMeta` (`types.ts`) gains `collections: { name: string; position: number | null }[]`.

Fixture cases to test (from Standard Ebooks; CC0 copies live in
`app/server/demo-seed/fixtures/` on `docker-deploy`; inline-OPF tests are fine):

| Book | Expected series / index | Expected collections |
|---|---|---|
| Dracula (sets only) | none | its sets, each with its own position (77 is the Guardian set's) |
| Pride and Prejudice | none | its sets |
| Adventures of Sherlock Holmes | "Sherlock Holmes" / 3 | its three sets with their own positions |
| The Martian books | unchanged | none |

### 2. Data model (`prisma/schema.prisma`)

New models, per user like `Series`:

```prisma
model Collection {
  id       String @id
  userId   String @map("user_id")
  name     String
  sortKey  String @map("sort_key")
  user     User   @relation(fields: [userId], references: [id], onDelete: Cascade)
  books    BookCollection[]

  @@unique([userId, name])
  @@map("collections")
}

model BookCollection {
  userId       String @map("user_id")
  bookId       String @map("book_id")
  collectionId String @map("collection_id")
  position     Float? // the set's group-position for this book, if any
  book         Book       @relation(fields: [userId, bookId], references: [userId, id], onDelete: Cascade, onUpdate: Cascade)
  collection   Collection @relation(fields: [collectionId], references: [id], onDelete: Cascade)

  @@id([userId, bookId, collectionId])
  @@map("book_collections")
}
```

- `sortKey` uses the same `utils/series-sort-key.ts` rule as series.
- No cached aggregates (bookCount etc.) in v1. Counts are computed on read;
  collections are small. The builder may add a cached `bookCount` if a query
  needs it.
- The book relation cascades on update, like `PendingFix`, so a book id
  rotation (file rewrite) carries its collections along. Check what
  `reimportBook` does on id rotation (it may create a new row and delete the
  old one, ~line 441) and make collections follow in whichever way it uses.
- A migration adds the two tables. It does not populate them.

### 3. Import upkeep (`services/book-lifecycle.ts`)

- `addBook`: inside the existing transaction, upsert a `Collection` per name
  (`userId_name`), then create the `BookCollection` rows.
- `reimportBook`: replace the book's `BookCollection` rows with the freshly
  parsed set, and delete any `Collection` left with no books.
- Book delete: the join rows cascade; delete any `Collection` left empty.
- Mirror how these paths already handle `Series` rows (upsert by name, delete
  when emptied).

### 4. Existing books

No backfill and no migration data fix. A book already in the database is
corrected the next time it is re-imported (metadata edit, file replace,
chapter regeneration, pending-fix resolution, or a fresh upload). The number of
affected books is small, and we don't want a long-running startup job.

### 5. GraphQL (`graphql/schema/`)

- `Collection` node: `id`, `name`, `bookCount`, and `books` (a connection,
  ordered by position ascending with nulls last, then title, then id). Add
  progress or rating summaries only if the collection page needs them; reuse
  the `series-progress` loader pattern if so.
- `Book.collections: [BookCollectionMembership!]!` with `collection` and
  `position` (nullable). Sorted by collection name.
- A query to fetch a collection by name for the current library, mirroring how
  the series page looks up a series by name.
- `LibraryFilter.collection: String` filters `entries` to books in that
  collection. When it is set, entries are books only (no series tiles), like
  the existing `seriesName` filter.
- `SuggestionType.COLLECTION` and a matching group in search suggestions.
- `Library.entries` stays `Book | Series`.
- Regenerate the GraphQL schema and client codegen.

### 6. Client (`app/client/src`)

UI name: **Collections**.

- **Book page** (`page/book`): a "Collections" line near Series/Subjects. Each
  name links to its collection page and shows `#position` when there is one.
- **Collection page** (new, `/collection/<name>`, modelled on `page/series`):
  name, book count, and the books in collection order, showing each book's
  position when present.
- **Search:** a "Collections" suggestion group. Picking one sets the library's
  `collection` filter (URL-driven, like `subject` in `use-book-list-filter`).
- **Library:** the `collection` filter shows as an active filter that can be
  cleared, like the other filters. No collection tiles.

### 7. OPDS (`routes/opds.ts`)

- Each book entry gets a related link per collection pointing to that
  collection's acquisition feed.
- A per-collection feed listing its books in collection order.
- No top-level collections navigation feed (matches the no-index decision).

### 8. MCP (`mcp/tools/`)

- `get_book`: include `collections` (name, position).
- `search_library`: accept an optional `collection` filter.
- New `get_collection`: by name, returning the collection and its books in
  order (modelled on `get_series`).
- `get_series` / `list_series`: unchanged. They get correct data once books are
  re-imported.

## Approaches considered (existing books)

- **A. One-time startup backfill**, which re-reads every stored OPF and fixes
  series and collections. It fixes everything automatically, but it is a pass
  over every file on first boot. Rejected: few books are affected, and the user
  doesn't want a long-running backfill.
- **B. Fix on next re-import (chosen).** No extra code. Wrong series persist on
  untouched books until their next re-import.
- **C. A pending-fix proposal per affected book.** Rejected: it makes users
  approve the fallout of our parser bug book by book, and still needs a new
  proposal type to carry collections.

## Constraints

- TDD. The full server suite takes over an hour on the Pi, so run focused tests
  locally and let CI run the full suite.
- `npm run lint` from the repo root (oxfmt).
- The PR includes screenshots (book page with collections, collection page,
  search suggestions) committed to `docs/screenshots/2026-11-17-epub-collections/`.
- Check the result on the `preview` branch with alice's library. It needs the
  demo seed, so merge this branch into `preview` (with `docker-deploy`) to
  check, and only after approval.

## Left to the builder

- Exact component structure and styling, following existing series and subject
  components.
- Whether `Collection.bookCount` is cached or computed.
- Query shapes and resolver organisation, following the `series/` schema
  module layout.
- Test placement, following the existing `*.test.ts` neighbours.
