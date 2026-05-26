import * as os from 'os';
import * as path from 'path';
import * as fs from 'fs';
import request from 'supertest';
import express from 'express';
import session from 'express-session';
import Database from 'better-sqlite3';
import AdmZip from 'adm-zip';
import { BookStore } from '../services/book-store';
import { UserStore } from '../services/user-store';
import { createUiRouter } from './ui';
import { AppConfig, EpubMeta } from '../types';

jest.mock('../logger');
import { ThumbnailQueue } from '../services/thumbnail-queue';

// The SPA routes call res.sendFile('client/dist/index.html'). Create a
// minimal placeholder before the suite runs so the file exists in CI.
const SPA_HTML_DIR = path.join(__dirname, '..', '..', '..', 'client', 'dist');
const SPA_HTML_PATH = path.join(SPA_HTML_DIR, 'index.html');

beforeAll(() => {
  fs.mkdirSync(SPA_HTML_DIR, { recursive: true });
  fs.writeFileSync(SPA_HTML_PATH, '<!DOCTYPE html><html><body><div id="root"></div></body></html>');
});

afterAll(() => {
  fs.rmSync(SPA_HTML_DIR, { recursive: true, force: true });
});

let booksDir: string;
let db: InstanceType<typeof Database>;
let bookStore: BookStore;
let userStore: UserStore;
let app: express.Express;

const config: AppConfig = {
  username: 'admin',
  password: 'pass',
  booksDir: '',
  dataDir: '/tmp',
  port: 3000,
  maxConcurrentUploads: 3,
  thumbnailWidths: [60, 170],
};

const mockThumbnailQueue = {
  enqueue: jest.fn(),
  reconcile: jest.fn(),
} as unknown as ThumbnailQueue;

const FAKE_META: EpubMeta = {
  title: 'Test Book',
  author: 'Test Author',
  description: '',
  publisher: '',
  series: '',
  seriesIndex: 0,
  fileAs: '',
  identifiers: [],
  subjects: [],
  coverData: null,
  coverMime: null,
  chapterCount: 0,
  chapterSpineMap: [],
  chapterNames: [],
  pageCount: 0,
};

function stage(id: string, content: string | Buffer = 'x'): string {
  const p = path.join(booksDir, `staged-${id}.epub`);
  fs.writeFileSync(p, content);
  return p;
}

// Helper: build a minimal EPUB zip as a Buffer
function makeEpub(
  opts: {
    title?: string;
    author?: string;
    description?: string;
    series?: string;
    seriesIndex?: number;
    coverData?: Buffer;
    coverMime?: string;
  } = {}
): Buffer {
  const zip = new AdmZip();

  const containerXml = `<?xml version="1.0"?>
<container version="1.0" xmlns="urn:oasis:names:tc:opendocument:xmlns:container">
  <rootfiles>
    <rootfile full-path="OEBPS/content.opf" media-type="application/oebps-package+xml"/>
  </rootfiles>
</container>`;
  zip.addFile('META-INF/container.xml', Buffer.from(containerXml));

  const coverItem = opts.coverData
    ? `<item id="cover-img" href="cover.jpg" media-type="${opts.coverMime ?? 'image/jpeg'}"/>`
    : '';
  const coverMeta = opts.coverData ? `<meta name="cover" content="cover-img"/>` : '';
  const seriesMeta = opts.series
    ? `<meta name="calibre:series" content="${opts.series}"/><meta name="calibre:series_index" content="${opts.seriesIndex ?? 1}"/>`
    : '';

  const opf = `<?xml version="1.0" encoding="UTF-8"?>
<package xmlns="http://www.idpf.org/2007/opf" version="2.0">
  <metadata xmlns:dc="http://purl.org/dc/elements/1.1/">
    ${opts.title !== undefined ? `<dc:title>${opts.title}</dc:title>` : ''}
    ${opts.author !== undefined ? `<dc:creator>${opts.author}</dc:creator>` : ''}
    ${opts.description !== undefined ? `<dc:description>${opts.description}</dc:description>` : ''}
    ${coverMeta}
    ${seriesMeta}
  </metadata>
  <manifest>
    <item id="ncx" href="toc.ncx" media-type="application/x-dtbncx+xml"/>
    ${coverItem}
  </manifest>
  <spine toc="ncx"/>
</package>`;
  zip.addFile('OEBPS/content.opf', Buffer.from(opf));

  if (opts.coverData) {
    zip.addFile('OEBPS/cover.jpg', opts.coverData);
  }

  return zip.toBuffer();
}

// Returns a supertest agent that has a valid session cookie
async function adminAgent() {
  const agent = request.agent(app);
  await agent
    .post('/api/login')
    .send('username=admin&password=pass')
    .set('Content-Type', 'application/x-www-form-urlencoded');
  return agent;
}

async function userAgent() {
  const agent = request.agent(app);
  await agent
    .post('/api/login')
    .send('username=alice&password=alicepass')
    .set('Content-Type', 'application/x-www-form-urlencoded');
  return agent;
}

