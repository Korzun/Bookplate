# OPDS Catalog Expansion Design

**Date:** 2026-06-16
**Branch:** `worktree-feat-opds-catalog-expansion`

## Overview

Extend the OPDS server beyond its current single "All Books" feed. Add Author, Series, Subject, and Status browse feeds, rename the existing entry to "By Book Title", and replace all inline XML string construction with a tagged-template system to keep the code maintainable.

---

## Catalog Structure

Following the OPDS navigation/acquisition feed convention, the root catalog expands from one entry to five:

```
GET /opds/                           → navigation feed (root)

GET /opds/books                      → acquisition feed — all books, sorted by title
                                       (label changed: "All Books" → "By Book Title")

GET /opds/authors                    → navigation feed — list of distinct authors
GET /opds/authors/:author            → acquisition feed — books by that author

GET /opds/series                     → navigation feed — list of series
GET /opds/series/:seriesId           → acquisition feed — books in that series, by seriesIndex

GET /opds/subjects                   → navigation feed — list of subjects
GET /opds/subjects/:subject          → acquisition feed — books with that subject

GET /opds/status                     → navigation feed — 3 fixed entries
GET /opds/status/not-started         → acquisition feed
GET /opds/status/in-progress         → acquisition feed
GET /opds/status/completed           → acquisition feed
```

**URL encoding:** Series uses its UUID primary key in the URL to avoid encoding problems with names containing special characters. Authors and subjects are URL-encoded strings (no separate ID table exists for them).

**Status semantics:** Status is based on individual book progress (`Progress.percentage` per book), not series-level rollup. This matches how KOReader records progress. The 3 status entries are always present in the navigation feed regardless of whether a category has books.

**Invalid status slug:** `GET /opds/status/:other` returns HTTP 400.

---

## Templates Module (`routes/opds-templates.ts`)

All XML generation moves here. The route file imports fragments and assembles them; it never builds XML strings itself.

### `xml` tagged template

```typescript
function xml(strings: TemplateStringsArray, ...values: unknown[]): string
```

Auto-escapes every interpolated value via `escapeXml()`. To embed a pre-built XML fragment without double-escaping, wrap it with `raw(s: string)`:

```typescript
const r = raw(someAlreadyEscapedFragment);
// interpolating r inside xml`` passes it through unescaped
```

### Fragment functions

```typescript
// One <entry> in a navigation feed
navEntry(id: string, title: string, content: string, href: string, kind: 'navigation' | 'acquisition', now: string): string

// One <entry> in an acquisition feed
bookEntry(b: Book, baseUrl: string, smallestThumbnailWidth: number | null): string
```

### Feed builders

```typescript
interface FeedParams {
  id: string;
  title: string;
  selfHref: string;
  baseUrl: string;
  now: string;
  entries: string[];
}

// kind=navigation in the self-link type attribute
navigationFeed(params: FeedParams): string

// kind=acquisition in the self-link type attribute
acquisitionFeed(params: FeedParams): string
```

Both builders share an internal `feedWrapper()` helper that differs only in the `kind=` value. Each route handler computes ~5 lines: fetch data, map to entry fragments, call the right builder, send.

---

## BookStore additions (`services/book-store.ts`)

Six new methods, all scoped to `owner`. Prisma is used wherever the data model permits; raw SQL only where Prisma cannot express the query in SQLite.

| Method | Query mechanism | Reason |
|---|---|---|
| `getAuthors(owner)` | Prisma `groupBy(['author', 'authorSort'])`, JS sort by `authorSort \|\| author` | Prisma `groupBy` handles distinct; JS sort needed for conditional sort key |
| `listSeries(owner)` | Prisma `findMany` on `Series`, ordered by `sortKey` | Straightforward |
| `listBooksByAuthor(owner, author)` | Prisma `findMany` with `where: { author }`, ordered by title | Straightforward |
| `listBooksBySeries(owner, seriesId)` | Prisma `findMany` with `where: { seriesId }`, ordered by `seriesIndex` then `title` | Straightforward |
| `listBooksBySubject(owner, subject)` | Raw SQL with `json_each` | Subjects stored as JSON array string in SQLite; Prisma has no `array_contains` for SQLite |
| `listBooksByStatus(owner, status)` | Prisma: fetch progress with `findMany`, call existing `standaloneStatusWhere()`, then `findMany` | `standaloneStatusWhere` already returns `Prisma.BookWhereInput` |

All methods return `Book[]` using the existing `BOOK_SELECT` projection and `prismaBookToBook()` mapping — no new columns or return types.

`listSeries` returns `{ id: string; name: string; bookCount: number }[]` for use in the navigation feed entry list.

---

## Route Changes (`routes/opds.ts`)

The four existing routes are unchanged in behavior:
- `GET /opds/` — updated to use `navigationFeed()` from the templates module, and adds 4 new `navEntry` items to the root feed
- `GET /opds/books` — updated to use `acquisitionFeed()`, label changes to "By Book Title"
- `GET /opds/books/:id/download` — unchanged
- `GET /opds/books/:id/cover` — unchanged

Eight new routes are added, each following the same pattern: auth middleware, fetch data from BookStore, map to entry fragments, send feed.

---

## Error Handling

- Unknown `:author`, `:seriesId`, or `:subject` that yields zero books returns an empty acquisition feed (HTTP 200), consistent with how `/opds/books` behaves for an empty library.
- Unknown `:status` slug (anything other than `not-started`, `in-progress`, `completed`) returns HTTP 400.
- Auth failures on all new routes: HTTP 401, same as existing routes.

---

## Testing

### `routes/opds.test.ts` — new describe blocks

- Root feed contains links to all 5 catalog sections
- `GET /opds/authors` lists each distinct author name exactly once
- `GET /opds/authors/:author` returns only that author's books; escapes special characters
- `GET /opds/authors/:author` for unknown author returns empty feed (200)
- `GET /opds/series` lists series with name and book count
- `GET /opds/series/:seriesId` returns books sorted by `seriesIndex`
- `GET /opds/series/:seriesId` for unknown series returns empty feed (200)
- `GET /opds/subjects` lists distinct subjects
- `GET /opds/subjects/:subject` returns only books tagged with that subject
- `GET /opds/status` contains exactly 3 entries (not-started, in-progress, completed)
- `GET /opds/status/not-started` excludes started books
- `GET /opds/status/in-progress` returns only partially-read books
- `GET /opds/status/completed` returns only fully-read books
- `GET /opds/status/invalid` returns 400
- Cross-user isolation on all new acquisition feeds (existing pattern, applied to new routes)

### `services/book-store.test.ts` — new test cases

One test block per new method covering the happy path, empty result, and (for `listBooksByStatus`) each of the three status values.

---

## Files Changed

| File | Change |
|---|---|
| `app/server/routes/opds-templates.ts` | **New** — `xml` tag, `raw()`, `navEntry()`, `bookEntry()`, `navigationFeed()`, `acquisitionFeed()` |
| `app/server/routes/opds.ts` | Update existing routes to use templates; add 8 new routes |
| `app/server/services/book-store.ts` | Add 6 new query methods |
| `app/server/routes/opds.test.ts` | Add tests for new routes |
| `app/server/services/book-store.test.ts` | Add tests for new BookStore methods |
