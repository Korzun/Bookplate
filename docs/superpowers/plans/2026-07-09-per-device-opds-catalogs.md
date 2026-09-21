# Per-device OPDS catalogs Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Serve each device its own OPDS catalog under `/opds/device/<slug>/` where every entry carries exactly one acquisition link (that device's edition), so single-link clients like Crosspoint download the right file.

**Architecture:** The existing OPDS browse/nav handlers are extracted into a `mountFeeds()` helper that reads an optional per-request `req.opdsDevice`. It is mounted twice inside `createOpdsRouter`: once at the base `/opds`, once at `/opds/device/:slug` behind a `resolveDevice` middleware. Download/cover routes stay base-only; a device feed's single acquisition link points at the existing `/opds/books/:id/devices/:slug/download` endpoint. `bookEntry` collapses to a single acquisition link in both modes (base feed drops its per-device links).

**Tech Stack:** TypeScript, Express 4, Jest + supertest (server), Prisma/SQLite, React + Vitest (client). npm workspaces (`app/server`, `app/client`).

## Global Constraints

- Design spec: `docs/superpowers/specs/2026-07-09-per-device-opds-catalogs-design.md`.
- URL prefix is exactly `/opds/device/<slug>` (singular `device`).
- Device feeds are browse-only; do NOT add download/cover routes under `/device/:slug`.
- A device feed's acquisition + cover links point at base `/opds/books/...` absolute URLs (origin), NOT at the device-scoped path.
- Editions build lazily on download via `editionStore.getOrCreateEdition`; rendering a feed must never build an edition.
- Server test cmd: `npm test -w app/server` (all) or `cd app/server && npx jest routes/opds.test.ts -t "<name>"` (single).
- Server lint/typecheck cmd: `npm run lint -w app/server` (runs `eslint . && tsc --noEmit`).
- Client test cmd: `npm test -w app/client`. Client lint: `npm run lint -w app/client`.
- Commit after each task. Branch: `feat/per-device-opds-catalogs` (already checked out).

---

### Task 1: Single-link `bookEntry` + device-aware feed handlers

Change `bookEntry` to a single optional-device param and refactor the browse/nav handlers to build URLs from a per-request device context. This is one atomic change: the `bookEntry` signature and `FeedParams` field changes ripple to every call site, so the tree only compiles once all edits land. Net behavior after this task: the base catalog is unchanged **except** book entries no longer carry per-device links, and every handler is device-ready (but nothing sets `req.opdsDevice` yet).

**Files:**
- Modify: `app/server/routes/opds-templates.ts` (`FeedParams`, `feedWrapper`, `bookEntry`)
- Modify: `app/server/routes/opds.ts` (extract `mountFeeds`, add `feedContext`, mount base catalog)
- Test: `app/server/routes/opds.test.ts` (repurpose the per-device-link feed test)

**Interfaces:**
- Produces: `bookEntry(b: Book, baseUrl: string, smallestThumbnailWidth: number | null, device?: Device): string` — one acquisition link; `device` present → `${baseUrl}/opds/books/${b.id}/devices/${device.slug}/download`, else `${baseUrl}/opds/books/${b.id}/download`.
- Produces: `FeedParams.startHref: string` (replaces `FeedParams.baseUrl`); `feedWrapper` renders `rel="start"` from `startHref`.
- Produces: `mountFeeds(target: Router)` registering the browse/nav routes, each reading `req.opdsDevice` via a local `feedContext(req)` → `{ origin, device, feedBase }`.

- [ ] **Step 1: Update the repurposed test to expect a single-link base feed**

In `app/server/routes/opds.test.ts`, replace the test at ~line 444 (`'lists a per-device acquisition link on each book entry'`) with:

