# OPDS Catalog Expansion Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Extend the OPDS server with Author, Series, Subject, and Status browse feeds, replace inline XML string construction with a tagged-template module, and rename "All Books" to "By Book Title".

**Architecture:** A new `routes/opds-templates.ts` module owns all XML generation via a typed `xml` tagged template tag and composable fragment functions; `routes/opds.ts` imports these and adds 8 new routes. Six new `BookStore` methods provide the data queries, using Prisma wherever SQLite supports it and raw SQL only for JSON array filtering (subjects).

**Tech Stack:** TypeScript, Express, Prisma (SQLite), Jest/ts-jest, supertest

---

## File Map

| File | Action | Responsibility |
|---|---|---|
| `app/server/routes/opds-templates.ts` | **Create** | `xml` tag, `raw()`, `navEntry()`, `bookEntry()`, `navigationFeed()`, `acquisitionFeed()` |
| `app/server/routes/opds.ts` | **Modify** | Remove old helpers, import templates, add 8 new routes, rename root entry label |
| `app/server/services/book-store.ts` | **Modify** | Extract `sortByTitle()` helper; add `getAuthors`, `listSeries`, `listBooksByAuthor`, `listBooksBySeries`, `listBooksBySubject`, `listBooksByStatus` |
| `app/server/routes/opds.test.ts` | **Modify** | Add tests for all new routes |
| `app/server/services/book-store.test.ts` | **Modify** | Add tests for all new BookStore methods |

All commands run from `app/server/` unless noted. Run tests with:
```bash
npm test -- --testPathPattern=<pattern>
# e.g. npm test -- --testPathPattern=routes/opds
# e.g. npm test -- --testPathPattern=services/book-store
```

---

## Task 1: Create the templates module

**Files:**
- Create: `app/server/routes/opds-templates.ts`

The module provides: an `escapeXml` helper (moved from `opds.ts`), an `xml` tagged template tag that auto-escapes interpolated values, a `raw()` wrapper to pass pre-built fragments through without escaping, and the public feed-building functions.

- [ ] **Step 1: Create `opds-templates.ts` with the core `xml` infrastructure**

```typescript
// app/server/routes/opds-templates.ts
import { Book } from '../types';

function escapeXml(s: string): string {
  return s
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

class RawXml {
  constructor(readonly value: string) {}
}

export function raw(s: string): RawXml {
  return new RawXml(s);
}

export function xml(strings: TemplateStringsArray, ...values: unknown[]): string {
  return strings.reduce((acc, str, i) => {
    if (i >= values.length) return acc + str;
    const v = values[i];
    return acc + str + (v instanceof RawXml ? v.value : escapeXml(String(v)));
  }, '');
}

export interface FeedParams {
  id: string;
  title: string;
  selfHref: string;
  baseUrl: string;
  now: string;
  entries: string[];
}

export function navEntry(
  id: string,
  title: string,
  content: string,
  href: string,
  kind: 'navigation' | 'acquisition',
  now: string
): string {
  return xml`  <entry>
    <title>${title}</title>
    <id>${id}</id>
    <updated>${now}</updated>
    <content type="text">${content}</content>
    <link rel="subsection" href="${href}" type="application/atom+xml;profile=opds-catalog;kind=${kind}"/>
  </entry>`;
}

export function bookEntry(b: Book, baseUrl: string, smallestThumbnailWidth: number | null): string {
  const parts: string[] = [
    xml`  <entry>
    <title>${b.title}</title>
    <id>urn:hass-odps:book:${b.id}</id>
    <updated>${b.mtime.toISOString()}</updated>
    <author><name>${b.author}</name></author>
    <summary>${b.description}</summary>
    <link rel="http://opds-spec.org/acquisition"
          href="${baseUrl}/opds/books/${b.id}/download"
          type="application/epub+zip"
          title="${b.filename}"/>`,
  ];
  if (b.hasCover) {
    parts.push(
      xml`    <link rel="http://opds-spec.org/image"
          href="${baseUrl}/opds/books/${b.id}/cover"
          type="image/jpeg"/>`
    );
  }
  if (b.hasCover && smallestThumbnailWidth !== null) {
    parts.push(
      xml`    <link rel="http://opds-spec.org/image/thumbnail"
          href="${baseUrl}/opds/books/${b.id}/cover?width=${String(smallestThumbnailWidth)}"
          type="image/jpeg"/>`
    );
  }
  parts.push('  </entry>');
  return parts.join('\n');
}

function feedWrapper(params: FeedParams, kind: 'navigation' | 'acquisition'): string {
  const { id, title, selfHref, baseUrl, now, entries } = params;
  const header = xml`<?xml version="1.0" encoding="UTF-8"?>
<feed xmlns="http://www.w3.org/2005/Atom" xmlns:opds="http://opds-spec.org/2010/catalog">
  <id>${id}</id>
  <title>${title}</title>
  <updated>${now}</updated>
  <link rel="self" href="${selfHref}" type="application/atom+xml;profile=opds-catalog;kind=${kind}"/>
  <link rel="start" href="${baseUrl}/opds/" type="application/atom+xml;profile=opds-catalog;kind=navigation"/>`;
  return header + (entries.length > 0 ? '\n' + entries.join('\n') : '') + '\n</feed>';
}

export function navigationFeed(params: FeedParams): string {
  return feedWrapper(params, 'navigation');
}

export function acquisitionFeed(params: FeedParams): string {
  return feedWrapper(params, 'acquisition');
}
```

- [ ] **Step 2: Verify the file compiles with no TS errors**

```bash
npx tsc --noEmit
```
Expected: no errors.

- [ ] **Step 3: Commit the new module**

```bash
git add app/server/routes/opds-templates.ts
git commit -m "feat: add opds-templates module with xml tag and feed builders"
```

---

## Task 2: Migrate opds.ts to use templates

**Files:**
- Modify: `app/server/routes/opds.ts`

Remove the now-redundant `escapeXml`, `rootFeed`, and `booksFeed` functions. Import the templates. Update the two existing route handlers to use the new builders. Rename "All Books" → "By Book Title" in both places.

- [ ] **Step 1: Replace the full contents of `opds.ts`**

The new file removes the old helper functions and uses the template module. The two existing route handlers (`/` and `/books`) produce the same XML output as before, except:
- The root entry label changes from `All Books` to `By Book Title`
- The books feed title changes from `All Books` to `By Book Title`