beforeEach(() => {
  booksDir = fs.mkdtempSync(path.join(os.tmpdir(), 'hass-odps-ui-'));
  db = new Database(':memory:');
  bookStore = new BookStore(booksDir, db);
  userStore = new UserStore(db);
  userStore.createUser('alice', UserStore.hashPassword('alicepass'));

  app = express();
  app.use(express.json());
  app.use(express.urlencoded({ extended: false }));
  app.use(session({ secret: 'test-secret', resave: false, saveUninitialized: false }));
  app.use('/', createUiRouter(bookStore, userStore, { ...config, booksDir }, mockThumbnailQueue));
  (mockThumbnailQueue.enqueue as jest.Mock).mockClear();
  (mockThumbnailQueue.reconcile as jest.Mock).mockClear();
});

afterEach(() => {
  db.close();
  fs.rmSync(booksDir, { recursive: true });
});

describe('GET /', () => {
  it('redirects to /login without a session', async () => {
    const res = await request(app).get('/');
    expect(res.status).toBe(302);
    expect(res.headers.location).toBe('/login');
  });

  it('returns 200 with a valid session', async () => {
    const agent = await adminAgent();
    const res = await agent.get('/');
    expect(res.status).toBe(200);
  });
});

describe('POST /api/login', () => {
  it('returns 200 on correct admin credentials', async () => {
    const res = await request(app)
      .post('/api/login')
      .send('username=admin&password=pass')
      .set('Content-Type', 'application/x-www-form-urlencoded');
    expect(res.status).toBe(200);
  });

  it('returns 200 on correct regular user credentials', async () => {
    const res = await request(app)
      .post('/api/login')
      .send('username=alice&password=alicepass')
      .set('Content-Type', 'application/x-www-form-urlencoded');
    expect(res.status).toBe(200);
  });

  it('returns 401 on wrong password', async () => {
    const res = await request(app)
      .post('/api/login')
      .send('username=admin&password=wrong')
      .set('Content-Type', 'application/x-www-form-urlencoded');
    expect(res.status).toBe(401);
  });

  it('returns 401 for unknown user', async () => {
    const res = await request(app)
      .post('/api/login')
      .send('username=nobody&password=pass')
      .set('Content-Type', 'application/x-www-form-urlencoded');
    expect(res.status).toBe(401);
  });
});

describe('GET /api/me', () => {
  it('redirects to /login without session', async () => {
    const res = await request(app).get('/api/me');
    expect(res.status).toBe(302);
  });

  it('returns isAdmin true for admin session', async () => {
    const agent = await adminAgent();
    const res = await agent.get('/api/me');
    expect(res.status).toBe(200);
    expect(res.body).toEqual({ username: 'admin', isAdmin: true });
  });

  it('returns isAdmin false for regular user session', async () => {
    const agent = await userAgent();
    const res = await agent.get('/api/me');
    expect(res.status).toBe(200);
    expect(res.body).toEqual({ username: 'alice', isAdmin: false });
  });
});

describe('GET /api/books', () => {
  it('returns 302 without session', async () => {
    const res = await request(app).get('/api/books');
    expect(res.status).toBe(302);
  });

  it('returns JSON array of books', async () => {
    bookStore.addBook('book1', stage('book1'), {
      ...FAKE_META,
      title: 'book',
    });
    const agent = await adminAgent();
    const res = await agent.get('/api/books');
    expect(res.status).toBe(200);
    expect(Array.isArray(res.body)).toBe(true);
    expect(res.body[0].filename).toBe('Test_Author-book.epub');
  });

  it('returns enriched book data with author, series, hasCover', async () => {
    const meta: EpubMeta = {
      ...FAKE_META,
      title: 'Enriched Book',
      author: 'Jane Doe',
      series: 'MySeries',
      seriesIndex: 2,
      coverData: null,
      coverMime: null,
    };
    bookStore.addBook('enriched1', stage('enriched1'), meta);
    const agent = await adminAgent();
    const res = await agent.get('/api/books');
    expect(res.status).toBe(200);
    const book = res.body[0];
    expect(book.author).toBe('Jane Doe');
    expect(book.series).toBe('MySeries');
    expect(book.seriesIndex).toBe(2);
    expect(book.hasCover).toBe(false);
    expect(book.path).toBeUndefined();
    expect(book.description).toBeUndefined();
  });

  it('returns fileAs in the books API response', async () => {
    const meta: EpubMeta = {
      ...FAKE_META,
      title: 'Foundation',
      fileAs: 'Asimov, Isaac',
      author: 'Isaac Asimov',
    };

    bookStore.addBook('foundation1', stage('foundation1'), meta);

    const agent = await adminAgent();
    const res = await agent.get('/api/books');

    expect(res.status).toBe(200);
    expect(Array.isArray(res.body)).toBe(true);
    expect(res.body).toHaveLength(1);
    const [book] = res.body;
    expect(book.fileAs).toBe('Asimov, Isaac');
    expect(book.path).toBeUndefined();
    expect(book.description).toBeUndefined();
  });

  it('includes chapterCount in the book list response', async () => {
    bookStore.addBook('id-ch', stage('id-ch'), {
      ...FAKE_META,
      chapterCount: 7,
      chapterSpineMap: [1, 2, 3, 4, 5, 6, 7],
    });
    const agent = await adminAgent();
    const res = await agent.get('/api/books');
    expect(res.status).toBe(200);
    expect(res.body[0].chapterCount).toBe(7);
    expect(res.body[0].chapterSpineMap).toBeUndefined();
  });
});

