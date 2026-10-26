# Book ratings — design

Date: 2026-10-25
Status: design. Every "Decision" below is the author's call unless marked as
the requester's.

## Intent

Let a reader record how they felt about a book: one overall rating plus four
sub-ratings that explain it, each a whole number from 1 (bad) to 5 (love),
each shown as a named hand-gesture icon so a value is recognisable at a glance
without counting symbols. Rating happens in place on the book page, with no
trip through the metadata edit form, and the same ratings are readable and
writable through the MCP server so an assistant can answer "what did I think
of X?", record a rating the reader dictates, and, the purpose the requester
settled on, use the ratings to GIVE AND GET RECOMMENDATIONS: pick the next
book from the shelf, suggest new ones like the Love ones, and help the
reader tell a friend why they'd like a book.

The request (requester's words, across the conversation): "add the ability to
rate books … a Total rating, and some small number of sub ratings. I often
'like' a book's story even if the prose is bad. Or really like the characters
if the story is flat … display the rating and allow editing of it without
having to jump into editing the whole book's metadata … supported in both the
UI and the MCP … a 6-point scale, and not allow half-steps (0:null, 1:bad,
2:okay, 3:nice, 4:great, 5:love) these should be accompanied by an icon to
make the number easily to visually identify. I like this design from Dribbble
https://dribbble.com/shots/27657779-Rating-icons … I want this rating system
to be useful to the user and help them get/give recommendations … let's go
forward with Story, Characters, Writing, and Ideas. Let's also include those
two MCP additions" (the taste profile: per-field means and the Love shelf,
below).

## The scale (requester's)

| Value | Name | Icon (hand-gesture emoji, drawn flat in the text colour) |
|-------|------|----------------------------------------------------------|
| unrated | — | none; the "0" of the requester's six-point framing |
| 1 | Bad | 👎 thumbs down (U+1F44E) |
| 2 | Okay | 👌 OK hand (U+1F44C) |
| 3 | Nice | ✌️ victory hand (U+270C U+FE0F) |
| 4 | Great | 👏 clapping hands (U+1F44F) |
| 5 | Love | 🤟 love-you gesture, ASL "I love you" (U+1F91F) |

Values are integers only. "Unrated" is stored and transported as null, never
as 0; 0 is accepted on the MCP input as a synonym for "clear" (below) because
that is how the requester names it, and it is never a stored or returned
value.

The reference design (the Dribbble shot, screenshot reviewed): five outline
icons in a row with equal spacing, the selected one marked out, and the name
under each icon. The shot also shows vote counts under the names; those do
not apply here. *Revised after the first build:* the filled circles were
replaced by the app's own segmented-control style (track, sliding lens),
each rating got a row of its own, and the rows moved into their own card,
per the maintainer's review of the first version.

## Goals

- Five ratings per book: **Overall**, **Story**, **Characters**, **Writing**,
  **Ideas**. Each is independent, each is 1 to 5, and each can be unrated.
- Inline editing on the book page: tap an icon, it saves. No edit mode, no
  save button, no modal.
- Every value is identifiable by its icon alone, in both themes, at the
  small size the sub-ratings use.
- Ratings are readable from `get_book` and writable through a new `rate_book`
  MCP tool, whose description teaches an assistant the names and what each
  sub-rating judges.