```typescript
// app/server/routes/opds.ts
import { Router, Request, Response } from 'express';
import { BookStore } from '../services/book-store';
import { UserStore } from '../services/user-store';
import { opdsAuth } from '../middleware/auth';
import { logger } from '../logger';
import {
  navigationFeed,
  acquisitionFeed,
  navEntry,
  bookEntry,
} from './opds-templates';

const log = logger('OPDS');

export function createOpdsRouter(
  bookStore: BookStore,
  userStore: UserStore,
  thumbnailWidths: number[]
): Router {
  const router = Router();
  const auth = opdsAuth(userStore);
  const smallestWidth = thumbnailWidths.length > 0 ? Math.min(...thumbnailWidths) : null;

  router.get('/', auth, (req: Request, res: Response) => {
    log.debug('Root catalog served');
    const baseUrl = `${req.protocol}://${req.get('host')}`;
    const now = new Date().toISOString();
    res.set('Content-Type', 'application/atom+xml;charset=utf-8');
    res.send(
      navigationFeed({
        id: 'urn:hass-odps:root',
        title: 'HASS-ODPS Library',
        selfHref: `${baseUrl}/opds/`,
        baseUrl,
        now,
        entries: [
          navEntry(
            'urn:hass-odps:books',
            'By Book Title',
            'Browse all books in the library',
            `${baseUrl}/opds/books`,
            'acquisition',
            now
          ),
          navEntry(
            'urn:hass-odps:authors',
            'By Author',
            'Browse books by author',
            `${baseUrl}/opds/authors`,
            'navigation',
            now
          ),
          navEntry(
            'urn:hass-odps:series',
            'By Series',
            'Browse books by series',
            `${baseUrl}/opds/series`,
            'navigation',
            now
          ),
          navEntry(
            'urn:hass-odps:subjects',
            'By Subject',
            'Browse books by subject',
            `${baseUrl}/opds/subjects`,
            'navigation',
            now
          ),
          navEntry(
            'urn:hass-odps:status',
            'By Status',
            'Browse books by reading status',
            `${baseUrl}/opds/status`,
            'navigation',
            now
          ),
        ],
      })
    );
  });

  router.get('/books', auth, async (req: Request, res: Response) => {
    const owner = req.opdsOwner!;
    const books = await bookStore.listBooks(owner);
    log.debug(`Books feed served (${books.length} books)`);
    const baseUrl = `${req.protocol}://${req.get('host')}`;
    const now = new Date().toISOString();
    res.set('Content-Type', 'application/atom+xml;charset=utf-8');
    res.send(
      acquisitionFeed({
        id: 'urn:hass-odps:books',
        title: 'By Book Title',
        selfHref: `${baseUrl}/opds/books`,
        baseUrl,
        now,
        entries: books.map((b) => bookEntry(b, baseUrl, smallestWidth)),
      })
    );
  });

  router.get('/books/:id/download', auth, async (req: Request, res: Response) => {
    const owner = req.opdsOwner!;
    const book = await bookStore.getBookById(owner, req.params.id);
    if (!book) {
      log.warn(`Download requested for unknown book ID: ${req.params.id}`);
      res.status(404).send('Not found');
      return;
    }
    log.info(`User "${owner.username}" downloaded "${book.filename}"`);
    res.set('Content-Type', 'application/epub+zip');
    res.set(
      'Content-Disposition',
      `attachment; filename*=UTF-8''${encodeURIComponent(book.filename)}`
    );
    res.sendFile(book.path);
  });

  router.get('/books/:id/cover', auth, async (req: Request, res: Response) => {
    const owner = req.opdsOwner!;
    const { width } = req.query;
    const parsedWidth = typeof width === 'string' ? parseInt(width, 10) : NaN;

    if (!isNaN(parsedWidth) && parsedWidth > 0) {
      const thumbnail = await bookStore.getThumbnail(owner.userId, req.params.id, parsedWidth);
      if (thumbnail) {
        res.set('Content-Type', thumbnail.mime);
        res.send(thumbnail.data);
        return;
      }
      log.warn(
        `Cover thumbnail width=${parsedWidth} not found for book ${req.params.id}, serving full-size`
      );
    }

    const cover = await bookStore.getCover(owner.userId, req.params.id);
    if (!cover) {
      res.status(404).send('Not found');
      return;
    }
    res.set('Content-Type', cover.mime);
    res.send(cover.data);
  });

  return router;
}
```

- [ ] **Step 2: Run the existing OPDS tests — all must pass**

```bash
npm test -- --testPathPattern=routes/opds
```
Expected: all existing tests pass (the XML output is structurally equivalent; "All Books" string assertions will need updating — see next step).

- [ ] **Step 3: Update existing assertions and add a root catalog coverage test**

In `app/server/routes/opds.test.ts`, search for any `'All Books'` assertions and update them to `'By Book Title'`:

```bash
grep -n "All Books" app/server/routes/opds.test.ts
```

Then add a test in the `describe('GET /opds/', ...)` block that verifies all 5 catalog links exist in the root feed:

```typescript
it('root feed contains links to all 5 catalog sections', async () => {
  const res = await request(app).get('/opds/').set(basicAuth('alice', 'secret'));
  expect(res.text).toContain('/opds/books');
  expect(res.text).toContain('/opds/authors');
  expect(res.text).toContain('/opds/series');
  expect(res.text).toContain('/opds/subjects');
  expect(res.text).toContain('/opds/status');
  const entryCount = (res.text.match(/<entry>/g) ?? []).length;
  expect(entryCount).toBe(5);
});
```

- [ ] **Step 4: Run OPDS tests again to confirm clean**

```bash
npm test -- --testPathPattern=routes/opds
```
Expected: all pass.

- [ ] **Step 5: Commit**

```bash
git add app/server/routes/opds.ts app/server/routes/opds.test.ts
git commit -m "refactor: migrate opds.ts to use opds-templates; rename All Books to By Book Title"
```

---

## Task 3: BookStore — `sortByTitle` helper + `getAuthors` + `listBooksByAuthor`

**Files:**
- Modify: `app/server/services/book-store.ts`
- Modify: `app/server/services/book-store.test.ts`

Extract the repeated title-sort logic from `listBooks` into a private helper so the new methods can reuse it without duplication.

- [ ] **Step 1: Write failing tests for `getAuthors` and `listBooksByAuthor`**

Add this describe block to `app/server/services/book-store.test.ts`. Place it after the existing describe blocks (find a good spot — after the `listBooks` tests if they exist, otherwise at the end before the final closing):

```typescript
describe('getAuthors', () => {
  it('returns empty array when no books', async () => {
    const authors = await bookStore.getAuthors(alice);
    expect(authors).toEqual([]);
  });

  it('returns distinct authors sorted alphabetically', async () => {
    await bookStore.addBook(alice, 'b1', stage('b1'), { ...FAKE_META, author: 'Zora Neale Hurston' });
    await bookStore.addBook(alice, 'b2', stage('b2'), { ...FAKE_META, author: 'Agatha Christie' });
    await bookStore.addBook(alice, 'b3', stage('b3'), { ...FAKE_META, author: 'Agatha Christie' });
    const authors = await bookStore.getAuthors(alice);
    expect(authors).toEqual(['Agatha Christie', 'Zora Neale Hurston']);
  });

  it('excludes books with empty author', async () => {
    await bookStore.addBook(alice, 'b4', stage('b4'), { ...FAKE_META, author: '' });
    const authors = await bookStore.getAuthors(alice);
    expect(authors).toEqual([]);
  });

  it('is scoped to owner', async () => {
    await bookStore.addBook(alice, 'b5', stage('b5'), { ...FAKE_META, author: 'Alice Author' });
    await bookStore.addBook(bob, 'b6', stage('b6'), { ...FAKE_META, author: 'Bob Author' });
    const authors = await bookStore.getAuthors(alice);
    expect(authors).toContain('Alice Author');
    expect(authors).not.toContain('Bob Author');
  });
});

