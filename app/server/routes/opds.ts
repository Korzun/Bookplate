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

  return router;
}