```ts
  it('does not list per-device acquisition links in the base book feed', async () => {
    const bookId = 'opds-device1';
    await bookStore.addBook(alice, bookId, stage(bookId), { ...FAKE_META, title: 'Device Book' });
    const deviceStore = new DeviceStore(prisma);
    await deviceStore.create({
      name: 'Kindle',
      coverWidth: null,
      coverHeight: null,
      coverFit: 'contain',
      bwCover: false,
      simplify: true,
    });
    const editionStore = new EditionStore(fs.mkdtempSync(path.join(os.tmpdir(), 'ed-')), prisma);
    const app2 = express();
    app2.use(
      '/opds',
      createOpdsRouter(
        bookStore,
        userStore,
        [60, 170],
        'Bookplate',
        deviceStore,
        editionStore,
        ValidationThreshold.ERROR
      )
    );

    const res = await request(app2).get('/opds/books').set(basicAuth('alice', 'secret'));
    // Base feed carries exactly the original download link, no device variants.
    expect(res.text).toContain(`/opds/books/${bookId}/download`);
    expect(res.text).not.toContain('/devices/kindle/download');
    expect(res.text).not.toContain('Download for Kindle');
  });
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `cd app/server && npx jest routes/opds.test.ts -t "does not list per-device acquisition links"`
Expected: FAIL — current base feed still contains `/devices/kindle/download`.

- [ ] **Step 3: Change `FeedParams`, `feedWrapper`, and `bookEntry` in `opds-templates.ts`**

Replace the `FeedParams` interface (lines 27-34) `baseUrl` field with `startHref`:

```ts
export interface FeedParams {
  id: string;
  title: string;
  selfHref: string;
  startHref: string;
  now: string;
  entries: string[];
}
```

Replace `bookEntry` (lines 53-96) with the single-device version:

```ts
export function bookEntry(
  b: Book,
  baseUrl: string,
  smallestThumbnailWidth: number | null,
  device?: Device
): string {
  const acquisitionHref = device
    ? `${baseUrl}/opds/books/${b.id}/devices/${device.slug}/download`
    : `${baseUrl}/opds/books/${b.id}/download`;
  const acquisitionTitle = device ? `Download for ${device.name}` : b.filename;
  const parts: string[] = [
    xml`  <entry>
    <title>${b.title}</title>
    <id>urn:bookplate:book:${b.id}</id>
    <updated>${b.mtime.toISOString()}</updated>
    <author><name>${b.author}</name></author>
    <summary>${b.description}</summary>
    <link rel="http://opds-spec.org/acquisition"
          href="${acquisitionHref}"
          type="application/epub+zip"
          title="${acquisitionTitle}"/>`,
  ];
  const version = String(b.mtime.getTime());
  if (b.hasCover) {
    parts.push(
      xml`    <link rel="http://opds-spec.org/image"
          href="${baseUrl}/opds/books/${b.id}/cover?v=${version}"
          type="image/jpeg"/>`
    );
  }
  if (b.hasCover && smallestThumbnailWidth !== null) {
    parts.push(
      xml`    <link rel="http://opds-spec.org/image/thumbnail"
          href="${baseUrl}/opds/books/${b.id}/cover?width=${String(smallestThumbnailWidth)}&amp;v=${version}"
          type="image/jpeg"/>`
    );
  }
  parts.push('  </entry>');
  return parts.join('\n');
}
```

Replace `feedWrapper` (lines 98-108) so `rel="start"` uses `startHref`:

```ts
function feedWrapper(params: FeedParams, kind: 'navigation' | 'acquisition'): string {
  const { id, title, selfHref, startHref, now, entries } = params;
  const header = xml`<?xml version="1.0" encoding="UTF-8"?>
<feed xmlns="http://www.w3.org/2005/Atom" xmlns:opds="http://opds-spec.org/2010/catalog">
  <id>${id}</id>
  <title>${title}</title>
  <updated>${now}</updated>
  <link rel="self" href="${selfHref}" type="application/atom+xml;profile=opds-catalog;kind=${kind}"/>
  <link rel="start" href="${startHref}" type="application/atom+xml;profile=opds-catalog;kind=navigation"/>`;
  return header + (entries.length > 0 ? '\n' + entries.join('\n') : '') + '\n</feed>';
}
```

The `Device` import already exists at the top of the file (`import { Book, Device } from '../types';`).

- [ ] **Step 4: Rewrite `opds.ts` to extract `mountFeeds` + `feedContext` and mount the base catalog**

Replace the entire contents of `app/server/routes/opds.ts` with:

```ts
import { createHash } from 'crypto';
import { Router, Request, Response, RequestHandler } from 'express';
import { ValidationThreshold } from '@korzun/epubcheck-ts';
import { BookStore } from '../services/book-store';
import { UserStore } from '../services/user-store';
import { DeviceStore } from '../services/device-store';
import { EditionStore } from '../services/edition-store';
import { opdsAuth } from '../middleware/auth';
import { logger } from '../logger';
import { navigationFeed, acquisitionFeed, navEntry, bookEntry } from './opds-templates';
import { asyncHandler } from '../utils/async-handler';

const log = logger('OPDS');

const VALID_STATUSES = new Set(['not-started', 'in-progress', 'completed'] as const);