- Ratings survive everything that keeps the book: metadata edits (which give
  the book a new id), EPUB replacement, chapter regeneration, validation,
  re-scan of an unchanged file. Known limitation (author's call): an EPUB
  whose bytes change on disk OUTSIDE the app (Calibre writing into it, say)
  is imported by `scan` as a new row and the old row is removed, and the
  rating goes with the old row. `scan` has no notion of the old id for a
  changed file, and teaching it one is a separate project. Same fate as
  that book's validation and pending fixes today.

## Non-goals

- Writing the rating into the EPUB file (Calibre's `calibre:rating` meta) or
  reading one out of it on import. A rating is the reader's opinion about the
  work, not file metadata; it never triggers an EPUB rewrite or an id change.
- Computing the overall from the sub-ratings, or any weighting scheme. The
  requester's whole motivation is that the parts and the whole disagree.
- Half-steps, decimals, or any scale other than 1–5.
- Mood and pace descriptors (see the sub-ratings section). A follow-up.
- Any recommendation logic on the server. The server exposes the ratings and
  a taste profile; the assistant (or the reader) does the recommending.
- Reviews, notes, or free text alongside a rating.
- Rating a series.
- Library browsing by rating (rows, sort, filter) and a `search_library`
  rating filter. Listed as an **open question** below; not in this project
  unless the requester says so.
- Exposing ratings over OPDS or any REST route.

## Anti-goals (would make this a failure even if it worked)

- A rating that vanishes when the reader fixes a typo in the title. Every
  path that rewrites the EPUB updates the book row in place
  (`services/book-lifecycle.ts`'s `reimportBook` issues `book.update` with
  the new id), so columns on the row survive. A test pins this.
- Zero stored as a rating. Goodreads lets 0 mean both "worst" and "unrated"
  and corrupts every average and sort built on it. Here unrated is null in
  the database, in GraphQL, and in every MCP output.
- Icons that only differ by fill or count. The requester's point is that a 4
  reads as "clapping", not as "four of something". The five glyphs differ in
  shape.
- A rating edit that is blocked because the book's last validation failed.
  Metadata editing is gated on validity because it rewrites the EPUB; rating
  touches no file, so it is never gated.
- An admin rating a reader's book. The admin viewer sees the reader's ratings
  (it sees everything else on the page) but the control is read-only for it,
  and the mutation refuses it. NOTE: this makes `bookRate` an OWNER-ONLY
  mutation, unlike the other book mutations. `ownerOf` is defined as
  owner-or-admin (`schema/builder.ts`, `node-scope.ts`), and
  `bookClearEditions`/`bookUpdateMetadata` admit admins through it. The one
  owner-only precedent is `progressSet` (`progress/mutation/set.ts`), which
  skips `ownerOf` and checks `context.viewer.userId` against the input's
  owner; the config admin's `viewer.userId` is null, so it can never pass.
  `bookRate` follows `progressSet`, not `bookClearEditions`, for its scope.
  A rating, like reading progress, is the reader's own opinion; nobody else
  has standing to write it.

## The four sub-ratings (requester's, after two rounds of research)

| Label | Judges | Non-fiction reading |
|-------|--------|---------------------|
| Story | Did the plot and its shape pull you through and pay off | The argument's architecture |
| Characters | Did you care about, believe in, want to stay with the people | The people on the page, the author's voice in memoir; unrated for reference |
| Writing | Sentence-level pleasure: voice, rhythm, humour, dialogue | Unchanged |
| Ideas | Did it make you think: argument, world, themes, information | Where non-fiction mostly lives |

Order everywhere (UI, GraphQL, MCP, text output) is Overall, Story,
Characters, Writing, Ideas. Unrated means "no opinion" and "not applicable"
alike; the two are not distinguished.

Why these four serve recommendations (research summary, sources in the
conversation record): each names a SOURCE OF ENJOYMENT the reader alone can
report. Mood, pace and plot-versus-character-driven are attributes of the
book that an assistant can infer from subjects, description and its own
knowledge; "couldn't put it down" is already in reading progress. The
pattern across the Love shelf ("Characters always 5, Writing anywhere,
Story merely Nice") is a taste profile the assistant can match against
unread books, and multi-criteria recommender research finds a few chosen
dimensions beat many, with the residual after the overall still improving
retrieval most on sparse data, which a one-reader library is. "Writing" not
"Prose" because readers say "beautiful writing", never "prose", and Writing
also covers humour and dialogue.

Mood and pace (dark, cosy, funny, devastating; fast, slow) are the other
half of librarian readers'-advisory matching, and they are descriptors, not
ratings. They are OUT of this project (see Non-goals); a curated mood chip
set is its own design.

## Constraints

- Books are per-user already (`Book` is keyed `(userId, id)`), so a rating is
  a per-book value with no separate user dimension.
- All five ratings use ONE scale and ONE validation rule: an integer 1–5, or
  null.
- Both the SPA and MCP write through the same GraphQL mutation. No second
  business-logic path (the MCP server design's standing rule).
- Follows the repo's data-migration rule: a column on `books` is added in a
  `runDataMigration` step in `db/migrate.ts`, with a no-op Prisma DDL
  migration alongside, because `data_v11_per_user_libraries` rebuilds `books`
  from an explicit column list. See `20261024000000_add_book_cover_normalized`
  for the precedent and its comment.
- Every user-facing colour, radius and spacing comes from the theme
  (`~/provider/theme`); icons follow `icon/props.ts` (24px viewBox, Tabler
  outline style, 2px stroke).
- Existing cost budgets: `BookDetailDocument` measures breadth 37 today;
  adding the rating selection adds 6 (one object field plus five scalars) and
  stays far inside the budget. Re-run `npm run test:cost -w app/server` and
  update the measured numbers in `page/book/query.ts`'s doc comment. MCP
  documents bypass the cost plugins (`mcp/tools/execute.ts`), so widening the
  summary selection has no budget effect.

## Decisions

### Storage

**Decision (author):** five nullable integer columns on `books`, holding the
value as-is (1–5):

```
rating_overall    INTEGER NULL
rating_story      INTEGER NULL
rating_characters INTEGER NULL
rating_writing    INTEGER NULL
rating_ideas      INTEGER NULL
rated_at          REAL    NULL
```

No conversion layer: the stored integer IS the value the API carries.
`rated_at` (epoch ms, the `addedAt`/`mtime` convention) is set on every
successful `bookRate` write, including one that clears, and is what orders
the taste profile's favourites so "recent Loves" come first. Author's
call: one column and one assignment, and without it the profile has no
notion of recency.

Why columns on `books` rather than a `book_ratings` table: there is at most
one set per book, every reader of the book row wants them, and columns ride
through `reimportBook`'s `book.update` with no extra cascade to get right. A
rating is deleted with its book, as `validations` and `pending_fixes` are;
it does NOT follow a document hash the way `progress` deliberately does.

Prisma: `ratingOverall Int? @map("rating_overall")` and so on, in that order,
then `ratedAt Float? @map("rated_at")`, placed after `pageCount`. Data
migration `data_v24_book_ratings` adds the six columns with the `PRAGMA table_info` guard the `cover_normalized`
migration uses. DDL migration `20261026000000_add_book_ratings` is a `SELECT
1` no-op with the same explanatory comment.

### Shared rating vocabulary

`services/rating.ts` exports the one source of truth for names and
validation, used by the GraphQL mutation and the MCP tool descriptions:

- `RATING_FIELDS = ['overall', 'story', 'characters', 'writing', 'ideas'] as const`
- `RATING_NAMES = { 1: 'Bad', 2: 'Okay', 3: 'Nice', 4: 'Great', 5: 'Love' } as const`
- `isRatingValue(n: unknown): n is 1 | 2 | 3 | 4 | 5`
- `formatRating(value: number | null): string` for MCP text: `4` renders as
  `Great (4)`, null as `unrated`.

The client has its own copy of the names and icon mapping in the control
(below); it is five strings, and the client cannot import server modules.

### GraphQL

**Decision (author):** one object field on `Book`, not five scalars.

```graphql
type BookRating {
  overall: Int
  story: Int
  characters: Int
  writing: Int
  ideas: Int
}

type Book {
  …
  "The reader's ratings, each 1 (bad) to 5 (love) or null when unrated. Never derived from the EPUB."
  rating: BookRating!
}
```

`rating` is non-null with nullable members: a book always has a rating slot,
so clients never branch on "object missing" versus "all members null", and
the Apollo cache holds one nested object per `Book:<id>` that a mutation
payload replaces wholesale.

Mutation, following `bookClearEditions`'s input and result shape (global-id
input, `null` for no such row, single-payload union plus an
`InvalidInputError` member because this one HAS validatable input) but
`progressSet`'s authorization (owner-only, see Anti-goals):

```graphql
input BookRateInput {
  id: ID!
  overall: Int
  story: Int
  characters: Int
  writing: Int
  ideas: Int
}
type BookRatePayload { book: Book! }
union BookRateResult = BookRatePayload | InvalidInputError
type Mutation {
  "Sets any of a book’s five ratings. An omitted field is left as it is; an explicit null clears it. Values are integers 1 (bad) to 5 (love). Never rewrites the EPUB, never changes the id, and is not gated on validation. Resolves to null when the book does not exist for the resolved owner."
  bookRate(input: BookRateInput!): BookRateResult
}
```

Omitted versus explicit null is distinguished (`undefined` versus `null` in
the resolved args), which is what lets `rate_book` set one sub-rating without
touching the others. Validation: each present non-null value must satisfy
`isRatingValue`; a failure (0, 6, 2.5, negative) returns `InvalidInputError`
naming the field, with nothing written (all five go in one `book.update`, so
partial success cannot happen). GraphQL's `Int` already rejects non-integers
at the parse layer; the resolver check is the backstop for range. An input
with all five omitted is a no-op that still returns the payload.

`bookUpdateMetadata` is NOT extended with rating fields, so an EPUB rewrite
is never triggered by a rating and `update_book_metadata` stays exactly as
documented.

**Taste profile (requester's two MCP additions, one GraphQL field).**

```graphql
enum RatingField { OVERALL STORY CHARACTERS WRITING IDEAS }

type RatingFieldSummary {
  field: RatingField!
  "Books with this field rated."
  count: Int!
  "Mean over rated books, null when count is 0."
  mean: Float
  "Five counts, for values 1 through 5 in order."
  distribution: [Int!]!
}

type LibraryRatingProfile {
  "Books with an overall rating."
  ratedCount: Int!
  "One entry per RatingField, in enum order."
  fields: [RatingFieldSummary!]!
  "Books whose overall rating is at least minOverall, most recently rated first. Default is the Love shelf."
  favourites(minOverall: Int = 5, first: Int = 25): [Book!]!
}

type Library {
  …
  ratingProfile: LibraryRatingProfile!
}
```

Why a dedicated field rather than a `LibraryFilter.minRating`: `entries`
interleaves series and standalone books, and a rating filter on that list
would need a definition of "a series rated at least N" that nobody asked
for. `favourites` is a flat list of books, which is what a recommender
wants. `first` is clamped to the `CONNECTION_LIMITS` ceiling the other
lists use (100); it is a plain list, not a connection, because the profile
is a snapshot read, never paged. The SPA does not read this field; it
exists for MCP. `fields` is one `groupBy`/aggregate pass per field (five
cheap queries over one indexed-by-owner table), computed in a new
`services/rating-profile.ts` that the resolver calls, so the aggregation
is testable without GraphQL.

### MCP

- `get_book`: `bookDetailSchema` and the detail selection gain
  `rating: { overall, story, characters, writing, ideas }` (nullable integers).
  `describeBookDetail` adds one line after the series line:
  `Rating: Great (4) · Story: Love (5) · Characters: Nice (3) · Writing: Okay (2) · Ideas: unrated`,
  or `Rating: not rated` when all five are null.
- `search_library`'s `BOOK_SUMMARY_FIELDS` gains `rating { overall }` and the
  summary schema gains `overallRating: number | null`, so an assistant can
  list results with their ratings without a `get_book` per hit. The same
  shared fields feed `get_series`, so its book list gains the value too. No
  filter is added.
- New read tool `get_taste_profile`:
  - input: `minOverall: z.number().int().min(1).max(5).default(5)`,
    `first: z.number().int().min(1).max(100).default(25)`.
  - executes `viewer { library { ratingProfile { ratedCount fields { … }
    favourites(minOverall, first) { <BOOK_SUMMARY_FIELDS> rating { … } } } } }`.
  - output schema: `{ ratedCount, fields: [{ field, count, mean, distribution }],
    favourites: [bookSummary & { rating: { overall, story, characters, writing, ideas } }] }`.
  - text: one line per field (`Characters: 31 rated, mean 4.1,
    1/2/3/4/5 = 0/2/6/11/12`), then the favourites as `describeBook` lines
    each followed by its five ratings in names. No interpretation: the tool
    reports; the assistant decides what the pattern means.
  - description says what it is for: "Read before recommending. The means
    and the distribution show which sources of enjoyment the reader scores
    highest; the favourites show, book by book, what carried the reader's
    best reads. Combine with search_library and get_book for subjects and
    descriptions."
  - `guarded(deps, { write: false }, …)`; annotations read-only, idempotent,
    closed world. Listed with the read tools in `server.test.ts`.
- New write tool `rate_book`:
  - input: `bookId: string`, and `overall`, `story`, `characters`, `writing`,
    `ideas`, each `z.number().int().min(0).max(5).nullable().optional()`
    described as "1 bad, 2 okay, 3 nice, 4 great, 5 love. Omit to leave
    unchanged; 0 or null clears." The tool maps 0 to null before calling the
    mutation, so the GraphQL contract stays "null clears" and 0 is an
    MCP-only courtesy.
  - description tells the assistant what each sub-rating judges (the table
    above, one clause each), that the overall is the reader's gut verdict,
    not an average, and that sub-ratings are optional and should be left
    unrated when the reader has not expressed an opinion on that axis.
  - `guarded(deps, { write: true }, …)` so a read-only grant cannot rate.
  - annotations: not read-only, not destructive, idempotent, closed world.
  - output: the full `bookDetailSchema` (re-fetched after the write, as
    `update_book_metadata` does) and the `describeBookDetail` text.
  - Errors: `NOT_FOUND_BOOK` for an unknown id, `InvalidInputError` text for a
    bad value (Zod catches these first; the GraphQL check is the backstop).
- `server.test.ts` adds `rate_book` to the write-tool list and the read-only
  grant refusal test, matching how the other write tools are covered.
- The consent page (`page/connect`, the per-capability `PERMISSIONS` list
  the reader sees when approving an assistant) gains two lines, requester's
  reminder: "Read your ratings and taste profile" (read) after the
  book-and-series-details line, and "Rate books" (write) after "Edit book
  metadata". Every line always renders; the write line flips to not granted
  under Read only, as the others do.

### Client

**Icons: emoji as a mask.** `~/icon/emoji.tsx` exports `EmojiIcon`, which
sets one emoji as SVG `<text>` in the platform's colour emoji font
(`Apple Color Emoji, Segoe UI Emoji, Noto Color Emoji`) inside the 24-unit
view box, font size 18, as an alpha `<mask>` (`mask-type: alpha`) over a
`currentColor` rectangle, so the glyph is a flat silhouette in whatever text
colour the segment has: muted when idle, brand when checked, in both themes.
Not an SVG filter: `feFlood flood-color="currentColor"` paints right once but
WebKit does not repaint the filter when the inherited colour changes, so
hover and selection never recoloured the icon; a mask over ordinary paint
repaints. The mask id comes from `useId`. Five one-line wrappers in `~/icon`
give the picker named components taking `IconProps`:

| File | Glyph |
|------|-------|
| `thumb-down.tsx` | 👎 `ThumbDownIcon` |
| `hand-ok.tsx` | 👌 `HandOkIcon` |
| `hand-peace.tsx` | ✌️ `HandPeaceIcon` |
| `hands-clap.tsx` | 👏 `HandsClapIcon` |
| `hand-love-you.tsx` | 🤟 `HandLoveYouIcon` |

The silhouettes keep the emoji's holes (the OK ring, the gap between the
victory fingers) and anti-aliased edges; what they drop is the shading and
outline detail, which did not survive 20px anyway. Font size 18 fills the box
the way the 24-unit stroke icons did (about 20 units), measured in WebKit and
Chromium. The platform's own emoji means the glyphs differ between macOS,
Windows and Android, which is accepted. Five hand-drawn and library outline
sets were tried and rejected before this: Tabler thumbs with hand-drawn OK and
clap, five Hugeicons icons, a Tabler-construction family and its five rounds
of revisions, and Sketch outlines by the requester with a mask-composed clap.

**Control: `~/control/rating-picker`.** A segmented control of five icon
buttons, in `control/segmented-control`'s visual language.

- Props: `value: 1 | 2 | 3 | 4 | 5 | null`,
  `onChange?: (value: 1 | 2 | 3 | 4 | 5 | null) => void` (absent means
  read-only), `label: string` (accessible name, e.g.
  "Overall rating for Dune"), `showNames?: boolean` (default on; the book page turns it on for the
  Overall row only).
- Semantics are a radio group with an optional selection, so the markup is
  `role="radiogroup"` with five `role="radio"` buttons, following
  `control/segmented-control`'s pattern (roving `tabIndex`, `aria-checked`).
  Each radio's accessible name is its value name ("Great").
- Pointer: tap an icon to select it. Tap the selected icon again to clear
  (the only way to clear by pointer, and it needs no extra button).
- Keyboard: Arrow Right/Up moves to the next value, Left/Down to the
  previous (no wrap, unlike the segmented control, because wrapping from
  Love to Bad would be a surprising jump); Home and End go to 1 and 5;
  digits 1–5 select directly; Backspace or Delete clears; Space or Enter on
  the focused radio toggles it (select, or clear if already selected).
- Rendering: five equal-width segments on a rail; the checked
  segment sits on the same sliding lens as the segmented control
  (`bg.input`, hairline border, `shadow.cardStack`), and there is no lens
  when the value is null. Each segment stacks a 20px icon over the value
  name (`fontSize.xs`); icons and names are `text.muted`, the checked one
  `brand.default`, hover `text.secondary`. The names are hidden by CSS at
  phone width, where five named segments do not fit; the group always
  carries a `title` with the checked name.
- `surface?: 'track' | 'row'`: `track` (default) paints the rail in
  `bg.track`; `row` paints no rail, for a picker sitting in a shaded input
  row whose grey is then the track (below). The rating picker has its own
  style file, so neither surface touches `control/segmented-control`.
- Touch targets: a segment is the full track height (icon, gap, name, plus
  `space.sm` top and bottom, about 46px) and a fifth of the track's width.
- Read-only mode renders the same visuals, no hover state, no focusability
  for the unselected buttons, and the radios carry `aria-disabled`. The
  selected name is still available through the group's accessible
  description.

**Component: `~/component/book-rating`.** The block the book page renders.

- Props: the five values, `bookTitle`, `readOnly`, and `onRate(field, value)`.
- Layout: five rows, one per field, Overall first. Each row is the shaded
  input row every labelled control in the app uses (`TextInput`'s
  `horizontal` layout: `bg.cardHeader`, `radius.md`, the label in
  `recipe.label` inset `space.sm` with a 6rem minimum width), with the
  picker on `surface="row"` filling the rest, so the row's grey is the track
  and the white lens is the only raised element, where a text row shows its
  white field. All five labels take the same grey label recipe; only the
  Overall row shows the value names under its icons, since the four rows
  beneath use the same icons in the same order. The row is taller than a
  text row, so the label is vertically centred. At phone width the row takes
  the `vertical` form of the same panel: label above the picker, inside the
  grey, picker the full row width. Rows are `space.md` apart, as in the
  other forms. Sub-ratings are always visible; they are the
  point of the feature, and hiding them behind a disclosure would make the
  common case two taps.
- No "saving…" state: the mutation is sent with an `optimisticResponse`
  carrying the new `BookRating`, so the icon flips on tap. On error the cache
  reverts and the page's existing error surface (whatever `handleValidate`
  and friends use) shows the message.

**Book page (`page/book/index.tsx`).** The block is its own `Card` titled
"Rating", placed between the title card and the Description card, so the
five rows have the card's full width at every size. `readOnly` is `isAdmin`.
`BookDetailDocument` selects `rating { overall story characters writing ideas }`.
A new `BookRateDocument` mutation selects `book { id rating { … } }` and
nothing else, so the payload normalizes onto the same `Book:<id>` the route
reads; a cache test proves it, as the route's other mutations have. The
mutation document lives where the route's other mutation documents live
(`~/graphql/book.ts` today); the builder follows that file's placement rule.

**Metadata edit form:** untouched.

### Tests (what must exist before the work is called done)

Server:

- `services/rating.test.ts`: `isRatingValue` accepts 1–5 and rejects 0, 6,
  2.5, NaN, strings, null; `formatRating` table.
- `schema/book/mutation/rate.test.ts`: set all five; set one and confirm the
  other four are untouched; explicit null clears; 0 and 6 return
  `InvalidInputError` naming the field and write nothing; unknown book is
  null; admin viewer is refused (FORBIDDEN error, null data, as
  `progress/mutation/set.test.ts` asserts for `progressSet`); a different
  reader's viewer is refused the same way (FORBIDDEN, not a bare null).
- `schema/book/model.test.ts`: `rating` resolves the five columns and nulls.
- `services/rating-profile.test.ts`: counts, means and distributions over a
  seeded library with a mix of rated, partly rated and unrated books; mean is
  null at count 0; favourites honour `minOverall`, order by `ratedAt`
  descending, clamp `first`, and exclude books with no overall.
- `schema/library/rating-profile.test.ts`: the field resolves for the owner
  and for an admin reading a named library; `favourites` returns real
  `Book` nodes (so `rating`, `series`, `subjects` resolve on them).
- `rate.test.ts` also asserts `ratedAt` is set on every write, including a
  clear.
- A test in `book-lifecycle.test.ts` (or `update-metadata.test.ts`) that
  rates a book, edits its title through `bookUpdateMetadata` so the id
  changes, and reads the rating back on the new id.
- `db/migrate.test.ts`: `data_v24_book_ratings` adds the columns and is
  idempotent.
- MCP: `rate_book` happy path, clear with null, clear with 0, Zod rejection
  of 6 and 2.5, read-only grant refusal; `get_book` and `search_library`
  outputs carry the rating and the text line reads as specified;
  `get_taste_profile` output matches the seeded library, honours
  `minOverall` and `first`, and works on a read-only grant.
- `npm run test:cost -w app/server` passes with the new breadth recorded.

Client:

- `control/rating-picker/index.test.tsx`: tap selects, tap-selected clears,
  every keyboard binding, no wrap at the ends, read-only renders disabled
  radios and ignores input, accessible names are the value names.
- `page/book/index.test.tsx`: renders the five values from the detail query;
  tapping an icon fires `BookRateDocument` with only that field; the payload
  updates the rendered selection with no refetch; admin viewer gets read-only.

## What's left to the builder

- Segment padding and the exact phone-width rules for the rows, within the
  page's existing responsive rules.
- Whether `BookRating` needs a `typePolicies` `merge: true` entry, or whether
  wholesale replacement from the payload is enough (it should be: the payload
  always carries all five members).
- Error-surface wiring on the book page, reusing whatever the route already
  does for failed mutations.
- Placement of the `BookRateDocument` per the existing colocation rules.

## Deferred (author's call, requester did not weigh in)

- Library and series rows showing the overall rating icon. Out of this
  project; a follow-up once the icons exist.
- A `search_library` minimum-rating filter. Superseded by
  `get_taste_profile`'s `favourites(minOverall)`, which answers "which of my
  books did I rate Great or better" without touching the mixed
  book-and-series list.
- Mood and pace descriptors. A separate design.
