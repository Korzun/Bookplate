// app/routes/opds.ts
import { Router, Request, Response } from 'express';
import { BookStore } from '../services/book-store';
import { UserStore } from '../services/user-store';
import { Book } from '../types';
import { opdsAuth } from '../middleware/auth';
import { logger } from '../logger';

const log = logger('OPDS');

function escapeXml(s: string): string {
  return s
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

function decodeBasicUser(authHeader: string): string {
  const decoded = Buffer.from(authHeader.slice(6), 'base64').toString();
  return decoded.slice(0, decoded.indexOf(':'));
}

function rootFeed(baseUrl: string): string {
  const now = new Date().toISOString();
  return `<?xml version="1.0" encoding="UTF-8"?>
<feed xmlns="http://www.w3.org/2005/Atom" xmlns:opds="http://opds-spec.org/2010/catalog">
  <id>urn:hass-odps:root</id>
  <title>HASS-ODPS Library</title>
  <updated>${now}</updated>
  <link rel="self" href="${baseUrl}/opds/" type="application/atom+xml;profile=opds-catalog;kind=navigation"/>
  <link rel="start" href="${baseUrl}/opds/" type="application/atom+xml;profile=opds-catalog;kind=navigation"/>
  <entry>
    <title>All Books</title>
    <id>urn:hass-odps:books</id>
    <updated>${now}</updated>
    <content type="text">Browse all books in the library</content>
    <link rel="subsection" href="${baseUrl}/opds/books" type="application/atom+xml;profile=opds-catalog;kind=acquisition"/>
  </entry>
</feed>`;
}

function booksFeed(books: Book[], baseUrl: string, thumbnailWidths: number[]): string {
  const now = new Date().toISOString();
  const smallestWidth = thumbnailWidths.length > 0 ? Math.min(...thumbnailWidths) : null;
  const entries = books
    .map((b) => {
      const coverLink = b.hasCover
        ? `    <link rel="http://opds-spec.org/image"\n          href="${baseUrl}/opds/books/${b.id}/cover"\n          type="image/jpeg"/>`
        : '';
      const thumbnailLink =
        b.hasCover && smallestWidth !== null
          ? `    <link rel="http://opds-spec.org/image/thumbnail"\n          href="${baseUrl}/opds/books/${b.id}/cover?width=${smallestWidth}"\n          type="image/jpeg"/>`
          : '';
      return `  <entry>
    <title>${escapeXml(b.title)}</title>
    <id>urn:hass-odps:book:${b.id}</id>
    <updated>${b.mtime.toISOString()}</updated>
    <author><name>${escapeXml(b.author)}</name></author>
    <summary>${escapeXml(b.description)}</summary>
    <link rel="http://opds-spec.org/acquisition"
          href="${baseUrl}/opds/books/${b.id}/download"
          type="application/epub+zip"
          title="${escapeXml(b.filename)}"/>
${coverLink}
${thumbnailLink}
  </entry>`;
    })
    .join('\n');

  return `<?xml version="1.0" encoding="UTF-8"?>
<feed xmlns="http://www.w3.org/2005/Atom" xmlns:opds="http://opds-spec.org/2010/catalog">
  <id>urn:hass-odps:books</id>
  <title>All Books</title>
  <updated>${now}</updated>
  <link rel="self" href="${baseUrl}/opds/books" type="application/atom+xml;profile=opds-catalog;kind=acquisition"/>
  <link rel="start" href="${baseUrl}/opds/" type="application/atom+xml;profile=opds-catalog;kind=navigation"/>
${entries}
</feed>`;
}

export function createOpdsRouter(
  bookStore: BookStore,
  userStore: UserStore,
  thumbnailWidths: number[]
): Router {
  const router = Router();
  const auth = opdsAuth(userStore);

  router.get('/', auth, (req: Request, res: Response) => {
    log.debug('Root catalog served');
    const baseUrl = `${req.protocol}://${req.get('host')}`;
    res.set('Content-Type', 'application/atom+xml;charset=utf-8');
    res.send(rootFeed(baseUrl));
  });

  router.get('/books', auth, async (req: Request, res: Response) => {
    const books = await bookStore.listBooks();
    log.debug(`Books feed served (${books.length} books)`);
    const baseUrl = `${req.protocol}://${req.get('host')}`;
    res.set('Content-Type', 'application/atom+xml;charset=utf-8');
    res.send(booksFeed(books, baseUrl, thumbnailWidths));
  });

  router.get('/books/:id/download', auth, async (req: Request, res: Response) => {
    const book = await bookStore.getBookById(req.params.id);
    if (!book) {
      log.warn(`Download requested for unknown book ID: ${req.params.id}`);
      res.status(404).send('Not found');
      return;
    }
    const username = decodeBasicUser(req.headers.authorization!);
    log.info(`User "${username}" downloaded "${book.filename}"`);
    res.set('Content-Type', 'application/epub+zip');
    res.set(
      'Content-Disposition',
      `attachment; filename*=UTF-8''${encodeURIComponent(book.filename)}`
    );
    res.sendFile(book.path);
  });

  router.get('/books/:id/cover', auth, async (req: Request, res: Response) => {
    const { width } = req.query;
    const parsedWidth = typeof width === 'string' ? parseInt(width, 10) : NaN;

    if (!isNaN(parsedWidth) && parsedWidth > 0) {
      const thumbnail = await bookStore.getThumbnail(req.params.id, parsedWidth);
      if (thumbnail) {
        res.set('Content-Type', thumbnail.mime);
        res.send(thumbnail.data);
        return;
      }
      log.warn(
        `Cover thumbnail width=${parsedWidth} not found for book ${req.params.id}, serving full-size`
      );
    }

    const cover = await bookStore.getCover(req.params.id);
    if (!cover) {
      res.status(404).send('Not found');
      return;
    }
    res.set('Content-Type', cover.mime);
    res.send(cover.data);
  });

  return router;
}