export function createOpdsRouter(
  bookStore: BookStore,
  userStore: UserStore,
  thumbnailWidths: number[],
  libraryName: string = 'Bookplate',
  deviceStore?: DeviceStore,
  editionStore?: EditionStore,
  validationThreshold: ValidationThreshold = ValidationThreshold.ERROR
): Router {
  const router = Router();
  const auth = opdsAuth(userStore, libraryName);
  const smallestWidth = thumbnailWidths.length > 0 ? Math.min(...thumbnailWidths) : null;

  // Base vs device-scoped context. `req.opdsDevice` is set only under the
  // /opds/device/:slug mount; when absent, we serve the base catalog. Nav/self/start
  // hrefs use `feedBase`; book acquisition + cover links always use the base `origin`.
  function feedContext(req: Request) {
    const origin = `${req.protocol}://${req.get('host')}`;
    const device = req.opdsDevice;
    const feedBase = device ? `${origin}/opds/device/${device.slug}` : `${origin}/opds`;
    return { origin, device, feedBase };
  }

  // Browse/nav feed handlers. Mounted for the base catalog and each device catalog.
  function mountFeeds(target: Router) {
    target.get('/', (req: Request, res: Response) => {
      const { feedBase, device } = feedContext(req);
      log.debug('Root catalog served');
      const now = new Date().toISOString();
      res.set('Content-Type', 'application/atom+xml;charset=utf-8');
      res.send(
        navigationFeed({
          id: 'urn:bookplate:root',
          title: device
            ? `${libraryName} — ${device.name}`
            : /library$/i.test(libraryName)
              ? libraryName
              : `${libraryName} Library`,
          selfHref: `${feedBase}/`,
          startHref: `${feedBase}/`,
          now,
          entries: [
            navEntry('urn:bookplate:books', 'By Book Title', 'Browse all books in the library', `${feedBase}/books`, 'acquisition', now),
            navEntry('urn:bookplate:authors', 'By Author', 'Browse books by author', `${feedBase}/authors`, 'navigation', now),
            navEntry('urn:bookplate:series', 'By Series', 'Browse books by series', `${feedBase}/series`, 'navigation', now),
            navEntry('urn:bookplate:subjects', 'By Subject', 'Browse books by subject', `${feedBase}/subjects`, 'navigation', now),
            navEntry('urn:bookplate:status', 'By Status', 'Browse books by reading status', `${feedBase}/status`, 'navigation', now),
          ],
        })
      );
    });

    target.get(
      '/books',
      asyncHandler(async (req: Request, res: Response) => {
        const owner = req.opdsOwner!;
        const { origin, device, feedBase } = feedContext(req);
        const books = await bookStore.listBooks(owner);
        log.debug(`Books feed served (${books.length} books)`);
        const now = new Date().toISOString();
        res.set('Content-Type', 'application/atom+xml;charset=utf-8');
        res.send(
          acquisitionFeed({
            id: 'urn:bookplate:books',
            title: 'By Book Title',
            selfHref: `${feedBase}/books`,
            startHref: `${feedBase}/`,
            now,
            entries: books.map((b) => bookEntry(b, origin, smallestWidth, device)),
          })
        );
      })
    );

    target.get(
      '/authors',
      asyncHandler(async (req: Request, res: Response) => {
        const owner = req.opdsOwner!;
        const { feedBase } = feedContext(req);
        const authors = await bookStore.getAuthors(owner);
        const now = new Date().toISOString();
        res.set('Content-Type', 'application/atom+xml;charset=utf-8');
        res.send(
          navigationFeed({
            id: 'urn:bookplate:authors',
            title: 'By Author',
            selfHref: `${feedBase}/authors`,
            startHref: `${feedBase}/`,
            now,
            entries: authors.map((author) =>
              navEntry(`urn:bookplate:author:${author}`, author, `Books by ${author}`, `${feedBase}/authors/${encodeURIComponent(author)}`, 'acquisition', now)
            ),
          })
        );
      })
    );

    target.get(
      '/authors/:author',
      asyncHandler(async (req: Request, res: Response) => {
        const owner = req.opdsOwner!;
        const { origin, device, feedBase } = feedContext(req);
        const author = req.params.author;
        const books = await bookStore.listBooksByAuthor(owner, author);
        const now = new Date().toISOString();
        res.set('Content-Type', 'application/atom+xml;charset=utf-8');
        res.send(
          acquisitionFeed({
            id: `urn:bookplate:author:${author}`,
            title: author,
            selfHref: `${feedBase}/authors/${encodeURIComponent(author)}`,
            startHref: `${feedBase}/`,
            now,
            entries: books.map((b) => bookEntry(b, origin, smallestWidth, device)),
          })
        );
      })
    );

    target.get(
      '/series',
      asyncHandler(async (req: Request, res: Response) => {
        const owner = req.opdsOwner!;
        const { feedBase } = feedContext(req);
        const seriesList = await bookStore.listSeries(owner);
        const now = new Date().toISOString();
        res.set('Content-Type', 'application/atom+xml;charset=utf-8');
        res.send(
          navigationFeed({
            id: 'urn:bookplate:series',
            title: 'By Series',
            selfHref: `${feedBase}/series`,
            startHref: `${feedBase}/`,
            now,
            entries: seriesList.map((s) =>
              navEntry(`urn:bookplate:series:${s.id}`, s.name, `${s.bookCount} book${s.bookCount === 1 ? '' : 's'}`, `${feedBase}/series/${s.id}`, 'acquisition', now)
            ),
          })
        );
      })
    );

    target.get(
      '/series/:seriesId',
      asyncHandler(async (req: Request, res: Response) => {
        const owner = req.opdsOwner!;
        const { origin, device, feedBase } = feedContext(req);
        const seriesId = req.params.seriesId;
        const books = await bookStore.listBooksBySeries(owner, seriesId);
        const now = new Date().toISOString();
        res.set('Content-Type', 'application/atom+xml;charset=utf-8');
        res.send(
          acquisitionFeed({
            id: `urn:bookplate:series:${seriesId}`,
            title: books.length > 0 ? books[0].series : 'Series',
            selfHref: `${feedBase}/series/${seriesId}`,
            startHref: `${feedBase}/`,
            now,
            entries: books.map((b) => bookEntry(b, origin, smallestWidth, device)),
          })
        );
      })
    );

    target.get(
      '/subjects',
      asyncHandler(async (req: Request, res: Response) => {
        const owner = req.opdsOwner!;
        const { feedBase } = feedContext(req);
        const subjects = await bookStore.getSubjects(owner);
        const now = new Date().toISOString();
        res.set('Content-Type', 'application/atom+xml;charset=utf-8');
        res.send(
          navigationFeed({
            id: 'urn:bookplate:subjects',
            title: 'By Subject',
            selfHref: `${feedBase}/subjects`,
            startHref: `${feedBase}/`,
            now,
            entries: subjects.map((subject) =>
              navEntry(`urn:bookplate:subject:${subject}`, subject, `Books tagged with ${subject}`, `${feedBase}/subjects/${encodeURIComponent(subject)}`, 'acquisition', now)
            ),
          })
        );
      })
    );

    target.get(
      '/subjects/:subject',
      asyncHandler(async (req: Request, res: Response) => {
        const owner = req.opdsOwner!;
        const { origin, device, feedBase } = feedContext(req);
        const subject = req.params.subject;
        const books = await bookStore.listBooksBySubject(owner, subject);
        const now = new Date().toISOString();
        res.set('Content-Type', 'application/atom+xml;charset=utf-8');
        res.send(
          acquisitionFeed({
            id: `urn:bookplate:subject:${subject}`,
            title: subject,
            selfHref: `${feedBase}/subjects/${encodeURIComponent(subject)}`,
            startHref: `${feedBase}/`,
            now,
            entries: books.map((b) => bookEntry(b, origin, smallestWidth, device)),
          })
        );
      })
    );

    target.get('/status', (req: Request, res: Response) => {
      const { feedBase } = feedContext(req);
      const now = new Date().toISOString();
      res.set('Content-Type', 'application/atom+xml;charset=utf-8');
      res.send(
        navigationFeed({
          id: 'urn:bookplate:status',
          title: 'By Reading Status',
          selfHref: `${feedBase}/status`,
          startHref: `${feedBase}/`,
          now,
          entries: [
            navEntry('urn:bookplate:status:not-started', 'Not Started', 'Books not yet started', `${feedBase}/status/not-started`, 'acquisition', now),
            navEntry('urn:bookplate:status:in-progress', 'In Progress', 'Books currently being read', `${feedBase}/status/in-progress`, 'acquisition', now),
            navEntry('urn:bookplate:status:completed', 'Completed', 'Books finished reading', `${feedBase}/status/completed`, 'acquisition', now),
          ],
        })
      );
    });

    target.get(
      '/status/:status',
      asyncHandler(async (req: Request, res: Response) => {
        const status = req.params.status;
        if (!VALID_STATUSES.has(status as 'not-started' | 'in-progress' | 'completed')) {
          res.status(400).send('Invalid status');
          return;
        }
        const owner = req.opdsOwner!;
        const { origin, device, feedBase } = feedContext(req);
        const books = await bookStore.listBooksByStatus(
          owner,
          status as 'not-started' | 'in-progress' | 'completed'
        );
        const now = new Date().toISOString();
        res.set('Content-Type', 'application/atom+xml;charset=utf-8');
        res.send(
          acquisitionFeed({
            id: `urn:bookplate:status:${status}`,
            title: status,
            selfHref: `${feedBase}/status/${status}`,
            startHref: `${feedBase}/`,
            now,
            entries: books.map((b) => bookEntry(b, origin, smallestWidth, device)),
          })
        );
      })
    );
  }

  // --- Download & cover routes (base catalog only) ---

  router.get(
    '/books/:id/download',
    auth,
    asyncHandler(async (req: Request, res: Response) => {
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
    })
  );

  router.get(
    '/books/:id/devices/:slug/download',
    auth,
    asyncHandler(async (req: Request, res: Response) => {
      const owner = req.opdsOwner!;
      if (!deviceStore || !editionStore) {
        res.status(404).send('Not found');
        return;
      }
      const book = await bookStore.getBookById(owner, req.params.id);
      if (!book) {
        log.warn(`Device download requested for unknown book ID: ${req.params.id}`);
        res.status(404).send('Not found');
        return;
      }
      const device = await deviceStore.getBySlug(req.params.slug);
      if (!device) {
        log.warn(`Device download requested for unknown device slug: ${req.params.slug}`);
        res.status(404).send('Not found');
        return;
      }
      const { path: filePath, filename } = await editionStore.getOrCreateEdition(
        owner,
        book,
        device,
        validationThreshold
      );
      log.info(`User "${owner.username}" downloaded "${filename}" for device "${device.slug}"`);
      res.set('Content-Type', 'application/epub+zip');
      res.set(
        'Content-Disposition',
        `attachment; filename*=UTF-8''${encodeURIComponent(filename)}`
      );
      res.sendFile(filePath);
    })
  );

  router.get(
    '/books/:id/cover',
    auth,
    asyncHandler(async (req: Request, res: Response) => {
      const owner = req.opdsOwner!;
      const { width } = req.query;
      const parsedWidth = typeof width === 'string' ? parseInt(width, 10) : NaN;

      let data: Buffer;
      let mime: string;

      if (!isNaN(parsedWidth) && parsedWidth > 0) {
        const thumbnail = await bookStore.getThumbnail(owner.userId, req.params.id, parsedWidth);
        if (thumbnail) {
          data = thumbnail.data;
          mime = thumbnail.mime;
        } else {
          log.warn(
            `Cover thumbnail width=${parsedWidth} not found for book ${req.params.id}, serving full-size`
          );
          const cover = await bookStore.getCover(owner.userId, req.params.id);
          if (!cover) {
            res.status(404).send('Not found');
            return;
          }
          data = cover.data;
          mime = cover.mime;
        }
      } else {
        const cover = await bookStore.getCover(owner.userId, req.params.id);
        if (!cover) {
          res.status(404).send('Not found');
          return;
        }
        data = cover.data;
        mime = cover.mime;
      }

      const etag = `"${createHash('md5').update(data).digest('hex')}"`;
      if (req.headers['if-none-match'] === etag) {
        res.status(304).end();
        return;
      }

      const versioned = typeof req.query.v === 'string' && req.query.v.length > 0;
      res.set('Content-Type', mime);
      res.set('ETag', etag);
      res.set(
        'Cache-Control',
        versioned ? 'private, max-age=31536000, immutable' : 'private, max-age=0, must-revalidate'
      );
      res.send(data);
    })
  );

  // --- Base catalog (browse/nav) ---
  const baseCatalog = Router();
  mountFeeds(baseCatalog);
  router.use('/', auth, baseCatalog);

  return router;
}
```

Note: the `resolveDevice` middleware and the `/opds/device/:slug` mount are added in Task 2. `RequestHandler` is imported now (unused until Task 2) — if the linter flags it as unused, temporarily drop it and re-add in Task 2; simplest is to keep it since Task 2 follows immediately.

- [ ] **Step 5: Run the full server suite + lint**

Run: `npm test -w app/server && npm run lint -w app/server`
Expected: PASS. The repurposed test passes; all other OPDS tests (root feed, authors, series, subjects, status, downloads, covers) pass unchanged because base `feedBase` resolves to `${origin}/opds` and `startHref` to `${origin}/opds/` — byte-identical to before, minus per-device links in book entries.

If `RequestHandler` triggers an unused-import lint error, remove it from the import line for now; Task 2 re-adds it.

- [ ] **Step 6: Commit**

```bash
git add app/server/routes/opds.ts app/server/routes/opds-templates.ts app/server/routes/opds.test.ts
git commit -m "refactor(opds): single-link book entries + device-aware feed handlers"
```

---

### Task 2: Mount the per-device catalog at `/opds/device/:slug`

Add the `req.opdsDevice` type, a `resolveDevice` middleware, and the second mount. `mountFeeds` already produces device-scoped URLs when `req.opdsDevice` is set, so this task is purely the wiring plus tests.

**Files:**
- Modify: `app/server/global.d.ts` (add `opdsDevice`)
- Modify: `app/server/routes/opds.ts` (add `resolveDevice`, mount `/device/:slug`)
- Test: `app/server/routes/opds.test.ts` (device catalog tests)

**Interfaces:**
- Consumes: `mountFeeds`, `feedContext` from Task 1; `DeviceStore.getBySlug(slug): Promise<Device | null>`.
- Produces: `req.opdsDevice?: Device`; route group `GET /opds/device/:slug/*` mirroring the base browse/nav feeds, browse-only.

- [ ] **Step 1: Write failing device-catalog tests**

Append to `app/server/routes/opds.test.ts` a new `describe` block. It builds an app with device + edition stores and seeds one book + one device:

```ts
describe('GET /opds/device/:slug (per-device catalog)', () => {
  async function deviceApp() {
    const deviceStore = new DeviceStore(prisma);
    const device = await deviceStore.create({
      name: 'Kindle',
      coverWidth: null,
      coverHeight: null,
      coverFit: 'contain',
      bwCover: false,
      simplify: true,
    });
    const editionStore = new EditionStore(fs.mkdtempSync(path.join(os.tmpdir(), 'ed-')), prisma, {
      buildEdition: async () => Buffer.from('EDITION'),
      assertValidEpub: async () => ({}) as never,
      partialMD5: () => 'edhash',
    });
    const a = express();
    a.use(
      '/opds',
      createOpdsRouter(
        bookStore,
        userStore,
        [60, 170],
        'Bookplate',
        deviceStore,
        editionStore,
        ValidationThreshold.ERROR
      )
    );
    return { app: a, device };
  }

  it('404s for an unknown device slug', async () => {
    const { app: a } = await deviceApp();
    const res = await request(a).get('/opds/device/nope/books').set(basicAuth('alice', 'secret'));
    expect(res.status).toBe(404);
  });

  it('root nav feed links to device-scoped sub-feeds', async () => {
    const { app: a } = await deviceApp();
    const res = await request(a).get('/opds/device/kindle/').set(basicAuth('alice', 'secret'));
    expect(res.status).toBe(200);
    expect(res.text).toContain('href="http://127.0.0.1/opds/device/kindle/books"'.replace('127.0.0.1', ''));
    expect(res.text).toContain('/opds/device/kindle/books');
    expect(res.text).toContain('/opds/device/kindle/authors');
    expect(res.text).toContain('/opds/device/kindle/series');
  });

  it('book feed carries exactly one acquisition link = the device edition', async () => {
    const { app: a } = await deviceApp();
    const bookId = 'devcat1';
    await bookStore.addBook(alice, bookId, stage(bookId), { ...FAKE_META, title: 'Cat Book' });
    const res = await request(a).get('/opds/device/kindle/books').set(basicAuth('alice', 'secret'));
    expect(res.status).toBe(200);
    expect(res.text).toContain(`/opds/books/${bookId}/devices/kindle/download`);
    expect(res.text).toContain('Download for Kindle');
    // The base (non-device) download link must NOT appear in a device feed.
    expect(res.text).not.toContain(`/opds/books/${bookId}/download"`);
    // Exactly one acquisition link on the entry.
    expect((res.text.match(/opds-spec\.org\/acquisition/g) || []).length).toBe(1);
  });

  it('device book feed cover links still point at the base catalog', async () => {
    const { app: a } = await deviceApp();
    await bookStore.addBook(alice, 'devcover', stage('devcover'), {
      ...FAKE_META,
      coverData: Buffer.from('cover'),
      coverMime: 'image/jpeg',
    });
    const res = await request(a).get('/opds/device/kindle/books').set(basicAuth('alice', 'secret'));
    expect(res.text).toContain('/opds/books/devcover/cover');
    expect(res.text).not.toContain('/opds/device/kindle/books/devcover/cover');
  });

  it('requires authentication', async () => {
    const { app: a } = await deviceApp();
    const res = await request(a).get('/opds/device/kindle/books');
    expect(res.status).toBe(401);
  });
});
```

Note on the root-nav assertion: keep only the substring checks (`/opds/device/kindle/books` etc.); delete the first brittle `.replace(...)` line — it is shown only to make the intent explicit. Final block should assert the three `/opds/device/kindle/...` substrings.

- [ ] **Step 2: Run to verify failure**

Run: `cd app/server && npx jest routes/opds.test.ts -t "per-device catalog"`
Expected: FAIL — `/opds/device/kindle/...` currently 404s (no mount yet).

- [ ] **Step 3: Add `opdsDevice` to the Express request type**

Edit `app/server/global.d.ts`:

```ts
declare global {
  namespace Express {
    interface Request {
      kosyncUser?: string;
      kosyncUserId?: string;
      user?: import('./services/jwt').AuthUser;
      opdsOwner?: { userId: string; username: string };
      opdsDevice?: import('./types').Device;
    }
  }
}

export {};
```

- [ ] **Step 4: Add `resolveDevice` and mount the device catalog in `opds.ts`**

In `app/server/routes/opds.ts`, add this module-level helper just below `const VALID_STATUSES = ...`:

```ts
/** Resolves the `:slug` mount param to a Device, 404ing if it does not exist. */
function resolveDevice(deviceStore: DeviceStore): RequestHandler {
  return asyncHandler(async (req, res, next) => {
    const device = await deviceStore.getBySlug(req.params.slug);
    if (!device) {
      log.warn(`Device catalog requested for unknown slug: ${req.params.slug}`);
      res.status(404).send('Not found');
      return;
    }
    req.opdsDevice = device;
    next();
  });
}
```

Then, immediately BEFORE the `// --- Base catalog (browse/nav) ---` block, insert the device mount:

```ts
  // --- Device-scoped catalog (browse-only): auth first, then resolve the slug ---
  if (deviceStore && editionStore) {
    const deviceCatalog = Router({ mergeParams: true });
    deviceCatalog.use(auth, resolveDevice(deviceStore));
    mountFeeds(deviceCatalog);
    router.use('/device/:slug', deviceCatalog);
  }
```

`RequestHandler` is already imported (Task 1). Registration order in the returned router: download/cover routes, then this device mount, then the base catalog catch-all — so `/opds/device/...` is matched by the device mount before falling through to base.

- [ ] **Step 5: Run device tests + full suite + lint**

Run: `npm test -w app/server && npm run lint -w app/server`
Expected: PASS — device catalog tests green; all Task 1 tests still green.

- [ ] **Step 6: Commit**

```bash
git add app/server/global.d.ts app/server/routes/opds.ts app/server/routes/opds.test.ts
git commit -m "feat(opds): per-device catalog under /opds/device/:slug"
```

---

### Task 3: Surface each device's OPDS URL in the admin UI

Show `${origin}/opds/device/${slug}` on each device card with a copy button, so users can paste it into Crosspoint.

**Files:**
- Modify: `app/client/src/component/device-list/index.tsx` (render URL + copy button in `DeviceRow`)
- Modify: `app/client/src/component/device-list/style.ts` (styles for the URL row)
- Test: `app/client/src/component/device-list/index.test.tsx` (create if absent)