describe('listBooksByAuthor', () => {
  it('returns empty array for unknown author', async () => {
    const books = await bookStore.listBooksByAuthor(alice, 'No One');
    expect(books).toEqual([]);
  });

  it('returns only books by the given author', async () => {
    await bookStore.addBook(alice, 'c1', stage('c1'), { ...FAKE_META, author: 'Jane Austen', title: 'Persuasion' });
    await bookStore.addBook(alice, 'c2', stage('c2'), { ...FAKE_META, author: 'Jane Austen', title: 'Emma' });
    await bookStore.addBook(alice, 'c3', stage('c3'), { ...FAKE_META, author: 'Other Author', title: 'Other Book' });
    const books = await bookStore.listBooksByAuthor(alice, 'Jane Austen');
    expect(books.map((b) => b.title)).toEqual(['Emma', 'Persuasion']);
  });

  it('is scoped to owner', async () => {
    await bookStore.addBook(alice, 'c4', stage('c4'), { ...FAKE_META, author: 'Shared Author', title: 'Alice Copy' });
    await bookStore.addBook(bob, 'c5', stage('c5'), { ...FAKE_META, author: 'Shared Author', title: 'Bob Copy' });
    const books = await bookStore.listBooksByAuthor(alice, 'Shared Author');
    expect(books.map((b) => b.title)).toEqual(['Alice Copy']);
  });
});
```

The test file uses `bob` as a second user — check that the existing test file already sets up a `bob` fixture, or add:
```typescript
let bob: Owner;
// in beforeEach:
await userStore.createUser('bob', null, 'bobsecret');
const bobId = await userStore.getUserIdByUsername('bob');
bob = { userId: bobId!, username: 'bob' };
```

- [ ] **Step 2: Run tests to verify they fail**

```bash
npm test -- --testPathPattern=services/book-store
```
Expected: new tests fail with "bookStore.getAuthors is not a function" (or similar).

- [ ] **Step 3: Implement `sortByTitle`, `getAuthors`, and `listBooksByAuthor` in `book-store.ts`**

First, extract the sort logic from `listBooks` into a private helper. Find the `listBooks` method and add the helper just before it:

```typescript
private sortByTitle<T extends { titleSort: string; title: string; id: string }>(rows: T[]): T[] {
  return [...rows].sort((a, b) => {
    const aKey = a.titleSort !== '' ? a.titleSort : a.title;
    const bKey = b.titleSort !== '' ? b.titleSort : b.title;
    if (aKey < bKey) return -1;
    if (aKey > bKey) return 1;
    if (a.title < b.title) return -1;
    if (a.title > b.title) return 1;
    return a.id < b.id ? -1 : a.id > b.id ? 1 : 0;
  });
}
```

Then update `listBooks` to use it (replace the inline sort):

```typescript
async listBooks(owner: Owner): Promise<Book[]> {
  const rows = await this.prisma.book.findMany({
    where: { userId: owner.userId },
    select: BOOK_SELECT,
  });
  return this.sortByTitle(rows).map((r) => this.prismaBookToBook(owner, r));
}
```

Then add the two new methods after `listBooks`:

```typescript
async getAuthors(owner: Owner): Promise<string[]> {
  const rows = await this.prisma.book.groupBy({
    by: ['author'],
    where: { userId: owner.userId, author: { not: '' } },
    orderBy: { author: 'asc' },
  });
  return rows.map((r) => r.author);
}

async listBooksByAuthor(owner: Owner, author: string): Promise<Book[]> {
  const rows = await this.prisma.book.findMany({
    where: { userId: owner.userId, author },
    select: BOOK_SELECT,
  });
  return this.sortByTitle(rows).map((r) => this.prismaBookToBook(owner, r));
}
```

- [ ] **Step 4: Run tests to verify they pass**

```bash
npm test -- --testPathPattern=services/book-store
```
Expected: all pass.

- [ ] **Step 5: Commit**

```bash
git add app/server/services/book-store.ts app/server/services/book-store.test.ts
git commit -m "feat: add BookStore.getAuthors and listBooksByAuthor; extract sortByTitle helper"
```

---

## Task 4: BookStore — `listSeries` + `listBooksBySeries`

**Files:**
- Modify: `app/server/services/book-store.ts`
- Modify: `app/server/services/book-store.test.ts`

- [ ] **Step 1: Write failing tests**

Add to `app/server/services/book-store.test.ts`:

```typescript
describe('listSeries', () => {
  it('returns empty array when no series exist', async () => {
    const series = await bookStore.listSeries(alice);
    expect(series).toEqual([]);
  });

  it('returns series sorted by name', async () => {
    await bookStore.addBook(alice, 'd1', stage('d1'), { ...FAKE_META, series: 'Dune', seriesIndex: 1 });
    await bookStore.addBook(alice, 'd2', stage('d2'), { ...FAKE_META, series: 'Foundation', seriesIndex: 1 });
    const series = await bookStore.listSeries(alice);
    expect(series.map((s) => s.name)).toEqual(['Dune', 'Foundation']);
    expect(series[0].bookCount).toBe(1);
  });

  it('is scoped to owner', async () => {
    await bookStore.addBook(alice, 'd3', stage('d3'), { ...FAKE_META, series: 'Alice Series', seriesIndex: 1 });
    await bookStore.addBook(bob, 'd4', stage('d4'), { ...FAKE_META, series: 'Bob Series', seriesIndex: 1 });
    const series = await bookStore.listSeries(alice);
    expect(series.map((s) => s.name)).toContain('Alice Series');
    expect(series.map((s) => s.name)).not.toContain('Bob Series');
  });
});