describe('POST /api/books/upload', () => {
  it('rejects .pdf files with 400 and "Supported: epub"', async () => {
    const agent = await adminAgent();
    const res = await agent
      .post('/api/books/upload')
      .attach('files', Buffer.from('pdf-content'), 'notes.pdf');
    expect(res.status).toBe(400);
    expect(res.body.error).toMatch(/Supported: epub/);
  });

  it('rejects .mobi files with 400 and "Supported: epub"', async () => {
    const agent = await adminAgent();
    const res = await agent
      .post('/api/books/upload')
      .attach('files', Buffer.from('mobi-content'), 'book.mobi');
    expect(res.status).toBe(400);
    expect(res.body.error).toMatch(/Supported: epub/);
  });

  it('rejects unsupported file types', async () => {
    const agent = await adminAgent();
    const res = await agent
      .post('/api/books/upload')
      .attach('files', Buffer.from('text'), 'notes.txt');
    expect(res.status).toBe(400);
  });

  it('rejects invalid EPUB content with 400', async () => {
    const agent = await adminAgent();
    const res = await agent
      .post('/api/books/upload')
      .attach('files', Buffer.from('not-an-epub'), 'bad.epub');
    expect(res.status).toBe(400);
    expect(res.body.error).toMatch(/Failed to parse EPUB/);
  });

  it('accepts a valid .epub, parses metadata, and stores it', async () => {
    const epubBuf = makeEpub({
      title: 'Parsed Title',
      author: 'Parsed Author',
      series: 'Parsed Series',
      seriesIndex: 3,
    });
    const agent = await adminAgent();
    const res = await agent.post('/api/books/upload').attach('files', epubBuf, 'parsed.epub');
    expect(res.status).toBe(200);
    expect(res.body.uploaded).toContain('parsed.epub');

    // Verify metadata was stored and file is on disk at canonical path
    const books = bookStore.listBooks();
    expect(fs.existsSync(books[0].path)).toBe(true);
    expect(books).toHaveLength(1);
    expect(books[0].title).toBe('Parsed Title');
    expect(books[0].author).toBe('Parsed Author');
    expect(books[0].series).toBe('Parsed Series');
    expect(books[0].seriesIndex).toBe(3);
  });

  it('accepts a valid .epub with cover', async () => {
    const coverBuf = Buffer.from('fake-jpeg-data');
    const epubBuf = makeEpub({
      title: 'Cover Book',
      author: 'Cover Author',
      coverData: coverBuf,
      coverMime: 'image/jpeg',
    });
    const agent = await adminAgent();
    const res = await agent.post('/api/books/upload').attach('files', epubBuf, 'cover.epub');
    expect(res.status).toBe(200);

    const books = bookStore.listBooks();
    expect(books[0].hasCover).toBe(true);
  });

  it('enqueues thumbnails after a successful upload', async () => {
    const epubBuf = makeEpub({ title: 'Queued Book' });
    const agent = await adminAgent();
    await agent.post('/api/books/upload').attach('files', epubBuf, 'queued.epub');
    expect(mockThumbnailQueue.enqueue).toHaveBeenCalledTimes(1);
  });

  it('places uploaded file at <booksDir>/<id>.epub', async () => {
    const agent = await adminAgent();
    const epubBuf = makeEpub({ title: 'Stored Book', author: 'A' });
    const res = await agent.post('/api/books/upload').attach('files', epubBuf, 'human-name.epub');
    expect(res.status).toBe(200);
    const books = bookStore.listBooks();
    expect(books).toHaveLength(1);
    const onDisk = fs
      .readdirSync(booksDir)
      .filter((f) => f.endsWith('.epub') && !f.startsWith('staged-'));
    expect(onDisk).toEqual([books[0].id + '.epub']);
  });

  it('returns 409 when uploading a duplicate (same content twice)', async () => {
    const agent = await adminAgent();
    const epubBuf = makeEpub({ title: 'Dup', author: 'A' });
    await agent.post('/api/books/upload').attach('files', epubBuf, 'first.epub');
    const res = await agent.post('/api/books/upload').attach('files', epubBuf, 'second.epub');
    expect(res.status).toBe(409);
    expect(res.body.error).toMatch(/already in the library/i);
  });

  it('falls back to original-filename stem when title metadata is empty', async () => {
    const agent = await adminAgent();
    const epubBuf = makeEpub({ author: 'A' }); // no title
    await agent.post('/api/books/upload').attach('files', epubBuf, 'my-book.epub');
    const books = bookStore.listBooks();
    expect(books).toHaveLength(1);
    expect(books[0].title).toBe('my-book');
  });

  it('cleans up staging directory after successful upload', async () => {
    const agent = await adminAgent();
    const epubBuf = makeEpub({ title: 'Clean', author: 'A' });
    await agent.post('/api/books/upload').attach('files', epubBuf, 'clean.epub');
    const stagingDir = path.join(booksDir, '.staging');
    const staged = fs.existsSync(stagingDir) ? fs.readdirSync(stagingDir) : [];
    expect(staged).toEqual([]);
  });
});