**Interfaces:**
- Consumes: `Device` from `~/provider/device` (has `slug: string`, `name: string`); `useDeviceList` hook; `Button`, `CheckIcon` (as used in `connection-urls`).
- Produces: a visible `${window.location.origin}/opds/device/${device.slug}` string per device with a Copy button.

- [ ] **Step 1: Write a failing render test**

Create `app/client/src/component/device-list/index.test.tsx`. Mirror the render/provider setup used in `app/client/src/provider/device/hook/use-create-device.test.tsx` (imports, providers, and `useDeviceList` mocking). The assertion:

```tsx
import { render, screen } from '@testing-library/react';
import { DeviceList } from './index';

// Mock the device provider hooks so DeviceList renders one device.
vi.mock('~/provider/device', async (importOriginal) => {
  const actual = await importOriginal<typeof import('~/provider/device')>();
  return {
    ...actual,
    useDeviceList: () => [
      [
        {
          id: 'd1',
          name: 'Kindle',
          slug: 'kindle',
          coverWidth: null,
          coverHeight: null,
          coverFit: 'contain',
          bwCover: false,
          simplify: true,
        },
      ],
      false,
    ],
    useDeleteDevice: () => [vi.fn(), false],
  };
});

describe('DeviceList', () => {
  it('shows the per-device OPDS catalog URL', () => {
    render(<DeviceList />);
    expect(screen.getByText(/\/opds\/device\/kindle$/)).toBeInTheDocument();
  });
});
```

