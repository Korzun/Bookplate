import * as os from 'os';
import * as path from 'path';
import * as fs from 'fs';
import * as crypto from 'crypto';
import request from 'supertest';
import express from 'express';
import cookieParser from 'cookie-parser';
import { PrismaClient } from '@prisma/client';
import { PrismaBetterSqlite3 } from '@prisma/adapter-better-sqlite3';
import { runMigrations } from '../db/migrate';
import AdmZip from 'adm-zip';
import { BookStore } from '../services/book-store';
import { UserStore } from '../services/user-store';
import { TokenStore } from '../services/token-store';
import { signAccessToken, verifyAccessToken } from '../services/jwt';
import { createUiRouter } from './ui';
import { AppConfig, EpubMeta, Owner } from '../types';

jest.mock('../logger');
jest.setTimeout(30000);
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
let prisma: PrismaClient;
let bookStore: BookStore;
let userStore: UserStore;
let tokenStore: TokenStore;
let app: express.Express;
let dbPath: string;
let aliceId: string;
// The book-route tests seed books into alice's library and exercise them as
// alice (her own library, no ?user= needed). Admin sessions must target a
// library with ?user=<username>.
let aliceOwner: Owner;

const jwtSecret = crypto.randomBytes(32);

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

async function loginAdmin(): Promise<string> {
  const res = await request(app)
    .post('/api/login')
    .send('username=admin&password=pass')
    .set('Content-Type', 'application/x-www-form-urlencoded');
  return (res.body as { accessToken: string }).accessToken;
}

async function loginAlice(): Promise<string> {
  const res = await request(app)
    .post('/api/login')
    .send('username=alice&password=alicepass')
    .set('Content-Type', 'application/x-www-form-urlencoded');
  return (res.body as { accessToken: string }).accessToken;
}

const bearer = (token: string): [string, string] => ['Authorization', `Bearer ${token}`];

beforeEach(async () => {
  booksDir = fs.mkdtempSync(path.join(os.tmpdir(), 'hass-odps-ui-'));
  dbPath = path.join(
    os.tmpdir(),
    `test-${Date.now()}-${Math.random().toString(36).slice(2)}.sqlite`
  );
  const adapter = new PrismaBetterSqlite3({ url: `file:${dbPath}` });
  prisma = new PrismaClient({ adapter } as ConstructorParameters<typeof PrismaClient>[0]);
  await runMigrations(prisma, booksDir);
  bookStore = new BookStore(booksDir, prisma);
  userStore = new UserStore(prisma);
  await userStore.createUser('alice', await UserStore.hashLoginPassword('alicepass'));
  aliceId = (await userStore.getUserIdByUsername('alice'))!;
  tokenStore = new TokenStore(prisma);
  aliceOwner = { userId: aliceId, username: 'alice' };

  app = express();
  app.use(express.json());
  app.use(express.urlencoded({ extended: false }));
  app.use(cookieParser());
  app.use(
    '/',
    createUiRouter(
      bookStore,
      userStore,
      { ...config, booksDir },
      mockThumbnailQueue,
      tokenStore,
      jwtSecret
    )
  );
  (mockThumbnailQueue.enqueue as jest.Mock).mockClear();
  (mockThumbnailQueue.reconcile as jest.Mock).mockClear();
});

afterEach(async () => {
  await prisma.$disconnect();
  try {
    fs.unlinkSync(dbPath);
  } catch {
    /* best-effort cleanup */
  }
  fs.rmSync(booksDir, { recursive: true });
});