describe('GET /api/books/:id', () => {
  it('returns full book data including description, publisher, identifiers, subjects', async () => {
    const agent = await adminAgent();
    const meta: EpubMeta = {
      ...FAKE_META,
      title: 'Detail Book',
      description: 'A detailed description.',
      publisher: 'Test Publisher',
      identifiers: [{ scheme: 'ISBN', value: '978-1234567890' }],
      subjects: ['Fiction', 'Mystery'],
    };
    bookStore.addBook('detailid1', stage('detailid1'), meta);

    const res = await agent.get('/api/books/detailid1');
    expect(res.status).toBe(200);
    expect(res.body.id).toBe('detailid1');
    expect(res.body.title).toBe('Detail Book');
    expect(res.body.description).toBe('A detailed description.');
    expect(res.body.publisher).toBe('Test Publisher');
    expect(res.body.identifiers).toEqual([{ scheme: 'ISBN', value: '978-1234567890' }]);
    expect(res.body.subjects).toEqual(['Fiction', 'Mystery']);
    // path must NOT be exposed
    expect(res.body.path).toBeUndefined();
  });

  it('returns 404 for unknown book ID', async () => {
    const agent = await adminAgent();
    const res = await agent.get('/api/books/doesnotexist');
    expect(res.status).toBe(404);
  });

  it('requires authentication', async () => {
    const res = await request(app).get('/api/books/anyid');
    expect(res.status).toBe(302);
  });

  it('includes chapterCount, chapterSpineMap, and chapterNames', async () => {
    bookStore.addBook('bk1', stage('bk1'), {
      ...FAKE_META,
      chapterCount: 5,
      chapterSpineMap: [1, 2, 3, 4, 5],
      chapterNames: ['Prologue', 'Ch 1', 'Ch 2', 'Ch 3', 'Ch 4'],
    });
    const agent = await adminAgent();
    const res = await agent.get('/api/books/bk1');
    expect(res.status).toBe(200);
    expect(res.body.chapterCount).toBe(5);
    expect(res.body.chapterSpineMap).toEqual([1, 2, 3, 4, 5]);
    expect(res.body.chapterNames).toEqual(['Prologue', 'Ch 1', 'Ch 2', 'Ch 3', 'Ch 4']);
    // path must still NOT be exposed
    expect(res.body.path).toBeUndefined();
  });
});

describe('GET /api/books/:id/cover', () => {
  it('returns 200 with cover image for a book with cover', async () => {
    const coverBuf = Buffer.from('fake-jpeg-bytes');
    const meta: EpubMeta = {
      ...FAKE_META,
      coverData: coverBuf,
      coverMime: 'image/jpeg',
    };
    bookStore.addBook('coverId1', stage('coverId1'), meta);

    const agent = await adminAgent();
    const res = await agent.get('/api/books/coverId1/cover');
    expect(res.status).toBe(200);
    expect(res.headers['content-type']).toMatch(/image\/jpeg/);
    expect(Buffer.from(res.body).toString()).toBe('fake-jpeg-bytes');
  });

  it('returns 404 for a book without cover', async () => {
    bookStore.addBook('noCoverId', stage('noCoverId'), FAKE_META);

    const agent = await adminAgent();
    const res = await agent.get('/api/books/noCoverId/cover');
    expect(res.status).toBe(404);
  });

  it('returns 404 for an unknown book id', async () => {
    const agent = await adminAgent();
    const res = await agent.get('/api/books/unknownId/cover');
    expect(res.status).toBe(404);
  });

  it('returns thumbnail when ?width= matches a stored thumbnail', async () => {
    const coverBuf = Buffer.from('original-cover');
    const thumbBuf = Buffer.from('thumbnail-data');
    bookStore.addBook('thumbBook', stage('thumbBook'), {
      ...FAKE_META,
      coverData: coverBuf,
      coverMime: 'image/jpeg',
    });
    bookStore.saveThumbnail('thumbBook', 150, thumbBuf, 'image/jpeg');

    const agent = await adminAgent();
    const res = await agent.get('/api/books/thumbBook/cover?width=150');
    expect(res.status).toBe(200);
    expect(Buffer.from(res.body).toString()).toBe('thumbnail-data');
  });

  it('falls back to full-size when ?width= has no matching thumbnail', async () => {
    const coverBuf = Buffer.from('full-size-cover');
    bookStore.addBook('fbBook', stage('fbBook'), {
      ...FAKE_META,
      coverData: coverBuf,
      coverMime: 'image/jpeg',
    });

    const agent = await adminAgent();
    const res = await agent.get('/api/books/fbBook/cover?width=150');
    expect(res.status).toBe(200);
    expect(Buffer.from(res.body).toString()).toBe('full-size-cover');
  });
});

describe('DELETE /api/books/:id', () => {
  it('deletes a book and returns 204', async () => {
    bookStore.addBook('book1', stage('book1'), FAKE_META);
    const [book] = bookStore.listBooks();

    const agent = await adminAgent();
    const res = await agent.delete(`/api/books/${book.id}`);
    expect(res.status).toBe(204);
    expect(fs.existsSync(path.join(booksDir, 'book1.epub'))).toBe(false);
  });

  it('returns 404 for unknown book id', async () => {
    const agent = await adminAgent();
    const res = await agent.delete('/api/books/deadbeefdeadbeef');
    expect(res.status).toBe(404);
  });
});