If the existing hook tests wrap components in a theme/provider (`renderWithProviders` or similar), reuse that wrapper here rather than a bare `render`. Match the project's established test-util import.

- [ ] **Step 2: Run to verify failure**

Run: `cd app/client && npx vitest run src/component/device-list/index.test.tsx`
Expected: FAIL — the URL is not rendered yet (or the matcher finds nothing).

- [ ] **Step 3: Render the copyable URL in `DeviceRow`**

In `app/client/src/component/device-list/index.tsx`:

Add imports at the top (extend the existing `~/control` and `~/icon` imports):

```tsx
import { useCallback, useState, Fragment } from 'react';
```
(keep existing imports; add `CheckIcon` to the `~/icon` import and ensure `Button` is imported from `~/control` — it already is.)

Update the `~/icon` import line to include `CheckIcon`:

```tsx
import { AlertOctagonIcon, CheckIcon } from '~/icon';
```

Inside `DeviceRow`, after the existing `useState`/handlers and before `if (editing)`, add the OPDS URL + copy state:

```tsx
  const opdsUrl = `${window.location.origin}/opds/device/${device.slug}`;
  const [copied, setCopied] = useState(false);
  const handleCopy = useCallback(async () => {
    await navigator.clipboard.writeText(opdsUrl);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  }, [opdsUrl]);
```

