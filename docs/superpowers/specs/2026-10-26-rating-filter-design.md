# Rating filter — design

Date: 2026-10-26
Status: design. Every "Decision" below is the author's call unless marked as
the requester's.

Follows `2026-10-25-book-ratings-design.md`, which shipped the five ratings
and the taste profile and left "library browsing by rating and a
`search_library` rating filter" as an open question. This is that question
answered.

## Intent

Let the reader and the reader's assistant find books by how the reader rated
them. The requester's two moments:

- In the library: "which books did I love overall?" One filter on the
  Overall rating, picked from the search bar the way Status and Type are
  picked today, shown as one chip.
- Through the MCP server, when asking an assistant for recommendations: "a
  book where I'd love the overall book and the ideas, while putting less
  emphasis on the other dimensions." A minimum per dimension, combinable
  with the subject, author and status filters `search_library` already has,
  which the taste profile's flat favourites list cannot do.

The request (requester's words): "I'm considering searching ratings. It
feels like a thing that search should support, I'm just not sure how it
would work with so many dimensions … more like 'which books did I love
overall'. I also see it as a tool exposed to the MCP if I'm asking an LLM to
make book recommendations … I'd like the LLM to be able to filter on a
sub-dimension too."

The resolution of "so many dimensions": the four sub-ratings exist to
EXPLAIN a rating, not to find books by. The SPA filters on Overall alone.
The GraphQL filter and the MCP tool accept a minimum for any of the five,
ANDed, so a sub-dimension is reachable where an assistant can phrase it and
absent where a human would have to pick it from a list.

## Goals

- A `Rating` quick-pick group in the search bar's dropdown, beside Type and
  Status: Love, Great or better, Nice or better, Unrated. Each is one chip,
  removable like any other, and lives in the URL like every other filter.
- The same filter reachable by typing: "love" or "great" in the search box
  surfaces the matching Rating item, as typing "completed" surfaces the
  Status item today.
- The GraphQL `LibraryFilter` gains `minRating` (five optional minimums)
  and `unrated`. The SPA only ever sends `minRating.overall` or `unrated`.
- `search_library` exposes all five minimums and `unrated`, and its book
  summaries carry the full five-field rating so an assistant that filtered
  on Ideas can see the Ideas score without a `get_book` per result.
- Every rated book row in the library grid shows its Overall as the rating
  picker's glyph plus the value's name (requester's pick, option A of three
  shown: always, only while a rating filter is active, never). Colour is
  settled under "Book rows" below.
- Under a rating filter, series rows keep appearing when a member book
  qualifies, AND the qualifying member books appear as rows of their own,
  the way a text query already expands series members today (requester's
  choice, over series-row-only). An assistant asking for "overall 5 and
  ideas 4" gets the books, not a list of series to open; the reader with a
  "Love" chip sees the series and, beneath it alphabetically, the loved
  books in it.

## Non-goals

- Sorting the library by rating.
- Filtering on a sub-dimension in the SPA (no Story/Characters/Writing/Ideas
  chips). The GraphQL input supports it; nothing in the search bar sends it.
- Maximums, ranges, or "exactly N". Minimums only. "Exactly Love" is
  `overall ≥ 5`; nothing else was asked for.
- Changes to `get_taste_profile`. Its favourites list stays as is.
- Rating glyphs on series rows (a series is not rated) or on the series
  page's member rows (`SeriesBookRowFragment`). Only the library grid's
  `BookRowFragment` path shows the glyph. The series page is a reasonable
  follow-up and the row component will be ready for it.
- Ratings over OPDS or REST, as before.

## Anti-goals (would make this a failure even if it worked)

- A rating filter that silently drops every series. Series are a large part
  of a library; a filter that returns only standalones under "Love" would
  look like data loss. Series rows and their qualifying members must both
  appear (see "Series under a rating filter").
- Zero meaning anything. `unrated` is a separate boolean; a minimum of 0 is
  rejected by validation. Null stays null end to end.
- A filter that breaks pagination. The cursor logic in `listBooksPage`
  composes `AND` clauses onto a `bookWhere` that already carries the cursor
  predicate; the rating clauses must be added the same way the subject and
  query clauses are, never by overwriting `bookWhere`.
- The glyph taking a colour of its own that fights the row. It is drawn in
  the text colour via the existing `EmojiIcon` mask, so it follows hover,
  selection and dark mode like every other icon. No filter, no fixed hex.

## Constraints

- Both the SPA and MCP read through the same GraphQL field (`Library.entries`
  with `LibraryFilter`). No second business-logic path (the MCP server
  design's standing rule).
- `BookListFilters` (`app/server/types.ts`) and the `LibraryFilter` input
  (`graphql/schema/library/entries-filter.ts`) mirror each other
  field-for-field; `entries-filter.test.ts` pins that. Both change together.
- The client `BookListFilter` (`lib/book-types.ts`) is URL state; its
  reader/writer is `lib/use-book-list-filter.ts`, and `page/library/
  to-library-filter.ts` maps it onto the wire shape with a tested table.
  The new fields follow that path, not a shortcut.
- `page/library/index.tsx`'s `LibraryEntriesDocument` has a measured cost
  comment (breadth 47, complexity 6007). Adding `rating { overall }` to
  `BookRowFragment` changes it; re-measure with `npm run test:cost -w
  app/server` and update the comment, as the ratings project did for the
  book page.
- `services/library-page.ts`'s `BOOK_SELECT` already includes the five
  rating columns (the `Book.rating` resolver reads them), so no select
  change is needed for the grid. `entries.test.ts`'s coverage test still
  applies.

## Decisions

### Filter semantics

A book matches `minRating` when, for every dimension given, the book's
value for that dimension is not null and is ≥ the minimum. Dimensions not
given are ignored. A book matches `unrated` when its Overall is null,
regardless of the sub-ratings (a book can have a Story rating and no
Overall; it is "unrated" in the sense the reader means: no verdict yet).

`minRating` and `unrated` may be sent together. There is no validation
error: `unrated: true` with `minRating.story: 4` is coherent ("books whose
story I rated but never gave a verdict") and nobody needs a rule to forbid
it. `unrated: true` with `minRating.overall` set is simply empty.

Each minimum is validated 1–5 (integer). Out of range is a GraphQL
validation error at the field, not a silent clamp. `unrated: false` is the
same as absent.

### Series under a rating filter (requester's)

A rating filter is "active" when `minRating` has at least one dimension set
or `unrated` is true. While one is active:

- A series row appears when at least one of its books, taken on its own,
  meets every minimum given (for `unrated`, has a null Overall).
- The member books that qualify appear as their own book rows, interleaved
  by title with the standalones exactly as they are under a text query
  today. The book-side `where` drops its `seriesId: null` restriction, the
  same switch `queryExpandsToSeriesBooks` flips in `listBooksPage`; that
  flag becomes "query OR rating filter active". The `seriesName` and
  `entryType: 'standalone'` exclusions that already gate the text-query
  expansion gate this one too.

Why "any book clears all minimums" and not "the series' best in each
dimension": the reader's question is "is there a book in here I loved",
and the expansion puts that book on screen, with its glyph, beside the
series it belongs to.

Implementation: a Prisma `books: { some: { …clauses } }` relation filter on
`Series` expresses "at least one member matches" directly, with the same
AND-of-column clauses used on books. `seriesWhere` already composes a
`books: { some }` for the text query, so this composes too (verified by the
builder check). `seriesIdsForStatus`'s raw approach is not needed.

A rating filter combined with a text query behaves as the intersection:
member books must match both; the series row stays if any member matches
the title query (existing rule) and any member matches the rating (new
rule). Those need not be the same book; that is the existing looseness of
the text-query rule, not new.

### GraphQL

```graphql
"Minimum rating per dimension, 1–5. Dimensions left null are not filtered."
input RatingMinimums {
  overall: Int
  story: Int
  characters: Int
  writing: Int
  ideas: Int
}

input LibraryFilter {
  # existing fields unchanged …
  "Keep books (and series with a book) meeting every minimum given."
  minRating: RatingMinimums
  "Keep books (and series with a book) that have no overall rating."
  unrated: Boolean
}
```

Field names in `RatingMinimums` are the five `RATING_FIELDS` names, in the
same order everywhere (Overall, Story, Characters, Writing, Ideas).

Range validation: `graphql/schema/builder.ts` deliberately bans
`@pothos/plugin-validation`, and the one existing bounded int on a query
field (`favourites(minOverall)`) clamps, which this document's anti-goal
forbids. Follow the reject-not-clamp precedent in `graphql/schema/
pagination.ts` (`rejectOversizePage`): check the five minimums inside the
`Library.entries` resolver after auth and throw a `GraphQLError` with an
`extensions.code` and `http.status: 400` for anything outside 1–5 or
non-integer.

`BookListFilters` gains `minRating?: Partial<Record<RatingFieldName,
number>>` and `unrated?: boolean`. `library/model.ts`'s mapping from
`args.filter` to `BookListFilters` passes both through.

### Service

In `listBooksPage`:

- Books (standalone and, with the expansion above, series members): for
  each given minimum, an `AND` clause `{ [RATING_COLUMNS[field]]: { gte:
  n } }` (Prisma's `gte` on a nullable column excludes nulls). For
  `unrated`, `{ ratingOverall: null }`. Added with the same "append to
  existing `AND`" composition the text query uses, so the cursor predicate
  survives in all three cursor branches (no cursor, after a series, after a
  book).
- Series: `books: { some: { AND: [same clauses] } }`.
- One helper builds the clause list from `BookListFilters` once and both
  sides use it; `RATING_COLUMNS` and `RATING_FIELDS` from
  `services/rating.ts` are the only source of the field-to-column mapping.

`library-page.test.ts` gains cases for: overall minimum on standalones;
two minimums ANDed; null excluded by a minimum; `unrated`; series kept when
one member qualifies and dropped when none does; qualifying member books
appear as rows and non-qualifying siblings do not; the expansion is
suppressed by `seriesName` and by `entryType: 'standalone'`; filter
composed with a cursor on page two, in both the after-series and
after-book branches; filter composed with a text query. The existing
"fetches every book exactly once" test must keep passing.

### URL state and client filter

`BookListFilter` gains `minOverall?: 1 | 2 | 3 | 4 | 5` and `unrated?:
true`. The client never carries sub-dimension minimums (non-goal), so the
client type is narrower than the wire type on purpose.

URL: `minOverall=4`, `unrated=1`. Both parsed strictly in
`filterFromSearchParams`: `minOverall` must be one of `1`–`5`, anything
else ignored; `unrated` is present-and-`1` or absent. `filterToSearchParams`
writes them back the same way. If both are somehow present in a pasted URL,
both are kept and sent; the result is an empty grid, which is what the URL
asked for.

`toLibraryFilter` maps `minOverall` to `minRating: { overall }` and
`unrated` straight through, with a test row each, as the status and type
tables have.

A pasted URL may carry `minOverall=1` or `=2`, which no quick pick
produces. The chip still renders and is still removable; its label is
derived from the value's name ("Okay or better", "Bad or better") rather
than from the quick-pick table, so every valid URL state has a chip.

`page/library/index.tsx`'s "has any filter active" check (the empty-state
copy) includes both new fields.

### Search bar

`use-search-suggestions.ts` gains a `rating` suggestion type and a
`RATING_OPTIONS` list:

| Label | value | sends |
|-------|-------|-------|
| Love | `5` | `minOverall: 5` |
| Great or better | `4` | `minOverall: 4` |
| Nice or better | `3` | `minOverall: 3` |
| Unrated | `unrated` | `unrated: true` |

Okay-or-better and Bad are left out of the quick picks: the first is nearly
every rated book and the second is a list nobody asked for. Both remain
reachable by URL (`minOverall=2`, `minOverall=1`) and through the MCP.

Behaviour, matching Status exactly:

- Empty input: the `Rating` group appears after Type and Status, omitted
  when a rating filter (`minOverall` or `unrated`) is already active.
- Typed input: each `RATING_OPTIONS` label goes through the same
  `matchInfo` prefix/subsequence check the Status labels use, so "lov",
  "great", "unr" surface the item. The group is omitted when a rating
  filter is active.
- `applySelection` sets `minOverall` or `unrated` and clears the other.
  `removeChip` clears whichever is set.
- One chip kind, `rating`, labelled "Rating", with its own chip class and
  dropdown-item class in `search-bar/style.ts` (a new colour slot in the
  chip palette; the builder picks a hue not already used by the five
  existing kinds, from the theme's palette, in both themes).
- The dropdown item and the chip both render the glyph for the threshold
  value (`RATING_OPTIONS` from `control/rating-picker` maps value →
  `Icon`) before the label, at the chip's text size, in `currentColor`.
  Unrated has no glyph.
- `use-search-suggestions.test.ts` gains the Rating cases mirroring the
  Status ones (empty-input group, typed match, omitted when active).

### Book rows

`BookRow` (`component/book-row/index.tsx`) gains an optional
`overallRating?: 1 | 2 | 3 | 4 | 5` prop. When present, the row's meta line
ends with the glyph and the value's name ("👏 Great", glyph drawn by the
rating picker's `Icon`, name from `RATING_OPTIONS`), in the same muted
meta colour the rest of the meta line uses: it is information, not an
accent, and the theme has no rating colour token to borrow. (The mockup
the requester approved drew it in the chip's brown; that was the mockup's
shorthand for "tinted like text", which the mask gives us in whatever the
surrounding text colour is.) The meta line is a string array joined with
" · " today; it becomes a node list so the glyph can sit in it. When the
prop is absent (unrated, or a caller that doesn't pass it) nothing
renders.

`BookRowFragment` (`from-entry.tsx`) adds `rating { overall }` and the
adapter maps it (`toRatingValue`-style guard: out-of-range reads as
absent). `SeriesBookRowFragment` is unchanged (non-goal).

Apollo cache: `BookRating` has no id, and the book page selects all five
fields while this fragment selects one. Without a merge policy Apollo
replaces the object and warns about field loss when the two documents
write the same book. Add `BookRating: { merge: true }` to the type
policies in `provider/apollo/cache.ts`.

### MCP

`search_library`:

- Input gains `minOverall`, `minStory`, `minCharacters`, `minWriting`,
  `minIdeas` (each `z.number().int().min(1).max(5).optional()`) and
  `unrated: z.boolean().optional()`. Flat names rather than a nested
  object: every other argument on this tool is flat, and flat names are
  what an assistant reliably fills in.
- The tool maps them onto `filter.minRating` / `filter.unrated`.
- The description gains one sentence teaching the semantics: "Rating
  minimums are 1 Bad … 5 Love, ANDed; `unrated` keeps books with no
  overall rating. Under a rating filter, books inside a series are listed
  individually alongside their series."
- `BOOK_SUMMARY_FIELDS` changes `rating { overall }` to the full
  `RATING_FIELDS_GQL`, `bookSummarySchema` gains `rating: ratingSchema`
  alongside the existing `overallRating` (kept for compatibility with
  anything already reading it), and `summarizeBook` fills both. This
  widens every tool that uses the summary (`get_series`,
  `list_reading_progress`, …) by four nullable integers per book; the
  text rendering (`describeBook`) is unchanged, so the human-readable
  output does not grow. `describeBook` continues to say "rated Great"
  from the overall only.
- `app/server/mcp/server.test.ts` (the SDK client over Streamable HTTP, via
  `mcp/test-support.ts`) is where MCP tools are exercised end to end; it
  already has a "search_library summaries carry overallRating" case to
  extend. Cover: minimums reach the filter, out-of-range rejected by zod,
  summary carries the five fields.

### Documentation

- The ratings spec's open question is answered by this document; add a
  one-line pointer there.
- `CHANGELOG.md` is generated by the release pipeline from PR titles
  (`.github/workflows/release-prepare.yml`); do not hand-edit it. The PR
  title carries the entry.

## What's left to the builder

- Chip and dropdown-item colour for the new `rating` kind, in both themes.
- A name for the search bar's rating quick-pick list that does not clash
  with `control/rating-picker`'s exported `RATING_OPTIONS`.
- Re-measured cost numbers for `LibraryEntriesDocument`.

(The series relation filter is known to compose: `seriesWhere` already
uses `books: { some: … }` for the text query. The raw-aggregate fallback
should not be needed.)

## Open items

None blocking. The series page's member rows showing the glyph, and sorting
by rating, are the two obvious follow-ups; neither is in this project.