describe('POST /api/books/scan', () => {
  it('returns 302 without session', async () => {
    const res = await request(app).post('/api/books/scan');
    expect(res.status).toBe(302);
  });

  it('returns { imported: [], removed: [] } when nothing to scan', async () => {
    const agent = await adminAgent();
    const res = await agent.post('/api/books/scan');
    expect(res.status).toBe(200);
    expect(res.body).toEqual({ imported: [], removed: [] });
  });

  it('imports an epub file found on disk but not in DB', async () => {
    // Write a real EPUB to booksDir without going through the upload route
    const epubBuf = makeEpub({ title: 'Found Book', author: 'Found Author' });
    fs.writeFileSync(path.join(booksDir, 'found.epub'), epubBuf);

    const agent = await adminAgent();
    const res = await agent.post('/api/books/scan');
    expect(res.status).toBe(200);
    expect(res.body.imported).toContain('found.epub');
    expect(res.body.removed).toEqual([]);

    // Verify it's now in the library
    const listRes = await agent.get('/api/books');
    expect(listRes.body).toHaveLength(1);
    expect(listRes.body[0].title).toBe('Found Book');
  });

  it('reports removed for a DB entry whose file is gone', async () => {
    // Add a book to the DB then remove the file so the scan reports it removed
    bookStore.addBook('stale001', stage('stale001'), {
      ...FAKE_META,
      title: 'Stale Book',
    });
    fs.rmSync(path.join(booksDir, 'stale001.epub'));

    const agent = await adminAgent();
    const res = await agent.post('/api/books/scan');
    expect(res.status).toBe(200);
    expect(res.body.removed).toContain('stale001.epub');
    expect(res.body.imported).toEqual([]);
  });

  it('calls thumbnailQueue.reconcile after scan', async () => {
    const agent = await adminAgent();
    await agent.post('/api/books/scan');
    expect(mockThumbnailQueue.reconcile).toHaveBeenCalledTimes(1);
  });
});

describe('DELETE /api/books/:id (admin-only)', () => {
  beforeEach(() => {
    bookStore.addBook('b1', stage('b1'), FAKE_META);
  });

  it('returns 204 for admin', async () => {
    const agent = await adminAgent();
    const res = await agent.delete('/api/books/b1');
    expect(res.status).toBe(204);
  });

  it('returns 403 for regular user', async () => {
    const agent = await userAgent();
    const res = await agent.delete('/api/books/b1');
    expect(res.status).toBe(403);
  });
});

describe('POST /api/books/scan (admin-only)', () => {
  it('returns 200 for admin', async () => {
    const agent = await adminAgent();
    const res = await agent.post('/api/books/scan');
    expect(res.status).toBe(200);
  });

  it('returns 403 for regular user', async () => {
    const agent = await userAgent();
    const res = await agent.post('/api/books/scan');
    expect(res.status).toBe(403);
  });
});