Then, inside the `<Card>` (below the `<MetadataList>`), add the URL row:

```tsx
        <div className={styles.opdsRow}>
          <span className={styles.opdsUrl}>{opdsUrl}</span>
          <Button
            type="default"
            success={copied}
            prefix={copied ? CheckIcon : undefined}
            onClick={handleCopy}
            radius="card"
          >
            {copied ? 'Copied!' : 'Copy'}
          </Button>
        </div>
```

- [ ] **Step 4: Add styles**

In `app/client/src/component/device-list/style.ts`, add `opdsRow` and `opdsUrl` to the returned style object (matching the `connection-urls` pill/url styling):

```ts
  opdsRow: {
    display: 'flex',
    alignItems: 'center',
    gap: theme.space.md,
    marginTop: theme.space.md,
  },
  opdsUrl: {
    flex: 1,
    minWidth: 0,
    overflow: 'hidden',
    textOverflow: 'ellipsis',
    whiteSpace: 'nowrap',
    fontFamily: theme.fontFamily.mono,
    color: theme.color.text.primary,
    fontSize: theme.fontSize.md,
    letterSpacing: '0.03em',
  },
```

Ensure the style factory signature exposes `theme` (it already does — the file uses `createUseStyles((theme: Theme) => ({ ... }))`). Confirm the existing `style.ts` keys (`rowActions`, `deviceName`, `undone`, `loading`, `root`) remain intact.