describe('listBooksBySeries', () => {
  it('returns empty array for unknown seriesId', async () => {
    const books = await bookStore.listBooksBySeries(alice, 'nonexistent-uuid');
    expect(books).toEqual([]);
  });

  it('returns books sorted by seriesIndex then title', async () => {
    await bookStore.addBook(alice, 'e1', stage('e1'), { ...FAKE_META, series: 'The Expanse', seriesIndex: 1, title: 'Leviathan Wakes' });
    await bookStore.addBook(alice, 'e2', stage('e2'), { ...FAKE_META, series: 'The Expanse', seriesIndex: 3, title: 'Abaddon\'s Gate' });
    await bookStore.addBook(alice, 'e3', stage('e3'), { ...FAKE_META, series: 'The Expanse', seriesIndex: 2, title: 'Caliban\'s War' });
    const allSeries = await bookStore.listSeries(alice);
    const expanse = allSeries.find((s) => s.name === 'The Expanse')!;
    const books = await bookStore.listBooksBySeries(alice, expanse.id);
    expect(books.map((b) => b.title)).toEqual([
      'Leviathan Wakes',
      'Caliban\'s War',
      "Abaddon's Gate",
    ]);
  });

  it('is scoped to owner', async () => {
    await bookStore.addBook(alice, 'e4', stage('e4'), { ...FAKE_META, series: 'Shared Series', seriesIndex: 1, title: 'Alice Book' });
    await bookStore.addBook(bob, 'e5', stage('e5'), { ...FAKE_META, series: 'Shared Series', seriesIndex: 1, title: 'Bob Book' });
    const aliceSeries = await bookStore.listSeries(alice);
    const s = aliceSeries.find((s) => s.name === 'Shared Series')!;
    const books = await bookStore.listBooksBySeries(alice, s.id);
    expect(books.map((b) => b.title)).toEqual(['Alice Book']);
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

```bash
npm test -- --testPathPattern=services/book-store
```
Expected: new tests fail.

- [ ] **Step 3: Implement `listSeries` and `listBooksBySeries` in `book-store.ts`**

Add after `listBooksByAuthor`:

```typescript
async listSeries(owner: Owner): Promise<{ id: string; name: string; bookCount: number }[]> {
  const rows = await this.prisma.series.findMany({
    where: { userId: owner.userId },
    select: { id: true, name: true, bookCount: true },
    orderBy: { sortKey: 'asc' },
  });
  return rows;
}

async listBooksBySeries(owner: Owner, seriesId: string): Promise<Book[]> {
  const rows = await this.prisma.book.findMany({
    where: { userId: owner.userId, seriesId },
    select: BOOK_SELECT,
    orderBy: [{ seriesIndex: 'asc' }, { title: 'asc' }, { id: 'asc' }],
  });
  return rows.map((r) => this.prismaBookToBook(owner, r));
}
```

- [ ] **Step 4: Run tests to verify they pass**

```bash
npm test -- --testPathPattern=services/book-store
```
Expected: all pass.

- [ ] **Step 5: Commit**

```bash
git add app/server/services/book-store.ts app/server/services/book-store.test.ts
git commit -m "feat: add BookStore.listSeries and listBooksBySeries"
```

---

## Task 5: BookStore — `listBooksBySubject`

**Files:**
- Modify: `app/server/services/book-store.ts`
- Modify: `app/server/services/book-store.test.ts`

Subjects are stored as a JSON array string (`'["Fantasy","Science Fiction"]'`) in SQLite. Prisma has no `array_contains` for SQLite, so this uses raw SQL with `json_each` — the same pattern as the existing `getSubjects()` method.

- [ ] **Step 1: Write failing tests**

Add to `app/server/services/book-store.test.ts`:

```typescript
describe('listBooksBySubject', () => {
  it('returns empty array when no books have the subject', async () => {
    const books = await bookStore.listBooksBySubject(alice, 'Fantasy');
    expect(books).toEqual([]);
  });

  it('returns only books tagged with the given subject', async () => {
    await bookStore.addBook(alice, 'f1', stage('f1'), { ...FAKE_META, title: 'A Fantasy Book', subjects: ['Fantasy', 'Adventure'] });
    await bookStore.addBook(alice, 'f2', stage('f2'), { ...FAKE_META, title: 'A Sci-Fi Book', subjects: ['Science Fiction'] });
    await bookStore.addBook(alice, 'f3', stage('f3'), { ...FAKE_META, title: 'Another Fantasy', subjects: ['Fantasy'] });
    const books = await bookStore.listBooksBySubject(alice, 'Fantasy');
    expect(books.map((b) => b.title).sort()).toEqual(['A Fantasy Book', 'Another Fantasy']);
  });

  it('is scoped to owner', async () => {
    await bookStore.addBook(alice, 'f4', stage('f4'), { ...FAKE_META, title: 'Alice Fantasy', subjects: ['Fantasy'] });
    await bookStore.addBook(bob, 'f5', stage('f5'), { ...FAKE_META, title: 'Bob Fantasy', subjects: ['Fantasy'] });
    const books = await bookStore.listBooksBySubject(alice, 'Fantasy');
    expect(books.map((b) => b.title)).toContain('Alice Fantasy');
    expect(books.map((b) => b.title)).not.toContain('Bob Fantasy');
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

```bash
npm test -- --testPathPattern=services/book-store
```
Expected: new tests fail.

- [ ] **Step 3: Implement `listBooksBySubject` in `book-store.ts`**

Add after `listBooksBySeries`. The raw SQL query selects book IDs that have the given subject via `json_each`, then fetches full rows via Prisma:

```typescript
async listBooksBySubject(owner: Owner, subject: string): Promise<Book[]> {
  const matched = await this.prisma.$queryRaw<Array<{ id: string }>>`
    SELECT DISTINCT b.id
    FROM books b, json_each(b.subjects) je
    WHERE b.user_id = ${owner.userId}
      AND je.type = 'text'
      AND trim(CAST(je.value AS TEXT)) = ${subject}
  `;
  if (matched.length === 0) return [];
  const ids = matched.map((r) => r.id);
  const rows = await this.prisma.book.findMany({
    where: { userId: owner.userId, id: { in: ids } },
    select: BOOK_SELECT,
  });
  return this.sortByTitle(rows).map((r) => this.prismaBookToBook(owner, r));
}
```

- [ ] **Step 4: Run tests to verify they pass**

```bash
npm test -- --testPathPattern=services/book-store
```
Expected: all pass.

- [ ] **Step 5: Commit**

```bash
git add app/server/services/book-store.ts app/server/services/book-store.test.ts
git commit -m "feat: add BookStore.listBooksBySubject"
```

---

## Task 6: BookStore — `listBooksByStatus`

**Files:**
- Modify: `app/server/services/book-store.ts`
- Modify: `app/server/services/book-store.test.ts`

Reuses `standaloneStatusWhere()` (already in this file) which returns a `Prisma.BookWhereInput` — no raw SQL needed. Status is based on individual book progress (`Progress.percentage`): 0 = not started, 0 < p < 1 = in progress, >= 1 = completed.

- [ ] **Step 1: Write failing tests**

Add to `app/server/services/book-store.test.ts`. These tests need to write progress records. Look at how `listBooksPage` tests set up progress — or use Prisma directly. The Progress model fields are: `userId`, `document` (= book id), `progress` (string), `percentage` (float), `device`, `deviceId`, `timestamp`:

```typescript
describe('listBooksByStatus', () => {
  async function setProgress(userId: string, bookId: string, percentage: number): Promise<void> {
    await prisma.progress.upsert({
      where: { userId_document: { userId, document: bookId } },
      create: {
        userId,
        document: bookId,
        progress: String(percentage),
        percentage,
        device: 'test',
        deviceId: 'test-device',
        timestamp: Math.floor(Date.now() / 1000),
      },
      update: { percentage },
    });
  }

  it('returns all books for not-started when none have progress', async () => {
    await bookStore.addBook(alice, 'g1', stage('g1'), { ...FAKE_META, title: 'Book A' });
    const books = await bookStore.listBooksByStatus(alice, 'not-started');
    expect(books.map((b) => b.title)).toContain('Book A');
  });

  it('not-started excludes books with any progress', async () => {
    await bookStore.addBook(alice, 'g2', stage('g2'), { ...FAKE_META, title: 'Started Book' });
    await setProgress(alice.userId, 'g2', 0.5);
    const books = await bookStore.listBooksByStatus(alice, 'not-started');
    expect(books.map((b) => b.id)).not.toContain('g2');
  });

  it('in-progress returns only partially read books', async () => {
    await bookStore.addBook(alice, 'g3', stage('g3'), { ...FAKE_META, title: 'In Progress' });
    await bookStore.addBook(alice, 'g4', stage('g4'), { ...FAKE_META, title: 'Unread' });
    await bookStore.addBook(alice, 'g5', stage('g5'), { ...FAKE_META, title: 'Done' });
    await setProgress(alice.userId, 'g3', 0.5);
    await setProgress(alice.userId, 'g5', 1.0);
    const books = await bookStore.listBooksByStatus(alice, 'in-progress');
    expect(books.map((b) => b.id)).toEqual(['g3']);
  });

  it('completed returns only fully read books', async () => {
    await bookStore.addBook(alice, 'g6', stage('g6'), { ...FAKE_META, title: 'Complete' });
    await bookStore.addBook(alice, 'g7', stage('g7'), { ...FAKE_META, title: 'Partial' });
    await setProgress(alice.userId, 'g6', 1.0);
    await setProgress(alice.userId, 'g7', 0.3);
    const books = await bookStore.listBooksByStatus(alice, 'completed');
    expect(books.map((b) => b.id)).toEqual(['g6']);
  });

  it('is scoped to owner', async () => {
    await bookStore.addBook(alice, 'g8', stage('g8'), { ...FAKE_META, title: 'Alice Book' });
    await bookStore.addBook(bob, 'g9', stage('g9'), { ...FAKE_META, title: 'Bob Book' });
    await setProgress(alice.userId, 'g8', 1.0);
    await setProgress(bob.userId, 'g9', 1.0);
    const books = await bookStore.listBooksByStatus(alice, 'completed');
    expect(books.map((b) => b.id)).toContain('g8');
    expect(books.map((b) => b.id)).not.toContain('g9');
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

```bash
npm test -- --testPathPattern=services/book-store
```
Expected: new tests fail.

- [ ] **Step 3: Implement `listBooksByStatus` in `book-store.ts`**

Add after `listBooksBySubject`. Import `Prisma` at the top of the file if not already imported (check: `import { ..., Prisma } from '@prisma/client'`):

```typescript
async listBooksByStatus(
  owner: Owner,
  status: 'not-started' | 'in-progress' | 'completed'
): Promise<Book[]> {
  const progresses = await this.prisma.progress.findMany({
    where: { userId: owner.userId },
    select: { document: true, percentage: true },
  });
  const progressMap = new Map(progresses.map((p) => [p.document, p.percentage]));
  const statusWhere = standaloneStatusWhere(status, progressMap);
  const rows = await this.prisma.book.findMany({
    where: { userId: owner.userId, ...statusWhere },
    select: BOOK_SELECT,
  });
  return this.sortByTitle(rows).map((r) => this.prismaBookToBook(owner, r));
}
```

Note: `standaloneStatusWhere` is a module-level function already defined earlier in `book-store.ts` — no import needed.

- [ ] **Step 4: Run tests to verify they pass**

```bash
npm test -- --testPathPattern=services/book-store
```
Expected: all pass.

- [ ] **Step 5: Commit**

```bash
git add app/server/services/book-store.ts app/server/services/book-store.test.ts
git commit -m "feat: add BookStore.listBooksByStatus"
```

---

## Task 7: OPDS author routes

**Files:**
- Modify: `app/server/routes/opds.ts`
- Modify: `app/server/routes/opds.test.ts`

- [ ] **Step 1: Write failing tests**

Add to `app/server/routes/opds.test.ts`:

```typescript
describe('GET /opds/authors', () => {
  it('returns a navigation feed with one entry per distinct author', async () => {
    await bookStore.addBook(alice, 'au1', stage('au1'), { ...FAKE_META, author: 'Jane Austen' });
    await bookStore.addBook(alice, 'au2', stage('au2'), { ...FAKE_META, author: 'Jane Austen' });
    await bookStore.addBook(alice, 'au3', stage('au3'), { ...FAKE_META, author: 'Leo Tolstoy' });
    const res = await request(app).get('/opds/authors').set(basicAuth('alice', 'secret'));
    expect(res.status).toBe(200);
    expect(res.headers['content-type']).toMatch(/atom\+xml/);
    expect(res.text).toContain('Jane Austen');
    expect(res.text).toContain('Leo Tolstoy');
    // Each author appears exactly once as an entry title
    const matches = res.text.match(/<title>Jane Austen<\/title>/g) ?? [];
    expect(matches.length).toBe(1);
  });

  it('returns 401 without credentials', async () => {
    const res = await request(app).get('/opds/authors');
    expect(res.status).toBe(401);
  });
});

describe('GET /opds/authors/:author', () => {
  it('returns an acquisition feed with books by the author', async () => {
    await bookStore.addBook(alice, 'au4', stage('au4'), { ...FAKE_META, author: 'Ursula Le Guin', title: 'The Left Hand of Darkness' });
    await bookStore.addBook(alice, 'au5', stage('au5'), { ...FAKE_META, author: 'Other', title: 'Other Book' });
    const res = await request(app)
      .get('/opds/authors/Ursula%20Le%20Guin')
      .set(basicAuth('alice', 'secret'));
    expect(res.status).toBe(200);
    expect(res.text).toContain('The Left Hand of Darkness');
    expect(res.text).not.toContain('Other Book');
    expect(res.text).toContain('opds-spec.org/acquisition"');
  });

  it('returns empty acquisition feed for unknown author', async () => {
    const res = await request(app)
      .get('/opds/authors/Nobody')
      .set(basicAuth('alice', 'secret'));
    expect(res.status).toBe(200);
    expect(res.text).toContain('<feed');
    expect(res.text).not.toContain('<entry>');
  });

  it('escapes special characters in author names', async () => {
    await bookStore.addBook(alice, 'au6', stage('au6'), { ...FAKE_META, author: 'Author & Co', title: 'Special Book' });
    const res = await request(app)
      .get('/opds/authors/Author%20%26%20Co')
      .set(basicAuth('alice', 'secret'));
    expect(res.status).toBe(200);
    expect(res.text).toContain('Special Book');
  });

  it('does not expose other users\' books', async () => {
    await bookStore.addBook(alice, 'au7', stage('au7'), { ...FAKE_META, author: 'Shared Author', title: 'Alice Book' });
    await bookStore.addBook(bob, 'au8', stage('au8'), { ...FAKE_META, author: 'Shared Author', title: 'Bob Book' });
    const res = await request(app)
      .get('/opds/authors/Shared%20Author')
      .set(basicAuth('alice', 'secret'));
    expect(res.text).toContain('Alice Book');
    expect(res.text).not.toContain('Bob Book');
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

```bash
npm test -- --testPathPattern=routes/opds
```
Expected: new tests fail with 404 (routes not yet defined).

- [ ] **Step 3: Add author routes to `opds.ts`**

Add these two routes after the `/books/:id/cover` handler, before `return router`:

```typescript
router.get('/authors', auth, async (req: Request, res: Response) => {
  const owner = req.opdsOwner!;
  const authors = await bookStore.getAuthors(owner);
  const baseUrl = `${req.protocol}://${req.get('host')}`;
  const now = new Date().toISOString();
  res.set('Content-Type', 'application/atom+xml;charset=utf-8');
  res.send(
    navigationFeed({
      id: 'urn:hass-odps:authors',
      title: 'By Author',
      selfHref: `${baseUrl}/opds/authors`,
      baseUrl,
      now,
      entries: authors.map((author) =>
        navEntry(
          `urn:hass-odps:author:${author}`,
          author,
          `Books by ${author}`,
          `${baseUrl}/opds/authors/${encodeURIComponent(author)}`,
          'acquisition',
          now
        )
      ),
    })
  );
});

router.get('/authors/:author', auth, async (req: Request, res: Response) => {
  const owner = req.opdsOwner!;
  const author = decodeURIComponent(req.params.author);
  const books = await bookStore.listBooksByAuthor(owner, author);
  const baseUrl = `${req.protocol}://${req.get('host')}`;
  const now = new Date().toISOString();
  res.set('Content-Type', 'application/atom+xml;charset=utf-8');
  res.send(
    acquisitionFeed({
      id: `urn:hass-odps:author:${author}`,
      title: author,
      selfHref: `${baseUrl}/opds/authors/${encodeURIComponent(author)}`,
      baseUrl,
      now,
      entries: books.map((b) => bookEntry(b, baseUrl, smallestWidth)),
    })
  );
});
```

- [ ] **Step 4: Run tests to verify they pass**

```bash
npm test -- --testPathPattern=routes/opds
```
Expected: all pass.

- [ ] **Step 5: Commit**

```bash
git add app/server/routes/opds.ts app/server/routes/opds.test.ts
git commit -m "feat: add OPDS author browse routes"
```

---

## Task 8: OPDS series routes

**Files:**
- Modify: `app/server/routes/opds.ts`
- Modify: `app/server/routes/opds.test.ts`

- [ ] **Step 1: Write failing tests**

Add to `app/server/routes/opds.test.ts`:

```typescript
describe('GET /opds/series', () => {
  it('returns a navigation feed listing series', async () => {
    await bookStore.addBook(alice, 'sr1', stage('sr1'), { ...FAKE_META, series: 'Dune', seriesIndex: 1 });
    await bookStore.addBook(alice, 'sr2', stage('sr2'), { ...FAKE_META, series: 'Foundation', seriesIndex: 1 });
    const res = await request(app).get('/opds/series').set(basicAuth('alice', 'secret'));
    expect(res.status).toBe(200);
    expect(res.headers['content-type']).toMatch(/atom\+xml/);
    expect(res.text).toContain('Dune');
    expect(res.text).toContain('Foundation');
  });

  it('returns empty navigation feed when no series exist', async () => {
    const res = await request(app).get('/opds/series').set(basicAuth('alice', 'secret'));
    expect(res.status).toBe(200);
    expect(res.text).toContain('<feed');
  });

  it('returns 401 without credentials', async () => {
    const res = await request(app).get('/opds/series');
    expect(res.status).toBe(401);
  });
});

describe('GET /opds/series/:seriesId', () => {
  it('returns books in the series sorted by seriesIndex', async () => {
    await bookStore.addBook(alice, 'sr3', stage('sr3'), { ...FAKE_META, series: 'The Expanse', seriesIndex: 1, title: 'Leviathan Wakes' });
    await bookStore.addBook(alice, 'sr4', stage('sr4'), { ...FAKE_META, series: 'The Expanse', seriesIndex: 2, title: "Caliban's War" });
    // Fetch the series ID from the navigation feed
    const navRes = await request(app).get('/opds/series').set(basicAuth('alice', 'secret'));
    const idMatch = navRes.text.match(/href="[^"]+\/opds\/series\/([^"]+)"/);
    expect(idMatch).not.toBeNull();
    const seriesId = idMatch![1];
    const res = await request(app).get(`/opds/series/${seriesId}`).set(basicAuth('alice', 'secret'));
    expect(res.status).toBe(200);
    expect(res.text).toContain('Leviathan Wakes');
    expect(res.text).toContain("Caliban's War");
    // Leviathan Wakes should appear before Caliban's War
    const lwPos = res.text.indexOf('Leviathan Wakes');
    const cwPos = res.text.indexOf("Caliban");
    expect(lwPos).toBeLessThan(cwPos);
  });

  it('returns empty acquisition feed for unknown seriesId', async () => {
    const res = await request(app)
      .get('/opds/series/00000000-0000-0000-0000-000000000000')
      .set(basicAuth('alice', 'secret'));
    expect(res.status).toBe(200);
    expect(res.text).toContain('<feed');
    expect(res.text).not.toContain('<entry>');
  });

  it('does not expose other users\' series', async () => {
    await bookStore.addBook(alice, 'sr5', stage('sr5'), { ...FAKE_META, series: 'Unique Series', seriesIndex: 1, title: 'Alice Book' });
    await bookStore.addBook(bob, 'sr6', stage('sr6'), { ...FAKE_META, series: 'Unique Series', seriesIndex: 1, title: 'Bob Book' });
    const navRes = await request(app).get('/opds/series').set(basicAuth('alice', 'secret'));
    const idMatch = navRes.text.match(/href="[^"]+\/opds\/series\/([^"]+)"/);
    const seriesId = idMatch![1];
    const res = await request(app).get(`/opds/series/${seriesId}`).set(basicAuth('alice', 'secret'));
    expect(res.text).toContain('Alice Book');
    expect(res.text).not.toContain('Bob Book');
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

```bash
npm test -- --testPathPattern=routes/opds
```
Expected: new tests fail with 404.

- [ ] **Step 3: Add series routes to `opds.ts`**

Add after the `/authors/:author` handler:

```typescript
router.get('/series', auth, async (req: Request, res: Response) => {
  const owner = req.opdsOwner!;
  const series = await bookStore.listSeries(owner);
  const baseUrl = `${req.protocol}://${req.get('host')}`;
  const now = new Date().toISOString();
  res.set('Content-Type', 'application/atom+xml;charset=utf-8');
  res.send(
    navigationFeed({
      id: 'urn:hass-odps:series',
      title: 'By Series',
      selfHref: `${baseUrl}/opds/series`,
      baseUrl,
      now,
      entries: series.map((s) =>
        navEntry(
          `urn:hass-odps:series:${s.id}`,
          s.name,
          `${s.bookCount} book${s.bookCount !== 1 ? 's' : ''}`,
          `${baseUrl}/opds/series/${encodeURIComponent(s.id)}`,
          'acquisition',
          now
        )
      ),
    })
  );
});

router.get('/series/:seriesId', auth, async (req: Request, res: Response) => {
  const owner = req.opdsOwner!;
  const seriesId = decodeURIComponent(req.params.seriesId);
  const books = await bookStore.listBooksBySeries(owner, seriesId);
  const baseUrl = `${req.protocol}://${req.get('host')}`;
  const now = new Date().toISOString();
  res.set('Content-Type', 'application/atom+xml;charset=utf-8');
  res.send(
    acquisitionFeed({
      id: `urn:hass-odps:series:${seriesId}`,
      title: seriesId,
      selfHref: `${baseUrl}/opds/series/${encodeURIComponent(seriesId)}`,
      baseUrl,
      now,
      entries: books.map((b) => bookEntry(b, baseUrl, smallestWidth)),
    })
  );
});
```

- [ ] **Step 4: Run tests to verify they pass**

```bash
npm test -- --testPathPattern=routes/opds
```
Expected: all pass.

- [ ] **Step 5: Commit**

```bash
git add app/server/routes/opds.ts app/server/routes/opds.test.ts
git commit -m "feat: add OPDS series browse routes"
```

---

## Task 9: OPDS subject routes

**Files:**
- Modify: `app/server/routes/opds.ts`
- Modify: `app/server/routes/opds.test.ts`

- [ ] **Step 1: Write failing tests**

Add to `app/server/routes/opds.test.ts`:

```typescript
describe('GET /opds/subjects', () => {
  it('returns a navigation feed listing distinct subjects', async () => {
    await bookStore.addBook(alice, 'sub1', stage('sub1'), { ...FAKE_META, subjects: ['Fantasy', 'Adventure'] });
    await bookStore.addBook(alice, 'sub2', stage('sub2'), { ...FAKE_META, subjects: ['Science Fiction'] });
    const res = await request(app).get('/opds/subjects').set(basicAuth('alice', 'secret'));
    expect(res.status).toBe(200);
    expect(res.headers['content-type']).toMatch(/atom\+xml/);
    expect(res.text).toContain('Fantasy');
    expect(res.text).toContain('Adventure');
    expect(res.text).toContain('Science Fiction');
    // Each subject appears exactly once as an entry title
    const fantasyMatches = res.text.match(/<title>Fantasy<\/title>/g) ?? [];
    expect(fantasyMatches.length).toBe(1);
  });

  it('returns 401 without credentials', async () => {
    const res = await request(app).get('/opds/subjects');
    expect(res.status).toBe(401);
  });
});

describe('GET /opds/subjects/:subject', () => {
  it('returns only books tagged with the subject', async () => {
    await bookStore.addBook(alice, 'sub3', stage('sub3'), { ...FAKE_META, title: 'Fantasy Book', subjects: ['Fantasy'] });
    await bookStore.addBook(alice, 'sub4', stage('sub4'), { ...FAKE_META, title: 'Other Book', subjects: ['Biography'] });
    const res = await request(app)
      .get('/opds/subjects/Fantasy')
      .set(basicAuth('alice', 'secret'));
    expect(res.status).toBe(200);
    expect(res.text).toContain('Fantasy Book');
    expect(res.text).not.toContain('Other Book');
    expect(res.text).toContain('opds-spec.org/acquisition"');
  });

  it('returns empty acquisition feed for unknown subject', async () => {
    const res = await request(app)
      .get('/opds/subjects/NonExistent')
      .set(basicAuth('alice', 'secret'));
    expect(res.status).toBe(200);
    expect(res.text).toContain('<feed');
    expect(res.text).not.toContain('<entry>');
  });

  it('handles subjects with spaces via URL encoding', async () => {
    await bookStore.addBook(alice, 'sub5', stage('sub5'), { ...FAKE_META, title: 'History Book', subjects: ['World History'] });
    const res = await request(app)
      .get('/opds/subjects/World%20History')
      .set(basicAuth('alice', 'secret'));
    expect(res.status).toBe(200);
    expect(res.text).toContain('History Book');
  });

  it('does not expose other users\' books', async () => {
    await bookStore.addBook(alice, 'sub6', stage('sub6'), { ...FAKE_META, title: 'Alice Fantasy', subjects: ['Fantasy'] });
    await bookStore.addBook(bob, 'sub7', stage('sub7'), { ...FAKE_META, title: 'Bob Fantasy', subjects: ['Fantasy'] });
    const res = await request(app)
      .get('/opds/subjects/Fantasy')
      .set(basicAuth('alice', 'secret'));
    expect(res.text).toContain('Alice Fantasy');
    expect(res.text).not.toContain('Bob Fantasy');
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

```bash
npm test -- --testPathPattern=routes/opds
```
Expected: new tests fail with 404.

- [ ] **Step 3: Add subject routes to `opds.ts`**

Add after the `/series/:seriesId` handler:

```typescript
router.get('/subjects', auth, async (req: Request, res: Response) => {
  const owner = req.opdsOwner!;
  const subjects = await bookStore.getSubjects(owner);
  const baseUrl = `${req.protocol}://${req.get('host')}`;
  const now = new Date().toISOString();
  res.set('Content-Type', 'application/atom+xml;charset=utf-8');
  res.send(
    navigationFeed({
      id: 'urn:hass-odps:subjects',
      title: 'By Subject',
      selfHref: `${baseUrl}/opds/subjects`,
      baseUrl,
      now,
      entries: subjects.map((subject) =>
        navEntry(
          `urn:hass-odps:subject:${subject}`,
          subject,
          `Books tagged with ${subject}`,
          `${baseUrl}/opds/subjects/${encodeURIComponent(subject)}`,
          'acquisition',
          now
        )
      ),
    })
  );
});

router.get('/subjects/:subject', auth, async (req: Request, res: Response) => {
  const owner = req.opdsOwner!;
  const subject = decodeURIComponent(req.params.subject);
  const books = await bookStore.listBooksBySubject(owner, subject);
  const baseUrl = `${req.protocol}://${req.get('host')}`;
  const now = new Date().toISOString();
  res.set('Content-Type', 'application/atom+xml;charset=utf-8');
  res.send(
    acquisitionFeed({
      id: `urn:hass-odps:subject:${subject}`,
      title: subject,
      selfHref: `${baseUrl}/opds/subjects/${encodeURIComponent(subject)}`,
      baseUrl,
      now,
      entries: books.map((b) => bookEntry(b, baseUrl, smallestWidth)),
    })
  );
});
```

- [ ] **Step 4: Run tests to verify they pass**

```bash
npm test -- --testPathPattern=routes/opds
```
Expected: all pass.

- [ ] **Step 5: Commit**

```bash
git add app/server/routes/opds.ts app/server/routes/opds.test.ts
git commit -m "feat: add OPDS subject browse routes"
```

---

## Task 10: OPDS status routes

**Files:**
- Modify: `app/server/routes/opds.ts`
- Modify: `app/server/routes/opds.test.ts`

- [ ] **Step 1: Write failing tests**

Add to `app/server/routes/opds.test.ts`. These tests need to write progress records — add the same `setProgress` helper used in the BookStore tests, adapted for the OPDS test file's `prisma` instance:

```typescript
describe('GET /opds/status', () => {
  it('returns a navigation feed with exactly 3 entries', async () => {
    const res = await request(app).get('/opds/status').set(basicAuth('alice', 'secret'));
    expect(res.status).toBe(200);
    expect(res.headers['content-type']).toMatch(/atom\+xml/);
    expect(res.text).toContain('Not Started');
    expect(res.text).toContain('In Progress');
    expect(res.text).toContain('Completed');
    const entryCount = (res.text.match(/<entry>/g) ?? []).length;
    expect(entryCount).toBe(3);
  });

  it('returns 401 without credentials', async () => {
    const res = await request(app).get('/opds/status');
    expect(res.status).toBe(401);
  });
});

describe('GET /opds/status/:status', () => {
  async function setProgress(userId: string, bookId: string, percentage: number): Promise<void> {
    await prisma.progress.upsert({
      where: { userId_document: { userId, document: bookId } },
      create: {
        userId,
        document: bookId,
        progress: String(percentage),
        percentage,
        device: 'test',
        deviceId: 'test-device',
        timestamp: Math.floor(Date.now() / 1000),
      },
      update: { percentage },
    });
  }

  it('returns 400 for an invalid status slug', async () => {
    const res = await request(app)
      .get('/opds/status/reading')
      .set(basicAuth('alice', 'secret'));
    expect(res.status).toBe(400);
  });

  it('not-started returns books with no progress', async () => {
    await bookStore.addBook(alice, 'st1', stage('st1'), { ...FAKE_META, title: 'Unread Book' });
    await bookStore.addBook(alice, 'st2', stage('st2'), { ...FAKE_META, title: 'Started Book' });
    await setProgress(alice.userId, 'st2', 0.5);
    const res = await request(app).get('/opds/status/not-started').set(basicAuth('alice', 'secret'));
    expect(res.status).toBe(200);
    expect(res.text).toContain('Unread Book');
    expect(res.text).not.toContain('Started Book');
  });

  it('in-progress returns only partially read books', async () => {
    await bookStore.addBook(alice, 'st3', stage('st3'), { ...FAKE_META, title: 'In Progress Book' });
    await bookStore.addBook(alice, 'st4', stage('st4'), { ...FAKE_META, title: 'Unread' });
    await bookStore.addBook(alice, 'st5', stage('st5'), { ...FAKE_META, title: 'Finished' });
    await setProgress(alice.userId, 'st3', 0.4);
    await setProgress(alice.userId, 'st5', 1.0);
    const res = await request(app).get('/opds/status/in-progress').set(basicAuth('alice', 'secret'));
    expect(res.status).toBe(200);
    expect(res.text).toContain('In Progress Book');
    expect(res.text).not.toContain('Unread');
    expect(res.text).not.toContain('Finished');
  });

  it('completed returns only fully read books', async () => {
    await bookStore.addBook(alice, 'st6', stage('st6'), { ...FAKE_META, title: 'Finished Book' });
    await bookStore.addBook(alice, 'st7', stage('st7'), { ...FAKE_META, title: 'Partial' });
    await setProgress(alice.userId, 'st6', 1.0);
    await setProgress(alice.userId, 'st7', 0.7);
    const res = await request(app).get('/opds/status/completed').set(basicAuth('alice', 'secret'));
    expect(res.status).toBe(200);
    expect(res.text).toContain('Finished Book');
    expect(res.text).not.toContain('Partial');
  });

  it('does not expose other users\' books', async () => {
    await bookStore.addBook(alice, 'st8', stage('st8'), { ...FAKE_META, title: 'Alice Done' });
    await bookStore.addBook(bob, 'st9', stage('st9'), { ...FAKE_META, title: 'Bob Done' });
    await setProgress(alice.userId, 'st8', 1.0);
    await setProgress(bob.userId, 'st9', 1.0);
    const res = await request(app).get('/opds/status/completed').set(basicAuth('alice', 'secret'));
    expect(res.text).toContain('Alice Done');
    expect(res.text).not.toContain('Bob Done');
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

```bash
npm test -- --testPathPattern=routes/opds
```
Expected: new tests fail with 404.

- [ ] **Step 3: Add status routes to `opds.ts`**

Add after the `/subjects/:subject` handler:

```typescript
const STATUS_SLUGS = ['not-started', 'in-progress', 'completed'] as const;
type StatusSlug = (typeof STATUS_SLUGS)[number];

const STATUS_LABELS: Record<StatusSlug, string> = {
  'not-started': 'Not Started',
  'in-progress': 'In Progress',
  completed: 'Completed',
};

router.get('/status', auth, (req: Request, res: Response) => {
  const baseUrl = `${req.protocol}://${req.get('host')}`;
  const now = new Date().toISOString();
  res.set('Content-Type', 'application/atom+xml;charset=utf-8');
  res.send(
    navigationFeed({
      id: 'urn:hass-odps:status',
      title: 'By Status',
      selfHref: `${baseUrl}/opds/status`,
      baseUrl,
      now,
      entries: STATUS_SLUGS.map((slug) =>
        navEntry(
          `urn:hass-odps:status:${slug}`,
          STATUS_LABELS[slug],
          `Books that are ${STATUS_LABELS[slug].toLowerCase()}`,
          `${baseUrl}/opds/status/${slug}`,
          'acquisition',
          now
        )
      ),
    })
  );
});

router.get('/status/:status', auth, async (req: Request, res: Response) => {
  const slug = req.params.status;
  if (!STATUS_SLUGS.includes(slug as StatusSlug)) {
    res.status(400).send('Invalid status. Use: not-started, in-progress, or completed');
    return;
  }
  const owner = req.opdsOwner!;
  const books = await bookStore.listBooksByStatus(owner, slug as StatusSlug);
  const baseUrl = `${req.protocol}://${req.get('host')}`;
  const now = new Date().toISOString();
  res.set('Content-Type', 'application/atom+xml;charset=utf-8');
  res.send(
    acquisitionFeed({
      id: `urn:hass-odps:status:${slug}`,
      title: STATUS_LABELS[slug as StatusSlug],
      selfHref: `${baseUrl}/opds/status/${slug}`,
      baseUrl,
      now,
      entries: books.map((b) => bookEntry(b, baseUrl, smallestWidth)),
    })
  );
});
```

- [ ] **Step 4: Run all tests to verify everything passes**

```bash
npm test
```
Expected: all 17+ suites pass, 0 failures.

- [ ] **Step 5: Commit**

```bash
git add app/server/routes/opds.ts app/server/routes/opds.test.ts
git commit -m "feat: add OPDS status browse routes"
```

---

## Final verification

- [ ] **Run the full test suite one last time**

```bash
npm test
```
Expected: all suites pass, 0 failures.

- [ ] **Run lint**

```bash
npm run lint
```
Expected: no errors.