describe('GET /api/my/progress', () => {
  it('redirects to /login without session', async () => {
    const res = await request(app).get('/api/my/progress');
    expect(res.status).toBe(302);
  });

  it('returns [] for admin', async () => {
    const agent = await adminAgent();
    const res = await agent.get('/api/my/progress');
    expect(res.status).toBe(200);
    expect(res.body).toEqual([]);
  });

  it('returns own progress records for regular user', async () => {
    userStore.saveProgress('alice', {
      document: 'doc1',
      progress: '/p[1]',
      percentage: 0.72,
      device: 'Kobo',
      device_id: 'd1',
    });
    const agent = await userAgent();
    const res = await agent.get('/api/my/progress');
    expect(res.status).toBe(200);
    expect(res.body).toHaveLength(1);
    expect(res.body[0].document).toBe('doc1');
    expect(res.body[0].percentage).toBeCloseTo(0.72);
  });

  it('does not expose device or progress fields', async () => {
    userStore.saveProgress('alice', {
      document: 'doc1',
      progress: '/p[1]',
      percentage: 0.5,
      device: 'Kobo',
      device_id: 'd1',
    });
    const agent = await userAgent();
    const res = await agent.get('/api/my/progress');
    expect(res.status).toBe(200);
    expect(res.body).toHaveLength(1);
    expect(res.body[0].device).toBeUndefined();
    expect(res.body[0].progress).toBeUndefined();
  });

  it("does not return another user's progress", async () => {
    userStore.createUser('bob', UserStore.hashPassword('bobpass'));
    userStore.saveProgress('bob', {
      document: 'doc2',
      progress: '/p[1]',
      percentage: 0.9,
      device: 'Kobo',
      device_id: 'd2',
    });
    const agent = await userAgent();
    const res = await agent.get('/api/my/progress');
    expect(res.status).toBe(200);
    expect(res.body).toHaveLength(0);
  });

  it('includes currentChapter when a matching book has chapter data and CFI is valid', async () => {
    // spine: cover(0) ch1(1) ch2(2) ch3(3); nav: ch1→1, ch2→2, ch3→3
    bookStore.addBook('doc-with-chapters', stage('doc-with-chapters'), {
      ...FAKE_META,
      chapterCount: 3,
      chapterSpineMap: [1, 2, 3],
    });
    // EPUB_CFI(/6/6...) → N=6 → spineIndex=(6-2)/2=2 → chapter 2 (ch2 is at spineIndex 2)
    userStore.saveProgress('alice', {
      document: 'doc-with-chapters',
      progress: 'EPUB_CFI(/6/6[ch2]!/4/1:0)',
      percentage: 0.5,
      device: 'Kobo',
      device_id: 'd1',
    });
    const agent = await userAgent();
    const res = await agent.get('/api/my/progress');
    expect(res.status).toBe(200);
    expect(res.body[0].currentChapter).toBe(2);
  });

  it('includes currentChapterName when the book has chapterNames and CFI resolves to a chapter', async () => {
    bookStore.addBook('doc-with-names', stage('doc-with-names'), {
      ...FAKE_META,
      chapterCount: 3,
      chapterSpineMap: [1, 2, 3],
      chapterNames: ['Chapter 1', 'Chapter 2', 'Chapter 3'],
    });
    // EPUB_CFI(/6/6...) → spineIndex=2 → chapter 2 → chapterNames[1] = 'Chapter 2'
    userStore.saveProgress('alice', {
      document: 'doc-with-names',
      progress: 'EPUB_CFI(/6/6[ch2]!/4/1:0)',
      percentage: 0.5,
      device: 'Kobo',
      device_id: 'd1',
    });
    const agent = await userAgent();
    const res = await agent.get('/api/my/progress');
    expect(res.status).toBe(200);
    expect(res.body[0].currentChapterName).toBe('Chapter 2');
  });

  it('omits currentChapterName when the book has no chapterNames', async () => {
    bookStore.addBook('doc-no-names', stage('doc-no-names'), {
      ...FAKE_META,
      chapterCount: 3,
      chapterSpineMap: [1, 2, 3],
      chapterNames: [],
    });
    // Same CFI as above — resolves to chapter 2, but chapterNames is empty
    userStore.saveProgress('alice', {
      document: 'doc-no-names',
      progress: 'EPUB_CFI(/6/6[ch2]!/4/1:0)',
      percentage: 0.5,
      device: 'Kobo',
      device_id: 'd1',
    });
    const agent = await userAgent();
    const res = await agent.get('/api/my/progress');
    expect(res.status).toBe(200);
    expect(res.body[0].currentChapterName).toBeUndefined();
  });

  it('omits currentChapter when the book is not in the DB', async () => {
    userStore.saveProgress('alice', {
      document: 'unknown-book-id',
      progress: 'EPUB_CFI(/6/4!/4/1:0)',
      percentage: 0.3,
      device: 'Kobo',
      device_id: 'd1',
    });
    const agent = await userAgent();
    const res = await agent.get('/api/my/progress');
    expect(res.status).toBe(200);
    expect(res.body[0].currentChapter).toBeUndefined();
  });

  it('omits currentChapter when the CFI is not in KoReader EPUB_CFI format', async () => {
    bookStore.addBook('doc-bad-cfi', stage('doc-bad-cfi'), {
      ...FAKE_META,
      chapterCount: 3,
      chapterSpineMap: [1, 2, 3],
    });
    userStore.saveProgress('alice', {
      document: 'doc-bad-cfi',
      progress: '/p[1]',
      percentage: 0.1,
      device: 'Kobo',
      device_id: 'd1',
    });
    const agent = await userAgent();
    const res = await agent.get('/api/my/progress');
    expect(res.status).toBe(200);
    expect(res.body[0].currentChapter).toBeUndefined();
  });

  it('does not expose chapterSpineMap on progress records', async () => {
    bookStore.addBook('doc-no-expose', stage('doc-no-expose'), {
      ...FAKE_META,
      chapterCount: 3,
      chapterSpineMap: [1, 2, 3],
    });
    userStore.saveProgress('alice', {
      document: 'doc-no-expose',
      progress: 'EPUB_CFI(/6/4!/4/1:0)',
      percentage: 0.3,
      device: 'Kobo',
      device_id: 'd1',
    });
    const agent = await userAgent();
    const res = await agent.get('/api/my/progress');
    expect(res.body[0].chapterSpineMap).toBeUndefined();
  });
});

describe('DELETE /api/my/progress/:document', () => {
  beforeEach(() => {
    userStore.saveProgress('alice', {
      document: 'doc1',
      progress: '/p[1]',
      percentage: 0.5,
      device: 'Kobo',
      device_id: 'd1',
    });
  });

  it('redirects to /login without session', async () => {
    const res = await request(app).delete('/api/my/progress/doc1');
    expect(res.status).toBe(302);
  });

  it('returns 403 for admin', async () => {
    const agent = await adminAgent();
    const res = await agent.delete('/api/my/progress/doc1');
    expect(res.status).toBe(403);
    expect(res.body).toEqual({ error: 'Forbidden' });
  });

  it('returns 204 and clears the record for regular user', async () => {
    const agent = await userAgent();
    const res = await agent.delete('/api/my/progress/doc1');
    expect(res.status).toBe(204);
    expect(userStore.getProgress('alice', 'doc1')).toBeNull();
  });

  it('returns 404 when no record exists', async () => {
    const agent = await userAgent();
    const res = await agent.delete('/api/my/progress/nonexistent');
    expect(res.status).toBe(404);
    expect(res.body).toEqual({ error: 'Progress record not found' });
  });
});