- [ ] **Step 5: Run the test + client lint**

Run: `cd app/client && npx vitest run src/component/device-list/index.test.tsx && npm run lint -w app/client`
Expected: PASS.

- [ ] **Step 6: Run the full client suite**

Run: `npm test -w app/client`
Expected: PASS (no regressions in other device-list/provider tests).

- [ ] **Step 7: Commit**

```bash
git add app/client/src/component/device-list/index.tsx app/client/src/component/device-list/style.ts app/client/src/component/device-list/index.test.tsx
git commit -m "feat(devices): show per-device OPDS catalog URL with copy button"
```

---

## Self-Review

**Spec coverage:**
- Feed factory mounted twice → Task 1 (`mountFeeds` + base mount) + Task 2 (device mount). ✓
- URL prefix `/opds/device/:slug` → Task 2. ✓
- Downloads not duplicated (device feed links to existing base download endpoint) → Task 1 `bookEntry` device href + Task 2 keeps download routes base-only. ✓
- `bookEntry` single-link both modes; base feed drops per-device links → Task 1. ✓
- Full nav mirroring (authors/series/subjects/status) → falls out of `mountFeeds` reuse; asserted for books/authors/series in Task 2 tests. ✓
- Client surfaces per-device URL → Task 3. ✓
- Error handling: unknown slug → 404 (Task 2 `resolveDevice` + test); stores absent → device mount not registered (Task 2 `if (deviceStore && editionStore)`). ✓
- Lazy editions: feeds only emit links; `getOrCreateEdition` still only called by the download route. ✓
- Testing: device nav prefixes, single acquisition link, base single-link, unknown slug 404, cover links base-scoped → Tasks 1–2. ✓

**Placeholder scan:** No TBD/TODO; all steps carry concrete code and commands. The one soft spot — the client test-util wrapper — is handled by instructing the implementer to reuse the project's existing render wrapper (as used in the device provider hook tests) rather than inventing one.

**Type consistency:** `bookEntry(b, baseUrl, width, device?)` defined in Task 1, called with `(b, origin, smallestWidth, device)` in every handler. `FeedParams.startHref` defined Task 1, passed by every feed call. `req.opdsDevice?: Device` declared Task 2, read via `feedContext` (Task 1) and written by `resolveDevice` (Task 2). `resolveDevice: (DeviceStore) => RequestHandler` matches the `RequestHandler` import. Client `Device.slug` confirmed present in `~/provider/device` type. ✓
