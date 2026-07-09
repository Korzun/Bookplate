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

/** Resolves the `:slug` mount param to a Device, 404ing if it does not exist. */
function resolveDevice(deviceStore: DeviceStore): RequestHandler {
  return asyncHandler(async (req, res, next) => {
    const device = await deviceStore.getBySlug(req.params.slug);
    if (!device) {
      log.warn(`Device catalog requested for unknown slug: ${JSON.stringify(req.params.slug)}`);
      res.status(404).send('Not found');
      return;
    }
    req.opdsDevice = device;
    next();
  });
}

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
            navEntry(
              'urn:bookplate:books',
              'By Book Title',
              'Browse all books in the library',
              `${feedBase}/books`,
              'acquisition',
              now
            ),
            navEntry(
              'urn:bookplate:authors',
              'By Author',
              'Browse books by author',
              `${feedBase}/authors`,
              'navigation',
              now
            ),
            navEntry(
              'urn:bookplate:series',
              'By Series',
              'Browse books by series',
              `${feedBase}/series`,
              'navigation',
              now
            ),
            navEntry(
              'urn:bookplate:subjects',
              'By Subject',
              'Browse books by subject',
              `${feedBase}/subjects`,
              'navigation',
              now
            ),
            navEntry(
              'urn:bookplate:status',
              'By Status',
              'Browse books by reading status',
              `${feedBase}/status`,
              'navigation',
              now
            ),
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
              navEntry(
                `urn:bookplate:author:${author}`,
                author,
                `Books by ${author}`,
                `${feedBase}/authors/${encodeURIComponent(author)}`,
                'acquisition',
                now
              )
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
              navEntry(
                `urn:bookplate:series:${s.id}`,
                s.name,
                `${s.bookCount} book${s.bookCount === 1 ? '' : 's'}`,
                `${feedBase}/series/${s.id}`,
                'acquisition',
                now
              )
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
              navEntry(
                `urn:bookplate:subject:${subject}`,
                subject,
                `Books tagged with ${subject}`,
                `${feedBase}/subjects/${encodeURIComponent(subject)}`,
                'acquisition',
                now
              )
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
            navEntry(
              'urn:bookplate:status:not-started',
              'Not Started',
              'Books not yet started',
              `${feedBase}/status/not-started`,
              'acquisition',
              now
            ),
            navEntry(
              'urn:bookplate:status:in-progress',
              'In Progress',
              'Books currently being read',
              `${feedBase}/status/in-progress`,
              'acquisition',
              now
            ),
            navEntry(
              'urn:bookplate:status:completed',
              'Completed',
              'Books finished reading',
              `${feedBase}/status/completed`,
              'acquisition',
              now
            ),
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

      // The feed appends a `v` token (the book's mtime) to cover hrefs, so a versioned URL
      // changes whenever the cover does and can be cached immutably; bare requests fall back
      // to revalidate-every-time.
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

  // --- Device-scoped catalog (browse-only): auth first, then resolve the slug ---
  if (deviceStore && editionStore) {
    const deviceCatalog = Router({ mergeParams: true });
    deviceCatalog.use(auth, resolveDevice(deviceStore));
    mountFeeds(deviceCatalog);
    router.use('/device/:slug', deviceCatalog);
  }

  // --- Base catalog (browse/nav) ---
  const baseCatalog = Router();
  mountFeeds(baseCatalog);
  router.use('/', auth, baseCatalog);

  return router;
}