describe('PUT /api/my/progress/:document', () => {
  it('redirects to /login without session', async () => {
    const res = await request(app)
      .put('/api/my/progress/doc1')
      .send({ currentChapter: 5, percentage: 0.25 });
    expect(res.status).toBe(302);
  });

  it('returns 403 for admin', async () => {
    const agent = await adminAgent();
    const res = await agent
      .put('/api/my/progress/doc1')
      .send({ currentChapter: 5, percentage: 0.25 });
    expect(res.status).toBe(403);
    expect(res.body).toEqual({ error: 'Forbidden' });
  });

  it('returns 400 when currentChapter is missing', async () => {
    const agent = await userAgent();
    const res = await agent.put('/api/my/progress/doc1').send({ percentage: 0.25 });
    expect(res.status).toBe(400);
    expect(res.body).toEqual({ error: 'Invalid body' });
  });

  it('returns 400 when percentage is missing', async () => {
    const agent = await userAgent();
    const res = await agent.put('/api/my/progress/doc1').send({ currentChapter: 5 });
    expect(res.status).toBe(400);
    expect(res.body).toEqual({ error: 'Invalid body' });
  });

  it('returns 400 when currentChapter is less than 1', async () => {
    const agent = await userAgent();
    const res = await agent
      .put('/api/my/progress/doc1')
      .send({ currentChapter: 0, percentage: 0.1 });
    expect(res.status).toBe(400);
    expect(res.body).toEqual({ error: 'Invalid body' });
  });

  it('returns 400 when percentage is greater than 1', async () => {
    const agent = await userAgent();
    const res = await agent
      .put('/api/my/progress/doc1')
      .send({ currentChapter: 5, percentage: 1.5 });
    expect(res.status).toBe(400);
    expect(res.body).toEqual({ error: 'Invalid body' });
  });

  it('returns 400 when percentage is not positive', async () => {
    const agent = await userAgent();
    const res = await agent.put('/api/my/progress/doc1').send({ currentChapter: 5, percentage: 0 });
    expect(res.status).toBe(400);
    expect(res.body).toEqual({ error: 'Invalid body' });
  });

  it('saves progress and returns 200 for regular user', async () => {
    const agent = await userAgent();
    const res = await agent
      .put('/api/my/progress/doc1')
      .send({ currentChapter: 5, percentage: 0.25 });
    expect(res.status).toBe(200);
    const saved = userStore.getProgress('alice', 'doc1');
    expect(saved).not.toBeNull();
    expect(saved!.percentage).toBe(0.25);
  });

  it('overwrites an existing progress record', async () => {
    userStore.saveProgress('alice', {
      document: 'doc1',
      progress: '/p[1]',
      percentage: 0.5,
      device: 'Kobo',
      device_id: 'd1',
    });
    const agent = await userAgent();
    const res = await agent
      .put('/api/my/progress/doc1')
      .send({ currentChapter: 10, percentage: 0.75 });
    expect(res.status).toBe(200);
    expect(userStore.getProgress('alice', 'doc1')!.percentage).toBe(0.75);
  });

  it('saves device and device_id when provided', async () => {
    const agent = await userAgent();
    const res = await agent
      .put('/api/my/progress/doc1')
      .send({ currentChapter: 5, percentage: 0.25, device: 'Web', device_id: 'test-uuid' });
    expect(res.status).toBe(200);
    const saved = userStore.getProgress('alice', 'doc1');
    expect(saved!.device).toBe('Web');
    expect(saved!.device_id).toBe('test-uuid');
  });

  it('defaults device to "Web" when not provided', async () => {
    const agent = await userAgent();
    await agent.put('/api/my/progress/doc1').send({ currentChapter: 5, percentage: 0.25 });
    expect(userStore.getProgress('alice', 'doc1')!.device).toBe('Web');
  });

  it('synthesises an EPUB CFI when the book has a chapterSpineMap', async () => {
    bookStore.addBook('cfidoc', stage('cfidoc'), {
      ...FAKE_META,
      chapterCount: 10,
      chapterSpineMap: [1, 2, 3, 4, 5, 6, 7, 8, 9, 10],
    });
    const agent = await userAgent();
    const res = await agent
      .put('/api/my/progress/cfidoc')
      .send({ currentChapter: 3, percentage: 0.3 });
    expect(res.status).toBe(200);
    // chapterSpineMap[2] = 3, so spineIndex = 3, CFI n = 3*2+2 = 8
    expect(userStore.getProgress('alice', 'cfidoc')!.progress).toBe('EPUB_CFI(/6/8!/4/2:0)');
  });
});

