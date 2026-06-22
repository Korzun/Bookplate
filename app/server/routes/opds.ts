import { createHash } from 'crypto';
import { Router, Request, Response } from 'express';
import { BookStore } from '../services/book-store';
import { UserStore } from '../services/user-store';
import { opdsAuth } from '../middleware/auth';
import { logger } from '../logger';
import { navigationFeed, acquisitionFeed, navEntry, bookEntry } from './opds-templates';

const log = logger('OPDS');

export function createOpdsRouter(
  bookStore: BookStore,
  userStore: UserStore,
  thumbnailWidths: number[],
  libraryName: string = 'HASS-ODPS'
): Router {
  const router = Router();
  const auth = opdsAuth(userStore, libraryName);
  const smallestWidth = thumbnailWidths.length > 0 ? Math.min(...thumbnailWidths) : null;

  router.get('/', auth, (req: Request, res: Response) => {
    log.debug('Root catalog served');
    const baseUrl = `${req.protocol}://${req.get('host')}`;
    const now = new Date().toISOString();
    res.set('Content-Type', 'application/atom+xml;charset=utf-8');
    res.send(
      navigationFeed({
        id: 'urn:hass-odps:root',
        title: /library$/i.test(libraryName) ? libraryName : `${libraryName} Library`,
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
  });

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
    const author = req.params.author;
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

  router.get('/series', auth, async (req: Request, res: Response) => {
    const owner = req.opdsOwner!;
    const seriesList = await bookStore.listSeries(owner);
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
        entries: seriesList.map((s) =>
          navEntry(
            `urn:hass-odps:series:${s.id}`,
            s.name,
            `${s.bookCount} book${s.bookCount === 1 ? '' : 's'}`,
            `${baseUrl}/opds/series/${s.id}`,
            'acquisition',
            now
          )
        ),
      })
    );
  });

  router.get('/series/:seriesId', auth, async (req: Request, res: Response) => {
    const owner = req.opdsOwner!;
    const seriesId = req.params.seriesId;
    const books = await bookStore.listBooksBySeries(owner, seriesId);
    const baseUrl = `${req.protocol}://${req.get('host')}`;
    const now = new Date().toISOString();
    res.set('Content-Type', 'application/atom+xml;charset=utf-8');
    res.send(
      acquisitionFeed({
        id: `urn:hass-odps:series:${seriesId}`,
        title: books.length > 0 ? books[0].series : 'Series',
        selfHref: `${baseUrl}/opds/series/${seriesId}`,
        baseUrl,
        now,
        entries: books.map((b) => bookEntry(b, baseUrl, smallestWidth)),
      })
    );
  });

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
    const subject = req.params.subject;
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

  router.get('/status', auth, (req: Request, res: Response) => {
    const baseUrl = `${req.protocol}://${req.get('host')}`;
    const now = new Date().toISOString();
    res.set('Content-Type', 'application/atom+xml;charset=utf-8');
    res.send(
      navigationFeed({
        id: 'urn:hass-odps:status',
        title: 'By Reading Status',
        selfHref: `${baseUrl}/opds/status`,
        baseUrl,
        now,
        entries: [
          navEntry(
            'urn:hass-odps:status:not-started',
            'Not Started',
            'Books not yet started',
            `${baseUrl}/opds/status/not-started`,
            'acquisition',
            now
          ),
          navEntry(
            'urn:hass-odps:status:in-progress',
            'In Progress',
            'Books currently being read',
            `${baseUrl}/opds/status/in-progress`,
            'acquisition',
            now
          ),
          navEntry(
            'urn:hass-odps:status:completed',
            'Completed',
            'Books finished reading',
            `${baseUrl}/opds/status/completed`,
            'acquisition',
            now
          ),
        ],
      })
    );
  });

  const VALID_STATUSES = new Set(['not-started', 'in-progress', 'completed'] as const);

  router.get('/status/:status', auth, async (req: Request, res: Response) => {
    const status = req.params.status;
    if (!VALID_STATUSES.has(status as 'not-started' | 'in-progress' | 'completed')) {
      res.status(400).send('Invalid status');
      return;
    }
    const owner = req.opdsOwner!;
    const books = await bookStore.listBooksByStatus(
      owner,
      status as 'not-started' | 'in-progress' | 'completed'
    );
    const baseUrl = `${req.protocol}://${req.get('host')}`;
    const now = new Date().toISOString();
    res.set('Content-Type', 'application/atom+xml;charset=utf-8');
    res.send(
      acquisitionFeed({
        id: `urn:hass-odps:status:${status}`,
        title: status,
        selfHref: `${baseUrl}/opds/status/${status}`,
        baseUrl,
        now,
        entries: books.map((b) => bookEntry(b, baseUrl, smallestWidth)),
      })
    );
  });

  return router;
}