describe('GET /', () => {
  it('serves the SPA without auth', async () => {
    const res = await request(app).get('/');
    expect(res.status).toBe(200);
  });

  it('returns 200 with a valid session', async () => {
    const token = await loginAdmin();
    const res = await request(app)
      .get('/')
      .set(...bearer(token));
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
    expect(res.body.accessToken).toEqual(expect.any(String));
  });

  it('returns 200 on correct regular user credentials', async () => {
    const res = await request(app)
      .post('/api/login')
      .send('username=alice&password=alicepass')
      .set('Content-Type', 'application/x-www-form-urlencoded');
    expect(res.status).toBe(200);
    expect(res.body.accessToken).toEqual(expect.any(String));
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

  it('returns 403 with a clear message when the user has no password set', async () => {
    await userStore.createUser('nopass', null);
    const res = await request(app)
      .post('/api/login')
      .send('username=nopass&password=anything')
      .set('Content-Type', 'application/x-www-form-urlencoded');
    expect(res.status).toBe(403);
  });
});

describe('GET /api/books', () => {
  it('returns 401 without a token', async () => {
    const res = await request(app).get('/api/books');
    expect(res.status).toBe(401);
  });

  it('returns JSON array of books', async () => {
    await bookStore.addBook(aliceOwner, 'book1', stage('book1'), {
      ...FAKE_META,
      title: 'book',
    });
    const token = await loginAlice();
    const res = await request(app)
      .get('/api/books')
      .set(...bearer(token));
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
    await bookStore.addBook(aliceOwner, 'enriched1', stage('enriched1'), meta);
    const token = await loginAlice();
    const res = await request(app)
      .get('/api/books')
      .set(...bearer(token));
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

    await bookStore.addBook(aliceOwner, 'foundation1', stage('foundation1'), meta);

    const token = await loginAlice();
    const res = await request(app)
      .get('/api/books')
      .set(...bearer(token));

    expect(res.status).toBe(200);
    expect(Array.isArray(res.body)).toBe(true);
    expect(res.body).toHaveLength(1);
    const [book] = res.body;
    expect(book.fileAs).toBe('Asimov, Isaac');
    expect(book.path).toBeUndefined();
    expect(book.description).toBeUndefined();
  });

  it('includes chapterCount in the book list response', async () => {
    await bookStore.addBook(aliceOwner, 'id-ch', stage('id-ch'), {
      ...FAKE_META,
      chapterCount: 7,
      chapterSpineMap: [1, 2, 3, 4, 5, 6, 7],
    });
    const token = await loginAlice();
    const res = await request(app)
      .get('/api/books')
      .set(...bearer(token));
    expect(res.status).toBe(200);
    expect(res.body[0].chapterCount).toBe(7);
    expect(res.body[0].chapterSpineMap).toBeUndefined();
  });
});

describe('GET /api/books (paginated)', () => {
  it('returns paginated shape when take param is present', async () => {
    await bookStore.addBook(aliceOwner, 'b1', stage('b1'), {
      ...FAKE_META,
      title: 'Alpha',
      series: '',
    });
    const token = await loginAlice();
    const res = await request(app)
      .get('/api/books?take=20')
      .set(...bearer(token));
    expect(res.status).toBe(200);
    expect(Array.isArray(res.body.items)).toBe(true);
    expect(Array.isArray(res.body.books)).toBe(true);
    expect(res.body).toHaveProperty('nextCursor');
  });

  it('places a series as a single item in the items array', async () => {
    await bookStore.addBook(aliceOwner, 'b1', stage('b1'), {
      ...FAKE_META,
      title: 'Dune 1',
      series: 'Dune',
    });
    await bookStore.addBook(aliceOwner, 'b2', stage('b2'), {
      ...FAKE_META,
      title: 'Dune 2',
      series: 'Dune',
    });
    const token = await loginAlice();
    const res = await request(app)
      .get('/api/books?take=20')
      .set(...bearer(token));
    expect(res.status).toBe(200);
    expect(res.body.items).toEqual([{ type: 'series', seriesName: 'Dune' }]);
    expect(res.body.books).toHaveLength(2);
  });

  it('returns nextCursor when more pages exist', async () => {
    for (let i = 1; i <= 3; i++) {
      await bookStore.addBook(aliceOwner, `b${i}`, stage(`b${i}`), {
        ...FAKE_META,
        title: `Book ${String.fromCharCode(64 + i)}`,
        series: '',
      });
    }
    const token = await loginAlice();
    const res = await request(app)
      .get('/api/books?take=2')
      .set(...bearer(token));
    expect(res.status).toBe(200);
    expect(res.body.items).toHaveLength(2);
    expect(res.body.nextCursor).not.toBeNull();
  });

  it('advances with cursor to load the next page', async () => {
    for (let i = 1; i <= 4; i++) {
      await bookStore.addBook(aliceOwner, `p${i}`, stage(`p${i}`), {
        ...FAKE_META,
        title: `Book ${String.fromCharCode(64 + i)}`,
        series: '',
      });
    }
    const token = await loginAlice();
    const page1 = await request(app)
      .get('/api/books?take=2')
      .set(...bearer(token));
    const cursor = page1.body.nextCursor as string;
    const page2 = await request(app)
      .get(`/api/books?cursor=${encodeURIComponent(cursor)}&take=2`)
      .set(...bearer(token));
    expect(page2.status).toBe(200);
    expect(page2.body.items).toHaveLength(2);
    expect(page2.body.nextCursor).toBeNull();
  });

  it('returns 401 without a token', async () => {
    const res = await request(app).get('/api/books?take=20');
    expect(res.status).toBe(401);
  });

  it('non-paginated call (no params) still returns flat array', async () => {
    await bookStore.addBook(aliceOwner, 'flat1', stage('flat1'), { ...FAKE_META, title: 'Flat' });
    const token = await loginAlice();
    const res = await request(app)
      .get('/api/books')
      .set(...bearer(token));
    expect(res.status).toBe(200);
    expect(Array.isArray(res.body)).toBe(true);
  });
});

describe('POST /api/books/upload', () => {
  it('rejects .pdf files with 400 and "Supported: epub"', async () => {
    const token = await loginAlice();
    const res = await request(app)
      .post('/api/books/upload')
      .set(...bearer(token))
      .attach('files', Buffer.from('pdf-content'), 'notes.pdf');
    expect(res.status).toBe(400);
    expect(res.body.error).toMatch(/Supported: epub/);
  });

  it('rejects .mobi files with 400 and "Supported: epub"', async () => {
    const token = await loginAlice();
    const res = await request(app)
      .post('/api/books/upload')
      .set(...bearer(token))
      .attach('files', Buffer.from('mobi-content'), 'book.mobi');
    expect(res.status).toBe(400);
    expect(res.body.error).toMatch(/Supported: epub/);
  });

  it('rejects unsupported file types', async () => {
    const token = await loginAlice();
    const res = await request(app)
      .post('/api/books/upload')
      .set(...bearer(token))
      .attach('files', Buffer.from('text'), 'notes.txt');
    expect(res.status).toBe(400);
  });

  it('rejects invalid EPUB content with 400', async () => {
    const token = await loginAlice();
    const res = await request(app)
      .post('/api/books/upload')
      .set(...bearer(token))
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
    const token = await loginAlice();
    const res = await request(app)
      .post('/api/books/upload')
      .attach('files', epubBuf, 'parsed.epub')
      .set(...bearer(token));
    expect(res.status).toBe(200);
    expect(res.body.uploaded).toContain('parsed.epub');

    // Verify metadata was stored and file is on disk at canonical path
    const books = await bookStore.listBooks(aliceOwner);
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
    const token = await loginAlice();
    const res = await request(app)
      .post('/api/books/upload')
      .attach('files', epubBuf, 'cover.epub')
      .set(...bearer(token));
    expect(res.status).toBe(200);

    const books = await bookStore.listBooks(aliceOwner);
    expect(books[0].hasCover).toBe(true);
  });

  it('enqueues thumbnails after a successful upload', async () => {
    const epubBuf = makeEpub({ title: 'Queued Book' });
    const token = await loginAlice();
    await request(app)
      .post('/api/books/upload')
      .attach('files', epubBuf, 'queued.epub')
      .set(...bearer(token));
    expect(mockThumbnailQueue.enqueue).toHaveBeenCalledTimes(1);
  });

  it('places uploaded file at <booksDir>/<id>.epub', async () => {
    const token = await loginAlice();
    const epubBuf = makeEpub({ title: 'Stored Book', author: 'A' });
    const res = await request(app)
      .post('/api/books/upload')
      .attach('files', epubBuf, 'human-name.epub')
      .set(...bearer(token));
    expect(res.status).toBe(200);
    const books = await bookStore.listBooks(aliceOwner);
    expect(books).toHaveLength(1);
    const onDisk = fs
      .readdirSync(path.join(booksDir, 'alice'))
      .filter((f) => f.endsWith('.epub') && !f.startsWith('staged-'));
    expect(onDisk).toEqual([books[0].id + '.epub']);
  });

  it('returns 409 when uploading a duplicate (same content twice)', async () => {
    const token = await loginAlice();
    const epubBuf = makeEpub({ title: 'Dup', author: 'A' });
    await request(app)
      .post('/api/books/upload')
      .attach('files', epubBuf, 'first.epub')
      .set(...bearer(token));
    const res = await request(app)
      .post('/api/books/upload')
      .attach('files', epubBuf, 'second.epub')
      .set(...bearer(token));
    expect(res.status).toBe(409);
    expect(res.body.error).toMatch(/already in the library/i);
  });

  it('falls back to original-filename stem when title metadata is empty', async () => {
    const token = await loginAlice();
    const epubBuf = makeEpub({ author: 'A' }); // no title
    await request(app)
      .post('/api/books/upload')
      .attach('files', epubBuf, 'my-book.epub')
      .set(...bearer(token));
    const books = await bookStore.listBooks(aliceOwner);
    expect(books).toHaveLength(1);
    expect(books[0].title).toBe('my-book');
  });

  it('cleans up staging directory after successful upload', async () => {
    const token = await loginAlice();
    const epubBuf = makeEpub({ title: 'Clean', author: 'A' });
    await request(app)
      .post('/api/books/upload')
      .attach('files', epubBuf, 'clean.epub')
      .set(...bearer(token));
    const stagingDir = path.join(booksDir, '.staging');
    const staged = fs.existsSync(stagingDir) ? fs.readdirSync(stagingDir) : [];
    expect(staged).toEqual([]);
  });
});

describe('GET /api/books/:id', () => {
  it('returns full book data including description, publisher, identifiers, subjects', async () => {
    const token = await loginAlice();
    const meta: EpubMeta = {
      ...FAKE_META,
      title: 'Detail Book',
      description: 'A detailed description.',
      publisher: 'Test Publisher',
      identifiers: [{ scheme: 'ISBN', value: '978-1234567890' }],
      subjects: ['Fiction', 'Mystery'],
    };
    await bookStore.addBook(aliceOwner, 'detailid1', stage('detailid1'), meta);

    const res = await request(app)
      .get('/api/books/detailid1')
      .set(...bearer(token));
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
    const token = await loginAlice();
    const res = await request(app)
      .get('/api/books/doesnotexist')
      .set(...bearer(token));
    expect(res.status).toBe(404);
  });

  it('requires authentication', async () => {
    const res = await request(app).get('/api/books/anyid');
    expect(res.status).toBe(401);
  });

  it('includes chapterCount, chapterSpineMap, and chapterNames', async () => {
    await bookStore.addBook(aliceOwner, 'bk1', stage('bk1'), {
      ...FAKE_META,
      chapterCount: 5,
      chapterSpineMap: [1, 2, 3, 4, 5],
      chapterNames: ['Prologue', 'Ch 1', 'Ch 2', 'Ch 3', 'Ch 4'],
    });
    const token = await loginAlice();
    const res = await request(app)
      .get('/api/books/bk1')
      .set(...bearer(token));
    expect(res.status).toBe(200);
    expect(res.body.chapterCount).toBe(5);
    expect(res.body.chapterSpineMap).toEqual([1, 2, 3, 4, 5]);
    expect(res.body.chapterNames).toEqual(['Prologue', 'Ch 1', 'Ch 2', 'Ch 3', 'Ch 4']);
    // path must still NOT be exposed
    expect(res.body.path).toBeUndefined();
  });
});

describe('GET /api/books/:id/lineage', () => {
  it('returns 401 without a token', async () => {
    const res = await request(app).get('/api/books/some-id/lineage');
    expect(res.status).toBe(401);
  });

  it('lets a regular user view lineage in their own library (404 for unknown book)', async () => {
    const token = await loginAlice();
    const res = await request(app)
      .get('/api/books/some-id/lineage')
      .set(...bearer(token));
    expect(res.status).toBe(404);
  });

  it('returns 404 when book does not exist', async () => {
    const token = await loginAlice();
    const res = await request(app)
      .get('/api/books/no-such-book/lineage')
      .set(...bearer(token));
    expect(res.status).toBe(404);
  });

  it('returns lineage with empty entries for a book with no history', async () => {
    const token = await loginAlice();
    const epubBuf = makeEpub({ title: 'Lineage Test' });
    const epubPath = path.join(booksDir, 'lin-id.epub');
    fs.writeFileSync(epubPath, epubBuf);
    await bookStore.addBook(aliceOwner, 'lin-id', epubPath, FAKE_META);

    const res = await request(app)
      .get('/api/books/lin-id/lineage')
      .set(...bearer(token));
    expect(res.status).toBe(200);
    expect(res.body.currentId).toBe('lin-id');
    expect(res.body.entries).toEqual([]);
  });

  it('returns lineage with history entries when history exists', async () => {
    const token = await loginAlice();
    const epubPath = path.join(booksDir, 'curr-id.epub');
    fs.writeFileSync(epubPath, makeEpub({ title: 'History Test' }));
    await bookStore.addBook(aliceOwner, 'curr-id', epubPath, FAKE_META);
    // Insert a history row directly to simulate a prior reimport
    await prisma.$executeRaw`
      INSERT INTO book_id_history (user_id, old_id, current_id, timestamp)
      VALUES (${aliceId}, 'old-id', 'curr-id', ${Date.now() - 1000})
    `;

    const res = await request(app)
      .get('/api/books/curr-id/lineage')
      .set(...bearer(token));
    expect(res.status).toBe(200);
    expect(res.body.currentId).toBe('curr-id');
    expect(res.body.entries).toHaveLength(1);
    expect(res.body.entries[0].oldId).toBe('old-id');
    expect(res.body.entries[0].newId).toBe('curr-id');
    expect(typeof res.body.entries[0].timestamp).toBe('number');
    expect(res.body.entries[0].type).toBe('edit');
  });
});

describe('POST /api/books/:id/link', () => {
  it('returns 401 without a token', async () => {
    const res = await request(app).post('/api/books/some-id/link').send({ documentId: 'doc' });
    expect(res.status).toBe(401);
  });

  it('lets a regular user link within their own library (404 for unknown book)', async () => {
    const token = await loginAlice();
    const res = await request(app)
      .post('/api/books/some-id/link')
      .send({ documentId: 'doc' })
      .set(...bearer(token));
    expect(res.status).toBe(404);
  });

  it('returns 400 when documentId is missing', async () => {
    const token = await loginAlice();
    await bookStore.addBook(aliceOwner, 'link-book', stage('link-book'), FAKE_META);
    const res = await request(app)
      .post('/api/books/link-book/link')
      .send({})
      .set(...bearer(token));
    expect(res.status).toBe(400);
  });

  it('returns 404 when book does not exist', async () => {
    const token = await loginAlice();
    const res = await request(app)
      .post('/api/books/no-such-book/link')
      .send({ documentId: 'doc' })
      .set(...bearer(token));
    expect(res.status).toBe(404);
  });

  it('returns 400 when documentId equals bookId', async () => {
    const token = await loginAlice();
    await bookStore.addBook(aliceOwner, 'self-link-book', stage('self-link-book'), FAKE_META);
    const res = await request(app)
      .post('/api/books/self-link-book/link')
      .set(...bearer(token))
      .send({ documentId: 'self-link-book' });
    expect(res.status).toBe(400);
  });

  it('returns 409 when documentId is already linked', async () => {
    const token = await loginAlice();
    await bookStore.addBook(
      aliceOwner,
      'already-linked-book',
      stage('already-linked-book'),
      FAKE_META
    );
    await prisma.$executeRaw`
      INSERT INTO book_id_history (user_id, old_id, current_id, timestamp, type)
      VALUES (${aliceId}, 'already-orphan', 'already-linked-book', ${Date.now()}, 'merge')
    `;
    const res = await request(app)
      .post('/api/books/already-linked-book/link')
      .set(...bearer(token))
      .send({ documentId: 'already-orphan' });
    expect(res.status).toBe(409);
  });

  it('returns 409 when documentId is a live book', async () => {
    const token = await loginAlice();
    await bookStore.addBook(aliceOwner, 'live-book-1', stage('live-book-1'), FAKE_META);
    await bookStore.addBook(aliceOwner, 'live-book-2', stage('live-book-2'), FAKE_META);
    const res = await request(app)
      .post('/api/books/live-book-1/link')
      .send({ documentId: 'live-book-2' })
      .set(...bearer(token));
    expect(res.status).toBe(409);
  });

  it('returns 204 and migrates progress on success', async () => {
    const token = await loginAlice();
    await bookStore.addBook(aliceOwner, 'route-link-target', stage('route-link-target'), FAKE_META);
    // Lineage and progress migration are owner-scoped, so only the session
    // user's (alice's) progress migrates.
    await prisma.progress.create({
      data: {
        userId: aliceId,
        document: 'route-orphan',
        progress: '',
        percentage: 0.42,
        device: 'Kobo',
        deviceId: 'dev-x',
        timestamp: 1000,
      },
    });

    const res = await request(app)
      .post('/api/books/route-link-target/link')
      .set(...bearer(token))
      .send({ documentId: 'route-orphan' });
    expect(res.status).toBe(204);

    const migrated = await prisma.progress.findUnique({
      where: { userId_document: { userId: aliceId, document: 'route-link-target' } },
    });
    expect(migrated).not.toBeNull();
    expect(migrated!.percentage).toBe(0.42);
  });
});

describe('DELETE /api/books/:id/link/:documentId', () => {
  it('returns 401 without a token', async () => {
    const res = await request(app).delete('/api/books/some-id/link/some-doc');
    expect(res.status).toBe(401);
  });

  it('lets a regular user unlink within their own library (404 for unknown row)', async () => {
    const token = await loginAlice();
    const res = await request(app)
      .delete('/api/books/some-id/link/some-doc')
      .set(...bearer(token));
    expect(res.status).toBe(404);
  });

  it('returns 404 when no matching merge row exists', async () => {
    const token = await loginAlice();
    const res = await request(app)
      .delete('/api/books/no-book/link/no-doc')
      .set(...bearer(token));
    expect(res.status).toBe(404);
  });

  it('returns 400 when row exists but is type=edit', async () => {
    const token = await loginAlice();
    await bookStore.addBook(aliceOwner, 'unlink-book', stage('unlink-book'), FAKE_META);
    await prisma.$executeRaw`
      INSERT INTO book_id_history (user_id, old_id, current_id, timestamp, type)
      VALUES (${aliceId}, 'edit-doc', 'unlink-book', ${Date.now()}, 'edit')
    `;
    const res = await request(app)
      .delete('/api/books/unlink-book/link/edit-doc')
      .set(...bearer(token));
    expect(res.status).toBe(400);
  });

  it('returns 204 and removes the merge row', async () => {
    const token = await loginAlice();
    await bookStore.addBook(aliceOwner, 'unlink-target', stage('unlink-target'), FAKE_META);
    await prisma.$executeRaw`
      INSERT INTO book_id_history (user_id, old_id, current_id, timestamp, type)
      VALUES (${aliceId}, 'merge-doc', 'unlink-target', ${Date.now()}, 'merge')
    `;

    const res = await request(app)
      .delete('/api/books/unlink-target/link/merge-doc')
      .set(...bearer(token));
    expect(res.status).toBe(204);

    const rows = await prisma.$queryRaw<Array<unknown>>`
      SELECT * FROM book_id_history WHERE old_id = 'merge-doc'
    `;
    expect(rows).toHaveLength(0);
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
    await bookStore.addBook(aliceOwner, 'coverId1', stage('coverId1'), meta);

    const token = await loginAlice();
    const res = await request(app)
      .get('/api/books/coverId1/cover')
      .set(...bearer(token));
    expect(res.status).toBe(200);
    expect(res.headers['content-type']).toMatch(/image\/jpeg/);
    expect(Buffer.from(res.body).toString()).toBe('fake-jpeg-bytes');
  });

  it('returns 404 for a book without cover', async () => {
    await bookStore.addBook(aliceOwner, 'noCoverId', stage('noCoverId'), FAKE_META);

    const token = await loginAlice();
    const res = await request(app)
      .get('/api/books/noCoverId/cover')
      .set(...bearer(token));
    expect(res.status).toBe(404);
  });

  it('returns 404 for an unknown book id', async () => {
    const token = await loginAlice();
    const res = await request(app)
      .get('/api/books/unknownId/cover')
      .set(...bearer(token));
    expect(res.status).toBe(404);
  });

  it('returns thumbnail when ?width= matches a stored thumbnail', async () => {
    const coverBuf = Buffer.from('original-cover');
    const thumbBuf = Buffer.from('thumbnail-data');
    await bookStore.addBook(aliceOwner, 'thumbBook', stage('thumbBook'), {
      ...FAKE_META,
      coverData: coverBuf,
      coverMime: 'image/jpeg',
    });
    await bookStore.saveThumbnail(aliceOwner.userId, 'thumbBook', 150, thumbBuf, 'image/jpeg');

    const token = await loginAlice();
    const res = await request(app)
      .get('/api/books/thumbBook/cover?width=150')
      .set(...bearer(token));
    expect(res.status).toBe(200);
    expect(Buffer.from(res.body).toString()).toBe('thumbnail-data');
  });

  it('falls back to full-size when ?width= has no matching thumbnail', async () => {
    const coverBuf = Buffer.from('full-size-cover');
    await bookStore.addBook(aliceOwner, 'fbBook', stage('fbBook'), {
      ...FAKE_META,
      coverData: coverBuf,
      coverMime: 'image/jpeg',
    });

    const token = await loginAlice();
    const res = await request(app)
      .get('/api/books/fbBook/cover?width=150')
      .set(...bearer(token));
    expect(res.status).toBe(200);
    expect(Buffer.from(res.body).toString()).toBe('full-size-cover');
  });
});

describe('DELETE /api/books/:id', () => {
  it('deletes a book and returns 204', async () => {
    await bookStore.addBook(aliceOwner, 'book1', stage('book1'), FAKE_META);
    const [book] = await bookStore.listBooks(aliceOwner);

    const token = await loginAlice();
    const res = await request(app)
      .delete(`/api/books/${book.id}`)
      .set(...bearer(token));
    expect(res.status).toBe(204);
    expect(fs.existsSync(path.join(booksDir, 'alice', 'book1.epub'))).toBe(false);
  });

  it('returns 404 for unknown book id', async () => {
    const token = await loginAlice();
    const res = await request(app)
      .delete('/api/books/deadbeefdeadbeef')
      .set(...bearer(token));
    expect(res.status).toBe(404);
  });
});

describe('POST /api/books/scan', () => {
  it('returns 401 without a token', async () => {
    const res = await request(app).post('/api/books/scan');
    expect(res.status).toBe(401);
  });

  it('returns { imported: [], removed: [] } when nothing to scan', async () => {
    const token = await loginAlice();
    const res = await request(app)
      .post('/api/books/scan')
      .set(...bearer(token));
    expect(res.status).toBe(200);
    expect(res.body).toEqual({ imported: [], removed: [] });
  });

  it('imports an epub file found on disk but not in DB', async () => {
    // Write a real EPUB into alice's library folder without going through upload.
    const epubBuf = makeEpub({ title: 'Found Book', author: 'Found Author' });
    fs.mkdirSync(path.join(booksDir, 'alice'), { recursive: true });
    fs.writeFileSync(path.join(booksDir, 'alice', 'found.epub'), epubBuf);

    const token = await loginAlice();
    const res = await request(app)
      .post('/api/books/scan')
      .set(...bearer(token));
    expect(res.status).toBe(200);
    expect(res.body.imported).toContain('found.epub');
    expect(res.body.removed).toEqual([]);

    // Verify it's now in the library
    const listRes = await request(app)
      .get('/api/books')
      .set(...bearer(token));
    expect(listRes.body).toHaveLength(1);
    expect(listRes.body[0].title).toBe('Found Book');
  });

  it('reports removed for a DB entry whose file is gone', async () => {
    // Add a book to the DB then remove the file so the scan reports it removed
    await bookStore.addBook(aliceOwner, 'stale001', stage('stale001'), {
      ...FAKE_META,
      title: 'Stale Book',
    });
    fs.rmSync(path.join(booksDir, 'alice', 'stale001.epub'));

    const token = await loginAlice();
    const res = await request(app)
      .post('/api/books/scan')
      .set(...bearer(token));
    expect(res.status).toBe(200);
    expect(res.body.removed).toContain('stale001.epub');
    expect(res.body.imported).toEqual([]);
  });

  it('calls thumbnailQueue.reconcile after scan', async () => {
    const token = await loginAlice();
    await request(app)
      .post('/api/books/scan')
      .set(...bearer(token));
    expect(mockThumbnailQueue.reconcile).toHaveBeenCalledTimes(1);
  });
});

describe('DELETE /api/books/:id (admin needs ?user=)', () => {
  beforeEach(async () => {
    await bookStore.addBook(aliceOwner, 'b1', stage('b1'), FAKE_META);
  });

  it('admin can delete a targeted library book with ?user=', async () => {
    const token = await loginAdmin();
    const res = await request(app)
      .delete('/api/books/b1?user=alice')
      .set(...bearer(token));
    expect(res.status).toBe(204);
  });

  it('admin without ?user= gets 400', async () => {
    const token = await loginAdmin();
    const res = await request(app)
      .delete('/api/books/b1')
      .set(...bearer(token));
    expect(res.status).toBe(400);
  });

  it('regular user deletes their own book (204)', async () => {
    const token = await loginAlice();
    const res = await request(app)
      .delete('/api/books/b1')
      .set(...bearer(token));
    expect(res.status).toBe(204);
  });
});

describe('POST /api/books/scan (admin needs ?user=)', () => {
  it('admin can scan a targeted library with ?user=', async () => {
    const token = await loginAdmin();
    const res = await request(app)
      .post('/api/books/scan?user=alice')
      .set(...bearer(token));
    expect(res.status).toBe(200);
  });

  it('admin without ?user= gets 400', async () => {
    const token = await loginAdmin();
    const res = await request(app)
      .post('/api/books/scan')
      .set(...bearer(token));
    expect(res.status).toBe(400);
  });

  it('regular user scans their own library (200)', async () => {
    const token = await loginAlice();
    const res = await request(app)
      .post('/api/books/scan')
      .set(...bearer(token));
    expect(res.status).toBe(200);
  });
});

describe('GET /api/my/progress', () => {
  it('returns 401 without a token', async () => {
    const res = await request(app).get('/api/my/progress');
    expect(res.status).toBe(401);
  });

  it('returns [] for admin', async () => {
    const token = await loginAdmin();
    const res = await request(app)
      .get('/api/my/progress')
      .set(...bearer(token));
    expect(res.status).toBe(200);
    expect(res.body).toEqual([]);
  });

  it('returns 401 when the token has no userId (non-admin)', async () => {
    const token = signAccessToken(jwtSecret, {
      username: 'alice',
      isAdmin: false,
      mustChangePassword: false,
    });
    const res = await request(app)
      .get('/api/my/progress')
      .set(...bearer(token));
    expect(res.status).toBe(401);
    expect(res.body).toEqual({ error: 'Session expired. Please log in again.' });
  });

  it('returns own progress records for regular user', async () => {
    await userStore.saveProgress(aliceId, {
      document: 'doc1',
      progress: '/p[1]',
      percentage: 0.72,
      device: 'Kobo',
      device_id: 'd1',
    });
    const token = await loginAlice();
    const res = await request(app)
      .get('/api/my/progress')
      .set(...bearer(token));
    expect(res.status).toBe(200);
    expect(res.body).toHaveLength(1);
    expect(res.body[0].document).toBe('doc1');
    expect(res.body[0].percentage).toBeCloseTo(0.72);
  });

  it('exposes device, device_id, timestamp, and progress CFI', async () => {
    await userStore.saveProgress(aliceId, {
      document: 'doc1',
      progress: '/p[1]',
      percentage: 0.5,
      device: 'Kobo',
      device_id: 'd1',
    });
    const token = await loginAlice();
    const res = await request(app)
      .get('/api/my/progress')
      .set(...bearer(token));
    expect(res.status).toBe(200);
    expect(res.body).toHaveLength(1);
    expect(res.body[0].device).toBe('Kobo');
    expect(res.body[0].device_id).toBe('d1');
    expect(typeof res.body[0].timestamp).toBe('number');
    expect(res.body[0].progress).toBe('/p[1]');
  });

  it("does not return another user's progress", async () => {
    await userStore.createUser('bob', await UserStore.hashLoginPassword('bobpass'));
    const bobId = (await userStore.getUserIdByUsername('bob'))!;
    await userStore.saveProgress(bobId, {
      document: 'doc2',
      progress: '/p[1]',
      percentage: 0.9,
      device: 'Kobo',
      device_id: 'd2',
    });
    const token = await loginAlice();
    const res = await request(app)
      .get('/api/my/progress')
      .set(...bearer(token));
    expect(res.status).toBe(200);
    expect(res.body).toHaveLength(0);
  });

  it('includes currentChapter when a matching book has chapter data and CFI is valid', async () => {
    // spine: cover(0) ch1(1) ch2(2) ch3(3); nav: ch1→1, ch2→2, ch3→3
    await bookStore.addBook(aliceOwner, 'doc-with-chapters', stage('doc-with-chapters'), {
      ...FAKE_META,
      chapterCount: 3,
      chapterSpineMap: [1, 2, 3],
    });
    // EPUB_CFI(/6/6...) → N=6 → spineIndex=(6-2)/2=2 → chapter 2 (ch2 is at spineIndex 2)
    await userStore.saveProgress(aliceId, {
      document: 'doc-with-chapters',
      progress: 'EPUB_CFI(/6/6[ch2]!/4/1:0)',
      percentage: 0.5,
      device: 'Kobo',
      device_id: 'd1',
    });
    const token = await loginAlice();
    const res = await request(app)
      .get('/api/my/progress')
      .set(...bearer(token));
    expect(res.status).toBe(200);
    expect(res.body[0].currentChapter).toBe(2);
  });

  it('includes currentChapterName when the book has chapterNames and CFI resolves to a chapter', async () => {
    await bookStore.addBook(aliceOwner, 'doc-with-names', stage('doc-with-names'), {
      ...FAKE_META,
      chapterCount: 3,
      chapterSpineMap: [1, 2, 3],
      chapterNames: ['Chapter 1', 'Chapter 2', 'Chapter 3'],
    });
    // EPUB_CFI(/6/6...) → spineIndex=2 → chapter 2 → chapterNames[1] = 'Chapter 2'
    await userStore.saveProgress(aliceId, {
      document: 'doc-with-names',
      progress: 'EPUB_CFI(/6/6[ch2]!/4/1:0)',
      percentage: 0.5,
      device: 'Kobo',
      device_id: 'd1',
    });
    const token = await loginAlice();
    const res = await request(app)
      .get('/api/my/progress')
      .set(...bearer(token));
    expect(res.status).toBe(200);
    expect(res.body[0].currentChapterName).toBe('Chapter 2');
  });

  it('omits currentChapterName when the book has no chapterNames', async () => {
    await bookStore.addBook(aliceOwner, 'doc-no-names', stage('doc-no-names'), {
      ...FAKE_META,
      chapterCount: 3,
      chapterSpineMap: [1, 2, 3],
      chapterNames: [],
    });
    // Same CFI as above — resolves to chapter 2, but chapterNames is empty
    await userStore.saveProgress(aliceId, {
      document: 'doc-no-names',
      progress: 'EPUB_CFI(/6/6[ch2]!/4/1:0)',
      percentage: 0.5,
      device: 'Kobo',
      device_id: 'd1',
    });
    const token = await loginAlice();
    const res = await request(app)
      .get('/api/my/progress')
      .set(...bearer(token));
    expect(res.status).toBe(200);
    expect(res.body[0].currentChapterName).toBeUndefined();
  });

  it('omits currentChapter when the book is not in the DB', async () => {
    await userStore.saveProgress(aliceId, {
      document: 'unknown-book-id',
      progress: 'EPUB_CFI(/6/4!/4/1:0)',
      percentage: 0.3,
      device: 'Kobo',
      device_id: 'd1',
    });
    const token = await loginAlice();
    const res = await request(app)
      .get('/api/my/progress')
      .set(...bearer(token));
    expect(res.status).toBe(200);
    expect(res.body[0].currentChapter).toBeUndefined();
  });

  it('omits currentChapter when the CFI is not in KoReader EPUB_CFI format', async () => {
    await bookStore.addBook(aliceOwner, 'doc-bad-cfi', stage('doc-bad-cfi'), {
      ...FAKE_META,
      chapterCount: 3,
      chapterSpineMap: [1, 2, 3],
    });
    await userStore.saveProgress(aliceId, {
      document: 'doc-bad-cfi',
      progress: '/p[1]',
      percentage: 0.1,
      device: 'Kobo',
      device_id: 'd1',
    });
    const token = await loginAlice();
    const res = await request(app)
      .get('/api/my/progress')
      .set(...bearer(token));
    expect(res.status).toBe(200);
    expect(res.body[0].currentChapter).toBeUndefined();
  });

  it('does not expose chapterSpineMap on progress records', async () => {
    await bookStore.addBook(aliceOwner, 'doc-no-expose', stage('doc-no-expose'), {
      ...FAKE_META,
      chapterCount: 3,
      chapterSpineMap: [1, 2, 3],
    });
    await userStore.saveProgress(aliceId, {
      document: 'doc-no-expose',
      progress: 'EPUB_CFI(/6/4!/4/1:0)',
      percentage: 0.3,
      device: 'Kobo',
      device_id: 'd1',
    });
    const token = await loginAlice();
    const res = await request(app)
      .get('/api/my/progress')
      .set(...bearer(token));
    expect(res.body[0].chapterSpineMap).toBeUndefined();
  });

  it('returns only the current-id entry after a reimport changes the book id', async () => {
    await bookStore.addBook(aliceOwner, 'lin-old', stage('lin-old'), FAKE_META);
    await userStore.saveProgress(aliceId, {
      document: 'lin-old',
      progress: '/p[1]',
      percentage: 0.5,
      device: 'Kobo',
      device_id: 'd1',
    });
    await bookStore.reimportBook(aliceOwner, 'lin-old', {
      parseEpub: () => FAKE_META,
      partialMD5: () => 'lin-new',
    });
    const token = await loginAlice();
    const res = await request(app)
      .get('/api/my/progress')
      .set(...bearer(token));
    expect(res.status).toBe(200);
    expect(res.body).toHaveLength(1);
    expect(res.body[0].document).toBe('lin-new');
  });
});

describe('POST /api/books/:id/regen-chapters', () => {
  it('returns 401 without a token', async () => {
    const res = await request(app).post('/api/books/any/regen-chapters');
    expect(res.status).toBe(401);
  });

  it('lets a regular user regen in their own library (404 for unknown book)', async () => {
    const token = await loginAlice();
    const res = await request(app)
      .post('/api/books/any/regen-chapters')
      .set(...bearer(token));
    expect(res.status).toBe(404);
  });

  it('returns 404 for unknown book id', async () => {
    const token = await loginAlice();
    const res = await request(app)
      .post('/api/books/nonexistent/regen-chapters')
      .set(...bearer(token));
    expect(res.status).toBe(404);
  });

  it('returns the updated book on success', async () => {
    const epubBuf = makeEpub({ title: FAKE_META.title, author: FAKE_META.author });
    await bookStore.addBook(aliceOwner, 'regen-ok', stage('regen-ok', epubBuf), FAKE_META);
    const token = await loginAlice();
    const res = await request(app)
      .post('/api/books/regen-ok/regen-chapters')
      .set(...bearer(token));
    expect(res.status).toBe(200);
    expect(res.body.title).toBe(FAKE_META.title);
  });
});

describe('DELETE /api/my/progress/:document', () => {
  beforeEach(async () => {
    await userStore.saveProgress(aliceId, {
      document: 'doc1',
      progress: '/p[1]',
      percentage: 0.5,
      device: 'Kobo',
      device_id: 'd1',
    });
  });

  it('returns 401 without a token', async () => {
    const res = await request(app).delete('/api/my/progress/doc1');
    expect(res.status).toBe(401);
  });

  it('returns 403 for admin', async () => {
    const token = await loginAdmin();
    const res = await request(app)
      .delete('/api/my/progress/doc1')
      .set(...bearer(token));
    expect(res.status).toBe(403);
    expect(res.body).toEqual({ error: 'Forbidden' });
  });

  it('returns 204 and clears the record for regular user', async () => {
    const token = await loginAlice();
    const res = await request(app)
      .delete('/api/my/progress/doc1')
      .set(...bearer(token));
    expect(res.status).toBe(204);
    expect(await userStore.getProgress(aliceId, 'doc1')).toBeNull();
  });

  it('returns 404 when no record exists', async () => {
    const token = await loginAlice();
    const res = await request(app)
      .delete('/api/my/progress/nonexistent')
      .set(...bearer(token));
    expect(res.status).toBe(404);
    expect(res.body).toEqual({ error: 'Progress record not found' });
  });

  it('returns 401 when the token has no userId (non-admin)', async () => {
    const token = signAccessToken(jwtSecret, {
      username: 'alice',
      isAdmin: false,
      mustChangePassword: false,
    });
    const res = await request(app)
      .delete('/api/my/progress/doc1')
      .set(...bearer(token));
    expect(res.status).toBe(401);
    expect(res.body).toEqual({ error: 'Session expired. Please log in again.' });
  });
});

describe('PUT /api/my/progress/:document', () => {
  it('returns 401 without a token', async () => {
    const res = await request(app)
      .put('/api/my/progress/doc1')
      .send({ currentChapter: 5, percentage: 0.25 });
    expect(res.status).toBe(401);
  });

  it('returns 403 for admin', async () => {
    const token = await loginAdmin();
    const res = await request(app)
      .put('/api/my/progress/doc1')
      .set(...bearer(token))
      .send({ currentChapter: 5, percentage: 0.25 });
    expect(res.status).toBe(403);
    expect(res.body).toEqual({ error: 'Forbidden' });
  });

  it('returns 400 when currentChapter is missing', async () => {
    const token = await loginAlice();
    const res = await request(app)
      .put('/api/my/progress/doc1')
      .send({ percentage: 0.25 })
      .set(...bearer(token));
    expect(res.status).toBe(400);
    expect(res.body).toEqual({ error: 'Invalid body' });
  });

  it('returns 400 when percentage is missing', async () => {
    const token = await loginAlice();
    const res = await request(app)
      .put('/api/my/progress/doc1')
      .send({ currentChapter: 5 })
      .set(...bearer(token));
    expect(res.status).toBe(400);
    expect(res.body).toEqual({ error: 'Invalid body' });
  });

  it('returns 400 when currentChapter is less than 1', async () => {
    const token = await loginAlice();
    const res = await request(app)
      .put('/api/my/progress/doc1')
      .set(...bearer(token))
      .send({ currentChapter: 0, percentage: 0.1 });
    expect(res.status).toBe(400);
    expect(res.body).toEqual({ error: 'Invalid body' });
  });

  it('returns 400 when percentage is greater than 1', async () => {
    const token = await loginAlice();
    const res = await request(app)
      .put('/api/my/progress/doc1')
      .set(...bearer(token))
      .send({ currentChapter: 5, percentage: 1.5 });
    expect(res.status).toBe(400);
    expect(res.body).toEqual({ error: 'Invalid body' });
  });

  it('returns 400 when percentage is not positive', async () => {
    const token = await loginAlice();
    const res = await request(app)
      .put('/api/my/progress/doc1')
      .send({ currentChapter: 5, percentage: 0 })
      .set(...bearer(token));
    expect(res.status).toBe(400);
    expect(res.body).toEqual({ error: 'Invalid body' });
  });

  it('saves progress and returns 200 for regular user', async () => {
    const token = await loginAlice();
    const res = await request(app)
      .put('/api/my/progress/doc1')
      .set(...bearer(token))
      .send({ currentChapter: 5, percentage: 0.25 });
    expect(res.status).toBe(200);
    const saved = await userStore.getProgress(aliceId, 'doc1');
    expect(saved).not.toBeNull();
    expect(saved!.percentage).toBe(0.25);
  });

  it('overwrites an existing progress record', async () => {
    await userStore.saveProgress(aliceId, {
      document: 'doc1',
      progress: '/p[1]',
      percentage: 0.5,
      device: 'Kobo',
      device_id: 'd1',
    });
    const token = await loginAlice();
    const res = await request(app)
      .put('/api/my/progress/doc1')
      .set(...bearer(token))
      .send({ currentChapter: 10, percentage: 0.75 });
    expect(res.status).toBe(200);
    expect((await userStore.getProgress(aliceId, 'doc1'))!.percentage).toBe(0.75);
  });

  it('saves device and device_id when provided', async () => {
    const token = await loginAlice();
    const res = await request(app)
      .put('/api/my/progress/doc1')
      .set(...bearer(token))
      .send({ currentChapter: 5, percentage: 0.25, device: 'Web', device_id: 'test-uuid' });
    expect(res.status).toBe(200);
    const saved = await userStore.getProgress(aliceId, 'doc1');
    expect(saved!.device).toBe('Web');
    expect(saved!.device_id).toBe('test-uuid');
  });

  it('defaults device to "Web" when not provided', async () => {
    const token = await loginAlice();
    await request(app)
      .put('/api/my/progress/doc1')
      .send({ currentChapter: 5, percentage: 0.25 })
      .set(...bearer(token));
    expect((await userStore.getProgress(aliceId, 'doc1'))!.device).toBe('Web');
  });

  it('synthesises an EPUB CFI when the book has a chapterSpineMap', async () => {
    await bookStore.addBook(aliceOwner, 'cfidoc', stage('cfidoc'), {
      ...FAKE_META,
      chapterCount: 10,
      chapterSpineMap: [1, 2, 3, 4, 5, 6, 7, 8, 9, 10],
    });
    const token = await loginAlice();
    const res = await request(app)
      .put('/api/my/progress/cfidoc')
      .set(...bearer(token))
      .send({ currentChapter: 3, percentage: 0.3 });
    expect(res.status).toBe(200);
    // chapterSpineMap[2] = 3, so spineIndex = 3, CFI n = 3*2+2 = 8
    expect((await userStore.getProgress(aliceId, 'cfidoc'))!.progress).toBe(
      'EPUB_CFI(/6/8!/4/2:0)'
    );
  });

  it('returns 401 when the token has no userId (non-admin)', async () => {
    const token = signAccessToken(jwtSecret, {
      username: 'alice',
      isAdmin: false,
      mustChangePassword: false,
    });
    const res = await request(app)
      .put('/api/my/progress/doc1')
      .set(...bearer(token))
      .send({ currentChapter: 5, percentage: 0.25 });
    expect(res.status).toBe(401);
    expect(res.body).toEqual({ error: 'Session expired. Please log in again.' });
  });
});

describe('PATCH /api/books/:id/metadata', () => {
  let bookId: string;

  beforeEach(async () => {
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
    fs.mkdirSync(path.join(booksDir, 'alice'), { recursive: true });
    const epubPath = path.join(booksDir, 'alice', 'edit-test.epub');
    fs.writeFileSync(epubPath, zip.toBuffer());
    await bookStore.scan(aliceOwner); // import the file into the DB
    bookId = (await bookStore.listBooks(aliceOwner))[0].id;
  });

  it('lets a regular user edit metadata in their own library', async () => {
    const token = await loginAlice();
    const res = await request(app)
      .patch(`/api/books/${bookId}/metadata`)
      .field('title', 'New')
      .set(...bearer(token));
    expect(res.status).toBe(200);
    expect(res.body.title).toBe('New');
  });

  it('returns 404 for unknown book id', async () => {
    const token = await loginAlice();
    const res = await request(app)
      .patch('/api/books/doesnotexist/metadata')
      .field('title', 'New')
      .set(...bearer(token));
    expect(res.status).toBe(404);
  });

  it('returns 401 without a token', async () => {
    const res = await request(app).patch(`/api/books/${bookId}/metadata`).field('title', 'New');
    expect(res.status).toBe(401);
  });

  it('updates title and returns the updated book', async () => {
    const token = await loginAlice();
    const res = await request(app)
      .patch(`/api/books/${bookId}/metadata`)
      .field('title', 'Updated Title')
      .set(...bearer(token));
    expect(res.status).toBe(200);
    expect(res.body.title).toBe('Updated Title');
    expect(res.body.path).toBeUndefined(); // path must not be exposed
    expect(res.body.chapterSpineMap).toBeUndefined();
    // Verify the returned book ID is now in the DB (ID may have shifted)
    const newId: string = res.body.id;
    expect(await bookStore.getBookById(aliceOwner, newId)).not.toBeNull();
    expect((await bookStore.getBookById(aliceOwner, newId))!.title).toBe('Updated Title');
  });

  it('updates cover when image file is attached', async () => {
    const token = await loginAlice();
    const coverBytes = Buffer.from('fake-png-cover');
    const res = await request(app)
      .patch(`/api/books/${bookId}/metadata`)
      .set(...bearer(token))
      .attach('cover', coverBytes, { filename: 'cover.png', contentType: 'image/png' });
    expect(res.status).toBe(200);
    const newId: string = res.body.id;
    expect(res.body.hasCover).toBe(true);
    // Verify cover is stored in DB
    const cover = await bookStore.getCover(aliceOwner.userId, newId);
    expect(cover).not.toBeNull();
    expect(Buffer.from(cover!.data)).toEqual(coverBytes);
  });

  it('enqueues thumbnails after metadata update', async () => {
    const token = await loginAlice();
    (mockThumbnailQueue.enqueue as jest.Mock).mockClear();
    await request(app)
      .patch(`/api/books/${bookId}/metadata`)
      .field('title', 'Updated')
      .set(...bearer(token));
    expect(mockThumbnailQueue.enqueue).toHaveBeenCalledTimes(1);
  });
});

describe('GET /api/config', () => {
  it('returns 401 without a token', async () => {
    const res = await request(app).get('/api/config');
    expect(res.status).toBe(401);
  });

  it('returns maxConcurrentUploads for authenticated user', async () => {
    const token = await loginAdmin();
    const res = await request(app)
      .get('/api/config')
      .set(...bearer(token));
    expect(res.status).toBe(200);
    expect(res.body).toEqual({ maxConcurrentUploads: 3 });
  });

  it('returns maxConcurrentUploads for regular user', async () => {
    const token = await loginAlice();
    const res = await request(app)
      .get('/api/config')
      .set(...bearer(token));
    expect(res.status).toBe(200);
    expect(res.body).toEqual({ maxConcurrentUploads: 3 });
  });
});

describe('PATCH /api/my/password', () => {
  it('returns 401 without a token', async () => {
    const res = await request(app)
      .patch('/api/my/password')
      .send({ currentPassword: 'alicepass', newPassword: 'newpass' });
    expect(res.status).toBe(401);
  });

  it('returns 403 for admin session', async () => {
    const token = await loginAdmin();
    const res = await request(app)
      .patch('/api/my/password')
      .set(...bearer(token))
      .send({ currentPassword: 'pass', newPassword: 'newpass' });
    expect(res.status).toBe(403);
  });

  it('returns 400 when currentPassword is missing', async () => {
    const token = await loginAlice();
    const res = await request(app)
      .patch('/api/my/password')
      .send({ newPassword: 'newpass' })
      .set(...bearer(token));
    expect(res.status).toBe(400);
    expect(res.body.error).toBe('Current and new password are required');
  });

  it('returns 400 when newPassword is missing', async () => {
    const token = await loginAlice();
    const res = await request(app)
      .patch('/api/my/password')
      .send({ currentPassword: 'alicepass' })
      .set(...bearer(token));
    expect(res.status).toBe(400);
    expect(res.body.error).toBe('Current and new password are required');
  });

  it('returns 401 when currentPassword is wrong', async () => {
    const token = await loginAlice();
    const res = await request(app)
      .patch('/api/my/password')
      .set(...bearer(token))
      .send({ currentPassword: 'wrongpass', newPassword: 'newpass' });
    expect(res.status).toBe(401);
    expect(res.body.error).toBe('Current password is incorrect');
  });

  it('changes the password and returns 200 with a fresh access token', async () => {
    const token = await loginAlice();
    const res = await request(app)
      .patch('/api/my/password')
      .set(...bearer(token))
      .send({ currentPassword: 'alicepass', newPassword: 'newpass123' });
    expect(res.status).toBe(200);
    expect(res.body.accessToken).toEqual(expect.any(String));
    const decoded = verifyAccessToken(jwtSecret, res.body.accessToken as string);
    expect(decoded?.mustChangePassword).toBe(false);
    expect(await userStore.validateUser('alice', 'newpass123')).toBeTruthy();
    expect(await userStore.validateUser('alice', 'alicepass')).toBe(false);
  });
});

describe('GET /api/my/sync-password', () => {
  it('returns syncPassword for authenticated non-admin user', async () => {
    const token = await loginAlice();
    const res = await request(app)
      .get('/api/my/sync-password')
      .set(...bearer(token));
    expect(res.status).toBe(200);
    expect(typeof res.body.syncPassword).toBe('string');
    expect(res.body.syncPassword.split(' ')).toHaveLength(2);
  });

  it('returns 401 without a token', async () => {
    const res = await request(app).get('/api/my/sync-password');
    expect(res.status).toBe(401);
  });

  it('returns 403 for admin user', async () => {
    const token = await loginAdmin();
    const res = await request(app)
      .get('/api/my/sync-password')
      .set(...bearer(token));
    expect(res.status).toBe(403);
  });
});

describe('POST /api/my/sync-password/regenerate', () => {
  it('returns a new syncPassword', async () => {
    const token = await loginAlice();
    const res = await request(app)
      .post('/api/my/sync-password/regenerate')
      .set(...bearer(token));
    expect(res.status).toBe(200);
    expect(typeof res.body.syncPassword).toBe('string');
    expect(res.body.syncPassword.split(' ')).toHaveLength(2);
  });

  it('returns 403 for admin user', async () => {
    const token = await loginAdmin();
    const res = await request(app)
      .post('/api/my/sync-password/regenerate')
      .set(...bearer(token));
    expect(res.status).toBe(403);
  });
});

describe('per-user library authorization', () => {
  let aliceToken: string;
  let bobToken: string;
  let aliceBookId: string;

  beforeEach(async () => {
    // alice already exists (created in the outer beforeEach); add a second user bob.
    await userStore.createUser('bob', await UserStore.hashLoginPassword('bobpass'));

    aliceToken = await loginAlice();
    const bobRes = await request(app)
      .post('/api/login')
      .send('username=bob&password=bobpass')
      .set('Content-Type', 'application/x-www-form-urlencoded');
    bobToken = (bobRes.body as { accessToken: string }).accessToken;

    // alice uploads a book into her own library.
    const epubBuf = makeEpub({ title: 'Alice Book', author: 'Alice' });
    await request(app)
      .post('/api/books/upload')
      .attach('files', epubBuf, 'alice-book.epub')
      .set(...bearer(aliceToken));
    aliceBookId = (await bookStore.listBooks(aliceOwner))[0].id;
  });

  it("user A cannot see user B's book", async () => {
    const res = await request(app)
      .get(`/api/books/${aliceBookId}`)
      .set(...bearer(bobToken));
    expect(res.status).toBe(404);
  });

  it("user A cannot delete user B's book", async () => {
    const res = await request(app)
      .delete(`/api/books/${aliceBookId}`)
      .set(...bearer(bobToken));
    expect(res.status).toBe(404);
  });

  it('non-admin sending ?user= gets 403', async () => {
    const res = await request(app)
      .get('/api/books?user=alice')
      .set(...bearer(bobToken));
    expect(res.status).toBe(403);
  });

  it('admin without ?user= gets 400', async () => {
    const token = await loginAdmin();
    const res = await request(app)
      .get('/api/books')
      .set(...bearer(token));
    expect(res.status).toBe(400);
  });

  it('admin with ?user= operates on the target library', async () => {
    const token = await loginAdmin();
    const res = await request(app)
      .get('/api/books?user=alice')
      .set(...bearer(token));
    expect(res.status).toBe(200);
    expect(res.body.map((b: { id: string }) => b.id)).toContain(aliceBookId);
  });

  it('admin targeting an unknown user gets 404', async () => {
    const token = await loginAdmin();
    const res = await request(app)
      .get('/api/books?user=nobody')
      .set(...bearer(token));
    expect(res.status).toBe(404);
  });

  it('two users can own the same epub without conflict', async () => {
    const epubBuf = makeEpub({ title: 'Alice Book', author: 'Alice' });
    const res = await request(app)
      .post('/api/books/upload')
      .attach('files', epubBuf, 'same-book.epub')
      .set(...bearer(bobToken));
    expect(res.status).toBe(200);
  });
});

describe('SPA routes serve index.html', () => {
  it('GET /books/:id returns 200 with HTML', async () => {
    const token = await loginAdmin();
    const res = await request(app)
      .get('/books/someid')
      .set(...bearer(token));
    expect(res.status).toBe(200);
    expect(res.text).toContain('<!DOCTYPE html>');
  });

  it('GET /books/:id/edit returns 200 with HTML', async () => {
    const token = await loginAdmin();
    const res = await request(app)
      .get('/books/someid/edit')
      .set(...bearer(token));
    expect(res.status).toBe(200);
    expect(res.text).toContain('<!DOCTYPE html>');
  });

  it('GET /series/:name returns 200 with HTML', async () => {
    const token = await loginAdmin();
    const res = await request(app)
      .get('/series/My%20Series')
      .set(...bearer(token));
    expect(res.status).toBe(200);
    expect(res.text).toContain('<!DOCTYPE html>');
  });

  it('serves SPA routes without auth', async () => {
    const res = await request(app).get('/books/someid');
    expect(res.status).toBe(200);
    expect(res.text).toContain('<!DOCTYPE html>');
  });

  it('GET /upload returns 200 with HTML', async () => {
    const token = await loginAdmin();
    const res = await request(app)
      .get('/upload')
      .set(...bearer(token));
    expect(res.status).toBe(200);
    expect(res.text).toContain('<!DOCTYPE html>');
  });

  it('GET /upload serves the SPA without auth', async () => {
    const res = await request(app).get('/upload');
    expect(res.status).toBe(200);
    expect(res.text).toContain('<!DOCTYPE html>');
  });
});

describe('passwordChangeGate middleware', () => {
  async function resetAndLoginAlice(): Promise<{ token: string; newPassword: string }> {
    const newPassword = await userStore.resetPassword('alice');
    const res = await request(app)
      .post('/api/login')
      .send(new URLSearchParams({ username: 'alice', password: newPassword! }).toString())
      .set('Content-Type', 'application/x-www-form-urlencoded');
    return { token: (res.body as { accessToken: string }).accessToken, newPassword: newPassword! };
  }

  it('blocks other /api/* routes with 403 when mustChangePassword is true', async () => {
    const { token } = await resetAndLoginAlice();
    const res = await request(app)
      .get('/api/books')
      .set(...bearer(token));
    expect(res.status).toBe(403);
    expect(res.body.error).toBe('Password change required');
  });

  it('signs a token with mustChangePassword true after a reset', async () => {
    const { token } = await resetAndLoginAlice();
    const decoded = verifyAccessToken(jwtSecret, token);
    expect(decoded?.mustChangePassword).toBe(true);
  });

  it('allows non-API routes (SPA) when mustChangePassword is true', async () => {
    const { token } = await resetAndLoginAlice();
    const res = await request(app)
      .get('/library')
      .set(...bearer(token));
    expect(res.status).toBe(200);
    expect(res.text).toContain('<!DOCTYPE html>');
  });

  it('clears the flag after PATCH /api/my/password succeeds, allowing other routes again', async () => {
    const { token, newPassword } = await resetAndLoginAlice();

    const changeRes = await request(app)
      .patch('/api/my/password')
      .set(...bearer(token))
      .send({ currentPassword: newPassword, newPassword: 'brandnewpass' });
    expect(changeRes.status).toBe(200);

    const newToken = (changeRes.body as { accessToken: string }).accessToken;
    expect(verifyAccessToken(jwtSecret, newToken)?.mustChangePassword).toBe(false);

    const booksRes = await request(app)
      .get('/api/books')
      .set(...bearer(newToken));
    expect(booksRes.status).toBe(200);
  });
});

describe('POST /api/auth/refresh', () => {
  it('rotates the refresh token and returns a new access token', async () => {
    const agent = request.agent(app);
    await agent
      .post('/api/login')
      .send('username=alice&password=alicepass')
      .set('Content-Type', 'application/x-www-form-urlencoded');

    const first = await agent.post('/api/auth/refresh');
    expect(first.status).toBe(200);
    expect(first.body.accessToken).toEqual(expect.any(String));

    const second = await agent.post('/api/auth/refresh');
    expect(second.status).toBe(200); // new cookie from rotation works
  });

  it('rejects a reused (rotated-out) refresh token', async () => {
    const agent = request.agent(app);
    const login = await agent
      .post('/api/login')
      .send('username=alice&password=alicepass')
      .set('Content-Type', 'application/x-www-form-urlencoded');
    const originalCookie = login.headers['set-cookie']![0].split(';')[0];

    await agent.post('/api/auth/refresh'); // rotates, old token now dead

    const res = await request(app).post('/api/auth/refresh').set('Cookie', originalCookie);
    expect(res.status).toBe(401);
  });

  it('rejects when there is no cookie', async () => {
    const res = await request(app).post('/api/auth/refresh');
    expect(res.status).toBe(401);
  });

  it('rejects when the user has been deleted', async () => {
    const agent = request.agent(app);
    await agent
      .post('/api/login')
      .send('username=alice&password=alicepass')
      .set('Content-Type', 'application/x-www-form-urlencoded');
    await userStore.deleteUser('alice');
    const res = await agent.post('/api/auth/refresh');
    expect(res.status).toBe(401);
  });

  it('works for the config admin', async () => {
    const agent = request.agent(app);
    await agent
      .post('/api/login')
      .send('username=admin&password=pass')
      .set('Content-Type', 'application/x-www-form-urlencoded');
    const res = await agent.post('/api/auth/refresh');
    expect(res.status).toBe(200);
  });
});

describe('POST /api/auth/logout', () => {
  it('revokes the refresh token and clears the cookie', async () => {
    const agent = request.agent(app);
    await agent
      .post('/api/login')
      .send('username=alice&password=alicepass')
      .set('Content-Type', 'application/x-www-form-urlencoded');

    const res = await agent.post('/api/auth/logout');
    expect(res.status).toBe(204);

    const refresh = await agent.post('/api/auth/refresh');
    expect(refresh.status).toBe(401);
  });

  it('returns 204 even without a cookie', async () => {
    const res = await request(app).post('/api/auth/logout');
    expect(res.status).toBe(204);
  });
});

describe('password change revokes refresh tokens', () => {
  it('old refresh cookies stop working after a password change', async () => {
    const agent = request.agent(app);
    const login = await agent
      .post('/api/login')
      .send('username=alice&password=alicepass')
      .set('Content-Type', 'application/x-www-form-urlencoded');
    const token = (login.body as { accessToken: string }).accessToken;

    // Second session whose refresh token should be revoked
    const otherAgent = request.agent(app);
    await otherAgent
      .post('/api/login')
      .send('username=alice&password=alicepass')
      .set('Content-Type', 'application/x-www-form-urlencoded');

    const change = await agent
      .patch('/api/my/password')
      .set(...bearer(token))
      .send({ currentPassword: 'alicepass', newPassword: 'newpass123' });
    expect(change.status).toBe(200);
    expect(change.body.accessToken).toEqual(expect.any(String));

    const res = await otherAgent.post('/api/auth/refresh');
    expect(res.status).toBe(401);
  });
});