describe('PATCH /api/books/:id/metadata', () => {
  let bookId: string;

  beforeEach(() => {
    // Write a real EPUB to booksDir so writeMetadata can read it
    const zip = new AdmZip();
    zip.addFile(
      'META-INF/container.xml',
      Buffer.from(`<?xml version="1.0"?>
<container version="1.0" xmlns="urn:oasis:names:tc:opendocument:xmlns:container">
  <rootfiles><rootfile full-path="OEBPS/content.opf" media-type="application/oebps-package+xml"/></rootfiles>
</container>`)
    );
    zip.addFile(
      'OEBPS/content.opf',
      Buffer.from(`<?xml version="1.0" encoding="UTF-8"?>
<package xmlns="http://www.idpf.org/2007/opf" version="2.0">
  <metadata xmlns:dc="http://purl.org/dc/elements/1.1/"><dc:title>Original Title</dc:title></metadata>
  <manifest><item id="ncx" href="toc.ncx" media-type="application/x-dtbncx+xml"/></manifest>
  <spine toc="ncx"/>
</package>`)
    );
    const epubPath = path.join(booksDir, 'edit-test.epub');
    fs.writeFileSync(epubPath, zip.toBuffer());
    bookStore.scan(); // import the file into the DB
    bookId = bookStore.listBooks()[0].id;
  });

  it('returns 403 for regular user', async () => {
    const agent = await userAgent();
    const res = await agent.patch(`/api/books/${bookId}/metadata`).field('title', 'New');
    expect(res.status).toBe(403);
  });

  it('returns 404 for unknown book id', async () => {
    const agent = await adminAgent();
    const res = await agent.patch('/api/books/doesnotexist/metadata').field('title', 'New');
    expect(res.status).toBe(404);
  });

  it('returns 302 without session', async () => {
    const res = await request(app).patch(`/api/books/${bookId}/metadata`).field('title', 'New');
    expect(res.status).toBe(302);
  });

  it('updates title and returns the updated book', async () => {
    const agent = await adminAgent();
    const res = await agent.patch(`/api/books/${bookId}/metadata`).field('title', 'Updated Title');
    expect(res.status).toBe(200);
    expect(res.body.title).toBe('Updated Title');
    expect(res.body.path).toBeUndefined(); // path must not be exposed
    expect(res.body.chapterSpineMap).toBeUndefined();
    // Verify the returned book ID is now in the DB (ID may have shifted)
    const newId: string = res.body.id;
    expect(bookStore.getBookById(newId)).not.toBeNull();
    expect(bookStore.getBookById(newId)!.title).toBe('Updated Title');
  });

  it('updates cover when image file is attached', async () => {
    const agent = await adminAgent();
    const coverBytes = Buffer.from('fake-png-cover');
    const res = await agent
      .patch(`/api/books/${bookId}/metadata`)
      .attach('cover', coverBytes, { filename: 'cover.png', contentType: 'image/png' });
    expect(res.status).toBe(200);
    const newId: string = res.body.id;
    expect(res.body.hasCover).toBe(true);
    // Verify cover is stored in DB
    const cover = bookStore.getCover(newId);
    expect(cover).not.toBeNull();
    expect(cover!.data).toEqual(coverBytes);
  });

  it('enqueues thumbnails after metadata update', async () => {
    const agent = await adminAgent();
    (mockThumbnailQueue.enqueue as jest.Mock).mockClear();
    await agent.patch(`/api/books/${bookId}/metadata`).field('title', 'Updated');
    expect(mockThumbnailQueue.enqueue).toHaveBeenCalledTimes(1);
  });
});

describe('GET /api/config', () => {
  it('redirects to /login without session', async () => {
    const res = await request(app).get('/api/config');
    expect(res.status).toBe(302);
  });

  it('returns maxConcurrentUploads for authenticated user', async () => {
    const agent = await adminAgent();
    const res = await agent.get('/api/config');
    expect(res.status).toBe(200);
    expect(res.body).toEqual({ maxConcurrentUploads: 3 });
  });

  it('returns maxConcurrentUploads for regular user', async () => {
    const agent = await userAgent();
    const res = await agent.get('/api/config');
    expect(res.status).toBe(200);
    expect(res.body).toEqual({ maxConcurrentUploads: 3 });
  });
});

describe('SPA routes serve index.html', () => {
  it('GET /books/:id returns 200 with HTML', async () => {
    const agent = await adminAgent();
    const res = await agent.get('/books/someid');
    expect(res.status).toBe(200);
    expect(res.text).toContain('<!DOCTYPE html>');
  });

  it('GET /books/:id/edit returns 200 with HTML', async () => {
    const agent = await adminAgent();
    const res = await agent.get('/books/someid/edit');
    expect(res.status).toBe(200);
    expect(res.text).toContain('<!DOCTYPE html>');
  });

  it('GET /series/:name returns 200 with HTML', async () => {
    const agent = await adminAgent();
    const res = await agent.get('/series/My%20Series');
    expect(res.status).toBe(200);
    expect(res.text).toContain('<!DOCTYPE html>');
  });

  it('SPA routes redirect to /login without session', async () => {
    const res = await request(app).get('/books/someid');
    expect(res.status).toBe(302);
    expect(res.headers.location).toBe('/login');
  });

  it('GET /upload returns 200 with HTML', async () => {
    const agent = await adminAgent();
    const res = await agent.get('/upload');
    expect(res.status).toBe(200);
    expect(res.text).toContain('<!DOCTYPE html>');
  });

  it('GET /upload redirects to /login without session', async () => {
    const res = await request(app).get('/upload');
    expect(res.status).toBe(302);
    expect(res.headers.location).toBe('/login');
  });
});
