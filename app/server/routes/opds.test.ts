import * as os from 'os';
import * as path from 'path';
import * as fs from 'fs';
import request from 'supertest';
import express from 'express';
import { PrismaClient } from '@prisma/client';
import { PrismaBetterSqlite3 } from '@prisma/adapter-better-sqlite3';
import { runMigrations } from '../db/migrate';
import { BookStore } from '../services/book-store';
import { UserStore } from '../services/user-store';
import { DeviceStore } from '../services/device-store';
import { EditionStore } from '../services/edition-store';
import { createOpdsRouter } from './opds';
import { EpubMeta, Owner } from '../types';
import { ValidationThreshold } from '@korzun/epubcheck-ts';

jest.mock('../logger');

const FAKE_META: EpubMeta = {
  title: 'My Book',
  author: 'Test Author',
  description: '',
  publisher: '',
  series: '',
  seriesIndex: 0,
  titleSort: '',
  authorSort: '',
  publishDate: '',
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

let booksDir: string;
let prisma: PrismaClient;
let bookStore: BookStore;
let userStore: UserStore;
let app: express.Express;
let dbPath: string;
let alice: Owner;
let bob: Owner;

// OPDS uses HTTP Basic Auth — password is sent plaintext (RFC 7617).
function basicAuth(username: string, password: string) {
  const encoded = Buffer.from(`${username}:${password}`).toString('base64');
  return { Authorization: `Basic ${encoded}` };
}

beforeEach(async () => {
  booksDir = fs.mkdtempSync(path.join(os.tmpdir(), 'bookplate-opds-'));
  dbPath = path.join(
    os.tmpdir(),
    `test-${Date.now()}-${Math.random().toString(36).slice(2)}.sqlite`
  );
  const adapter = new PrismaBetterSqlite3({ url: `file:${dbPath}` });
  prisma = new PrismaClient({ adapter } as ConstructorParameters<typeof PrismaClient>[0]);
  await runMigrations(prisma, booksDir);
  bookStore = new BookStore(booksDir, prisma);
  userStore = new UserStore(prisma);
  // Register a test user with syncPassword 'secret' so OPDS Basic Auth works.
  await userStore.createUser('alice', null, 'secret');
  const aliceId = await userStore.getUserIdByUsername('alice');
  alice = { userId: aliceId!, username: 'alice' };
  await userStore.createUser('bob', null, 'bobsecret');
  const bobId = await userStore.getUserIdByUsername('bob');
  bob = { userId: bobId!, username: 'bob' };
  app = express();
  app.use('/opds', createOpdsRouter(bookStore, userStore, [60, 170]));
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

describe('GET /opds/', () => {
  it('returns 401 without credentials', async () => {
    const res = await request(app).get('/opds/');
    expect(res.status).toBe(401);
  });

  it('returns 401 with wrong password', async () => {
    const res = await request(app).get('/opds/').set(basicAuth('alice', 'wrong'));
    expect(res.status).toBe(401);
  });

  it('returns 401 for unknown user', async () => {
    const res = await request(app).get('/opds/').set(basicAuth('nobody', 'secret'));
    expect(res.status).toBe(401);
  });

  it('returns 200 with valid credentials', async () => {
    const res = await request(app).get('/opds/').set(basicAuth('alice', 'secret'));
    expect(res.status).toBe(200);
    expect(res.headers['content-type']).toMatch(/atom\+xml/);
  });

  it('returns valid XML containing a link to /opds/books', async () => {
    const res = await request(app).get('/opds/').set(basicAuth('alice', 'secret'));
    expect(res.text).toContain('/opds/books');
    expect(res.text).toContain('<?xml');
  });

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
});

describe('GET /opds/books', () => {
  it('returns an empty feed when no books exist', async () => {
    const res = await request(app).get('/opds/books').set(basicAuth('alice', 'secret'));
    expect(res.status).toBe(200);
    expect(res.text).toContain('<feed');
  });

  it('includes an entry for each book', async () => {
    await bookStore.addBook(alice, 'book1', stage('book1'), { ...FAKE_META, title: 'My Book' });
    const res = await request(app).get('/opds/books').set(basicAuth('alice', 'secret'));
    expect(res.text).toContain('My Book');
    expect(res.text).toContain('opds-spec.org/acquisition');
  });

  it('escapes special characters in titles', async () => {
    await bookStore.addBook(alice, 'book2', stage('book2'), {
      ...FAKE_META,
      title: 'A & B <Test>',
    });
    const res = await request(app).get('/opds/books').set(basicAuth('alice', 'secret'));
    expect(res.text).toContain('A &amp; B &lt;Test&gt;');
    expect(res.text).not.toContain('<Test>');
  });

  it('includes author in book entry', async () => {
    await bookStore.addBook(alice, 'book3', stage('book3'), {
      ...FAKE_META,
      author: 'Test Author',
    });
    const res = await request(app).get('/opds/books').set(basicAuth('alice', 'secret'));
    expect(res.text).toContain('<author><name>Test Author</name></author>');
  });

  it('includes summary (description) in book entry', async () => {
    await bookStore.addBook(alice, 'book4', stage('book4'), {
      ...FAKE_META,
      description: 'A great book about things.',
    });
    const res = await request(app).get('/opds/books').set(basicAuth('alice', 'secret'));
    expect(res.text).toContain('<summary>A great book about things.</summary>');
  });

  it('includes cover link when hasCover is true', async () => {
    const coverData = Buffer.from('fake-cover-data');
    await bookStore.addBook(alice, 'bookcover', stage('bookcover'), {
      ...FAKE_META,
      coverData,
      coverMime: 'image/jpeg',
    });
    const res = await request(app).get('/opds/books').set(basicAuth('alice', 'secret'));
    expect(res.text).toContain('rel="http://opds-spec.org/image"');
    expect(res.text).toContain('/opds/books/bookcover/cover');
    // The cover href carries a cache-busting version token so e-readers can cache it.
    expect(res.text).toMatch(/\/opds\/books\/bookcover\/cover\?v=\d+/);
  });

  it('does not include cover link when hasCover is false', async () => {
    await bookStore.addBook(alice, 'booknocover', stage('booknocover'), {
      ...FAKE_META,
      coverData: null,
      coverMime: null,
    });
    const res = await request(app).get('/opds/books').set(basicAuth('alice', 'secret'));
    expect(res.text).not.toContain('rel="http://opds-spec.org/image"');
  });
});

describe('GET /opds/books/:id/download', () => {
  it('returns 404 for unknown book id', async () => {
    const res = await request(app)
      .get('/opds/books/deadbeefdeadbeef/download')
      .set(basicAuth('alice', 'secret'));
    expect(res.status).toBe(404);
  });

  it('returns the file with correct content type', async () => {
    await bookStore.addBook(alice, 'bookdl', stage('bookdl', 'epub-content'), FAKE_META);
    const res = await request(app)
      .get('/opds/books/bookdl/download')
      .set(basicAuth('alice', 'secret'));
    expect(res.status).toBe(200);
    expect(res.headers['content-type']).toMatch(/epub/);
  });

  it('uses the computed download name in Content-Disposition', async () => {
    await bookStore.addBook(alice, 'lotr1', stage('lotr1', 'epub-content'), {
      ...FAKE_META,
      title: 'The Fellowship of the Ring',
      author: 'J.R.R. Tolkien',
      series: 'The Lord of the Rings',
      seriesIndex: 1,
    });

    const res = await request(app)
      .get('/opds/books/lotr1/download')
      .set(basicAuth('alice', 'secret'));

    expect(res.status).toBe(200);
    expect(res.headers['content-disposition']).toMatch(
      /J\.R\.R\._Tolkien-The_Lord_of_the_Rings-1-The_Fellowship_of_the_Ring\.epub/
    );
  });
});

describe('GET /opds/books/:id/devices/:slug/download', () => {
  it('serves a generated edition for a device download link', async () => {
    const bookId = 'devicedl1';
    await bookStore.addBook(alice, bookId, stage(bookId, 'epub-content'), FAKE_META);

    const deviceStore = new DeviceStore(prisma);
    const device = await deviceStore.create({
      name: 'Kindle',
      coverWidth: null,
      coverHeight: null,
      coverFit: 'contain',
      bwCover: false,
      simplify: true,
    });
    const editionsRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'ed-'));
    const editionStore = new EditionStore(editionsRoot, prisma, {
      buildEdition: async () => Buffer.from('EDITION'),
      assertValidEpub: async () => ({}) as never,
      partialMD5: () => 'edhash',
    });
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

    const res = await request(app2)
      .get(`/opds/books/${bookId}/devices/${device.slug}/download`)
      .set(basicAuth('alice', 'secret'));
    expect(res.status).toBe(200);
    expect(res.headers['content-type']).toContain('application/epub+zip');
    expect(res.text).toBe('EDITION');
  });

  it('404s for an unknown device slug', async () => {
    const bookId = 'devicedl2';
    await bookStore.addBook(alice, bookId, stage(bookId, 'epub-content'), FAKE_META);
    // app built without device/edition stores
    const res = await request(app)
      .get(`/opds/books/${bookId}/devices/nope/download`)
      .set(basicAuth('alice', 'secret'));
    expect(res.status).toBe(404);
  });
});

describe('GET /opds/books/:id/cover', () => {
  it('returns 404 when book does not exist', async () => {
    const res = await request(app)
      .get('/opds/books/nonexistent/cover')
      .set(basicAuth('alice', 'secret'));
    expect(res.status).toBe(404);
  });

  it('returns 404 when book exists but has no cover', async () => {
    await bookStore.addBook(alice, 'booknocover2', stage('booknocover2'), {
      ...FAKE_META,
      coverData: null,
      coverMime: null,
    });
    const res = await request(app)
      .get('/opds/books/booknocover2/cover')
      .set(basicAuth('alice', 'secret'));
    expect(res.status).toBe(404);
  });

  it('returns cover image with correct content type', async () => {
    const coverData = Buffer.from('fake-jpeg-data');
    await bookStore.addBook(alice, 'bookcoverimg', stage('bookcoverimg'), {
      ...FAKE_META,
      coverData,
      coverMime: 'image/jpeg',
    });
    const res = await request(app)
      .get('/opds/books/bookcoverimg/cover')
      .set(basicAuth('alice', 'secret'));
    expect(res.status).toBe(200);
    expect(res.headers['content-type']).toMatch(/image\/jpeg/);
    expect(res.body).toEqual(coverData);
  });

  it('returns full cover when book has one', async () => {
    const coverBuf = Buffer.from('opds-cover-data');
    await bookStore.addBook(alice, 'opds1', stage('opds1'), {
      ...FAKE_META,
      coverData: coverBuf,
      coverMime: 'image/jpeg',
    });
    const res = await request(app).get('/opds/books/opds1/cover').set(basicAuth('alice', 'secret'));
    expect(res.status).toBe(200);
    expect(Buffer.from(res.body).toString()).toBe('opds-cover-data');
  });

  it('returns thumbnail when ?width= matches', async () => {
    const thumbBuf = Buffer.from('opds-thumb');
    await bookStore.addBook(alice, 'opds2', stage('opds2'), {
      ...FAKE_META,
      coverData: Buffer.from('orig'),
      coverMime: 'image/jpeg',
    });
    await bookStore.saveThumbnail(alice.userId, 'opds2', 60, thumbBuf, 'image/jpeg');
    const res = await request(app)
      .get('/opds/books/opds2/cover?width=60')
      .set(basicAuth('alice', 'secret'));
    expect(res.status).toBe(200);
    expect(Buffer.from(res.body).toString()).toBe('opds-thumb');
  });

  it('falls back to full-size when thumbnail missing', async () => {
    const coverBuf = Buffer.from('fallback-cover');
    await bookStore.addBook(alice, 'opds3', stage('opds3'), {
      ...FAKE_META,
      coverData: coverBuf,
      coverMime: 'image/jpeg',
    });
    const res = await request(app)
      .get('/opds/books/opds3/cover?width=60')
      .set(basicAuth('alice', 'secret'));
    expect(res.status).toBe(200);
    expect(Buffer.from(res.body).toString()).toBe('fallback-cover');
  });

  it('sets an immutable cache header and ETag when a version token is present', async () => {
    await bookStore.addBook(alice, 'opdscache', stage('opdscache'), {
      ...FAKE_META,
      coverData: Buffer.from('opds-cacheable'),
      coverMime: 'image/jpeg',
    });
    const res = await request(app)
      .get('/opds/books/opdscache/cover?v=999')
      .set(basicAuth('alice', 'secret'));
    expect(res.status).toBe(200);
    expect(res.headers['cache-control']).toBe('private, max-age=31536000, immutable');
    expect(res.headers['etag']).toBeTruthy();
  });
});

describe('Cross-user library isolation', () => {
  it("alice's feed contains her book and not bob's book", async () => {
    await bookStore.addBook(alice, 'alice-book', stage('alice-book'), {
      ...FAKE_META,
      title: 'Alice Book',
    });
    await bookStore.addBook(bob, 'bob-book', stage('bob-book'), {
      ...FAKE_META,
      title: 'Bob Book',
    });

    const res = await request(app).get('/opds/books').set(basicAuth('alice', 'secret'));
    expect(res.status).toBe(200);
    expect(res.text).toContain('Alice Book');
    expect(res.text).not.toContain('Bob Book');
  });

  it("bob's feed contains his book and not alice's book", async () => {
    await bookStore.addBook(alice, 'alice-book2', stage('alice-book2'), {
      ...FAKE_META,
      title: 'Alice Book',
    });
    await bookStore.addBook(bob, 'bob-book2', stage('bob-book2'), {
      ...FAKE_META,
      title: 'Bob Book',
    });

    const res = await request(app).get('/opds/books').set(basicAuth('bob', 'bobsecret'));
    expect(res.status).toBe(200);
    expect(res.text).toContain('Bob Book');
    expect(res.text).not.toContain('Alice Book');
  });

  it("alice cannot download bob's book — returns 404", async () => {
    await bookStore.addBook(bob, 'bob-exclusive', stage('bob-exclusive', 'epub-content'), {
      ...FAKE_META,
      title: 'Bob Exclusive',
    });

    const res = await request(app)
      .get('/opds/books/bob-exclusive/download')
      .set(basicAuth('alice', 'secret'));
    expect(res.status).toBe(404);
  });
});

describe('OPDS feed thumbnail link', () => {
  it('includes opds thumbnail link for books with covers', async () => {
    await bookStore.addBook(alice, 'opds4', stage('opds4'), {
      ...FAKE_META,
      coverData: Buffer.from('cover'),
      coverMime: 'image/jpeg',
    });
    const res = await request(app).get('/opds/books').set(basicAuth('alice', 'secret'));
    expect(res.text).toContain('opds-spec.org/image/thumbnail');
    expect(res.text).toContain('?width=60');
  });

  it('does not include thumbnail link for books without covers', async () => {
    await bookStore.addBook(alice, 'opds5', stage('opds5'), FAKE_META);
    const res = await request(app).get('/opds/books').set(basicAuth('alice', 'secret'));
    expect(res.text).not.toContain('opds-spec.org/image/thumbnail');
  });

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
    expect((res.text.match(/opds-spec\.org\/acquisition/g) || []).length).toBe(1);
  });
});

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
    await bookStore.addBook(alice, 'au4', stage('au4'), {
      ...FAKE_META,
      author: 'Ursula Le Guin',
      title: 'The Left Hand of Darkness',
    });
    await bookStore.addBook(alice, 'au5', stage('au5'), {
      ...FAKE_META,
      author: 'Other',
      title: 'Other Book',
    });
    const res = await request(app)
      .get('/opds/authors/Ursula%20Le%20Guin')
      .set(basicAuth('alice', 'secret'));
    expect(res.status).toBe(200);
    expect(res.text).toContain('The Left Hand of Darkness');
    expect(res.text).not.toContain('Other Book');
    expect(res.text).toContain('opds-spec.org/acquisition"');
  });

  it('returns empty acquisition feed for unknown author', async () => {
    const res = await request(app).get('/opds/authors/Nobody').set(basicAuth('alice', 'secret'));
    expect(res.status).toBe(200);
    expect(res.text).toContain('<feed');
    expect(res.text).not.toContain('<entry>');
  });

  it('escapes special characters in author names', async () => {
    await bookStore.addBook(alice, 'au6', stage('au6'), {
      ...FAKE_META,
      author: 'Author & Co',
      title: 'Special Book',
    });
    const res = await request(app)
      .get('/opds/authors/Author%20%26%20Co')
      .set(basicAuth('alice', 'secret'));
    expect(res.status).toBe(200);
    expect(res.text).toContain('Special Book');
  });

  it("does not expose other users' books", async () => {
    await bookStore.addBook(alice, 'au7', stage('au7'), {
      ...FAKE_META,
      author: 'Shared Author',
      title: 'Alice Book',
    });
    await bookStore.addBook(bob, 'au8', stage('au8'), {
      ...FAKE_META,
      author: 'Shared Author',
      title: 'Bob Book',
    });
    const res = await request(app)
      .get('/opds/authors/Shared%20Author')
      .set(basicAuth('alice', 'secret'));
    expect(res.text).toContain('Alice Book');
    expect(res.text).not.toContain('Bob Book');
  });
});

describe('GET /opds/series', () => {
  it('returns a navigation feed with one entry per series', async () => {
    await bookStore.addBook(alice, 'sr1', stage('sr1'), {
      ...FAKE_META,
      series: 'Dune',
      seriesIndex: 1,
    });
    await bookStore.addBook(alice, 'sr2', stage('sr2'), {
      ...FAKE_META,
      series: 'Foundation',
      seriesIndex: 1,
    });
    const res = await request(app).get('/opds/series').set(basicAuth('alice', 'secret'));
    expect(res.status).toBe(200);
    expect(res.headers['content-type']).toMatch(/atom\+xml/);
    expect(res.text).toContain('Dune');
    expect(res.text).toContain('Foundation');
  });

  it('returns 401 without credentials', async () => {
    const res = await request(app).get('/opds/series');
    expect(res.status).toBe(401);
  });
});

describe('GET /opds/series/:seriesId', () => {
  it('returns an acquisition feed with books for the series ordered by seriesIndex', async () => {
    await bookStore.addBook(alice, 'sr3', stage('sr3'), {
      ...FAKE_META,
      series: 'The Expanse',
      seriesIndex: 2,
      title: "Caliban's War",
    });
    await bookStore.addBook(alice, 'sr4', stage('sr4'), {
      ...FAKE_META,
      series: 'The Expanse',
      seriesIndex: 1,
      title: 'Leviathan Wakes',
    });
    await bookStore.addBook(alice, 'sr5', stage('sr5'), {
      ...FAKE_META,
      series: 'Other',
      seriesIndex: 1,
      title: 'Other Book',
    });
    const seriesList = await bookStore.listSeries(alice);
    const expanse = seriesList.find((s) => s.name === 'The Expanse')!;
    const res = await request(app)
      .get(`/opds/series/${expanse.id}`)
      .set(basicAuth('alice', 'secret'));
    expect(res.status).toBe(200);
    expect(res.text).toContain('Leviathan Wakes');
    expect(res.text).toContain("Caliban's War");
    expect(res.text).not.toContain('Other Book');
    // Verify order: Leviathan Wakes (index 1) appears before Caliban's War (index 2)
    expect(res.text.indexOf('Leviathan Wakes')).toBeLessThan(res.text.indexOf("Caliban's War"));
    expect(res.text).toContain('opds-spec.org/acquisition"');
  });

  it('returns empty acquisition feed for unknown seriesId', async () => {
    const res = await request(app)
      .get('/opds/series/00000000-0000-0000-0000-000000000000')
      .set(basicAuth('alice', 'secret'));
    expect(res.status).toBe(200);
    expect(res.text).toContain('<feed');
    expect(res.text).not.toContain('<entry>');
  });

  it("does not expose other users' books", async () => {
    await bookStore.addBook(alice, 'sr6', stage('sr6'), {
      ...FAKE_META,
      series: 'Shared Series',
      seriesIndex: 1,
      title: 'Alice Book',
    });
    await bookStore.addBook(bob, 'sr7', stage('sr7'), {
      ...FAKE_META,
      series: 'Shared Series',
      seriesIndex: 1,
      title: 'Bob Book',
    });
    const aliceSeries = await bookStore.listSeries(alice);
    const shared = aliceSeries.find((s) => s.name === 'Shared Series')!;
    const res = await request(app)
      .get(`/opds/series/${shared.id}`)
      .set(basicAuth('alice', 'secret'));
    expect(res.text).toContain('Alice Book');
    expect(res.text).not.toContain('Bob Book');
  });
});

describe('GET /opds/subjects', () => {
  it('returns a navigation feed with one entry per distinct subject', async () => {
    await bookStore.addBook(alice, 'su1', stage('su1'), {
      ...FAKE_META,
      subjects: ['Fantasy', 'Adventure'],
    });
    await bookStore.addBook(alice, 'su2', stage('su2'), {
      ...FAKE_META,
      subjects: ['Fantasy', 'Science Fiction'],
    });
    const res = await request(app).get('/opds/subjects').set(basicAuth('alice', 'secret'));
    expect(res.status).toBe(200);
    expect(res.headers['content-type']).toMatch(/atom\+xml/);
    expect(res.text).toContain('Fantasy');
    expect(res.text).toContain('Adventure');
    expect(res.text).toContain('Science Fiction');
    // Fantasy appears once as an entry title despite being in two books
    const matches = res.text.match(/<title>Fantasy<\/title>/g) ?? [];
    expect(matches.length).toBe(1);
  });

  it('returns 401 without credentials', async () => {
    const res = await request(app).get('/opds/subjects');
    expect(res.status).toBe(401);
  });
});

describe('GET /opds/subjects/:subject', () => {
  it('returns an acquisition feed with books tagged with the subject', async () => {
    await bookStore.addBook(alice, 'su3', stage('su3'), {
      ...FAKE_META,
      title: 'Fantasy Book',
      subjects: ['Fantasy'],
    });
    await bookStore.addBook(alice, 'su4', stage('su4'), {
      ...FAKE_META,
      title: 'Sci-Fi Book',
      subjects: ['Science Fiction'],
    });
    const res = await request(app).get('/opds/subjects/Fantasy').set(basicAuth('alice', 'secret'));
    expect(res.status).toBe(200);
    expect(res.text).toContain('Fantasy Book');
    expect(res.text).not.toContain('Sci-Fi Book');
    expect(res.text).toContain('opds-spec.org/acquisition"');
  });

  it('returns empty acquisition feed for unknown subject', async () => {
    const res = await request(app)
      .get('/opds/subjects/NonExistentSubject')
      .set(basicAuth('alice', 'secret'));
    expect(res.status).toBe(200);
    expect(res.text).toContain('<feed');
    expect(res.text).not.toContain('<entry>');
  });

  it('handles URL-encoded subject names', async () => {
    await bookStore.addBook(alice, 'su5', stage('su5'), {
      ...FAKE_META,
      title: 'Space Book',
      subjects: ['Science Fiction'],
    });
    const res = await request(app)
      .get('/opds/subjects/Science%20Fiction')
      .set(basicAuth('alice', 'secret'));
    expect(res.status).toBe(200);
    expect(res.text).toContain('Space Book');
  });

  it("does not expose other users' books", async () => {
    await bookStore.addBook(alice, 'su6', stage('su6'), {
      ...FAKE_META,
      title: 'Alice Fantasy',
      subjects: ['Fantasy'],
    });
    await bookStore.addBook(bob, 'su7', stage('su7'), {
      ...FAKE_META,
      title: 'Bob Fantasy',
      subjects: ['Fantasy'],
    });
    const res = await request(app).get('/opds/subjects/Fantasy').set(basicAuth('alice', 'secret'));
    expect(res.text).toContain('Alice Fantasy');
    expect(res.text).not.toContain('Bob Fantasy');
  });
});

describe('GET /opds/status', () => {
  it('returns a navigation feed with exactly 3 entries', async () => {
    const res = await request(app).get('/opds/status').set(basicAuth('alice', 'secret'));
    expect(res.status).toBe(200);
    expect(res.headers['content-type']).toMatch(/atom\+xml/);
    expect(res.text).toContain('not-started');
    expect(res.text).toContain('in-progress');
    expect(res.text).toContain('completed');
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

  it('not-started returns books without any progress', async () => {
    await bookStore.addBook(alice, 'st1', stage('st1'), { ...FAKE_META, title: 'Unread Book' });
    await bookStore.addBook(alice, 'st2', stage('st2'), { ...FAKE_META, title: 'Started Book' });
    await setProgress(alice.userId, 'st2', 0.5);
    const res = await request(app)
      .get('/opds/status/not-started')
      .set(basicAuth('alice', 'secret'));
    expect(res.status).toBe(200);
    expect(res.text).toContain('Unread Book');
    expect(res.text).not.toContain('Started Book');
  });

  it('in-progress returns only partially read books', async () => {
    await bookStore.addBook(alice, 'st3', stage('st3'), { ...FAKE_META, title: 'Reading Now' });
    await bookStore.addBook(alice, 'st4', stage('st4'), { ...FAKE_META, title: 'Not Started' });
    await setProgress(alice.userId, 'st3', 0.4);
    const res = await request(app)
      .get('/opds/status/in-progress')
      .set(basicAuth('alice', 'secret'));
    expect(res.status).toBe(200);
    expect(res.text).toContain('Reading Now');
    expect(res.text).not.toContain('Not Started');
  });

  it('completed returns only fully read books', async () => {
    await bookStore.addBook(alice, 'st5', stage('st5'), { ...FAKE_META, title: 'Finished' });
    await bookStore.addBook(alice, 'st6', stage('st6'), { ...FAKE_META, title: 'Unfinished' });
    await setProgress(alice.userId, 'st5', 1.0);
    await setProgress(alice.userId, 'st6', 0.8);
    const res = await request(app).get('/opds/status/completed').set(basicAuth('alice', 'secret'));
    expect(res.status).toBe(200);
    expect(res.text).toContain('Finished');
    expect(res.text).not.toContain('Unfinished');
  });

  it('returns 400 for invalid status slug', async () => {
    const res = await request(app)
      .get('/opds/status/invalid-slug')
      .set(basicAuth('alice', 'secret'));
    expect(res.status).toBe(400);
  });

  it("does not expose other users' books", async () => {
    await bookStore.addBook(alice, 'st7', stage('st7'), { ...FAKE_META, title: 'Alice Book' });
    await bookStore.addBook(bob, 'st8', stage('st8'), { ...FAKE_META, title: 'Bob Book' });
    await setProgress(alice.userId, 'st7', 1.0);
    await setProgress(bob.userId, 'st8', 1.0);
    const res = await request(app).get('/opds/status/completed').set(basicAuth('alice', 'secret'));
    expect(res.text).toContain('Alice Book');
    expect(res.text).not.toContain('Bob Book');
  });
});

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

  // The device sub-router is browse-only: download and cover routes live only on the
  // base catalog. Deep paths under /opds/device/:slug fall through to a 404 rather than
  // exposing a second download surface. These lock that guarantee against future edits.
  it('404s for a download path under the device mount', async () => {
    const { app: a } = await deviceApp();
    const bookId = 'devdl404';
    await bookStore.addBook(alice, bookId, stage(bookId), FAKE_META);
    const res = await request(a)
      .get(`/opds/device/kindle/books/${bookId}/download`)
      .set(basicAuth('alice', 'secret'));
    expect(res.status).toBe(404);
  });

  it('404s for a cover path under the device mount', async () => {
    const { app: a } = await deviceApp();
    const bookId = 'devcover404';
    await bookStore.addBook(alice, bookId, stage(bookId), {
      ...FAKE_META,
      coverData: Buffer.from('cover'),
      coverMime: 'image/jpeg',
    });
    const res = await request(a)
      .get(`/opds/device/kindle/books/${bookId}/cover`)
      .set(basicAuth('alice', 'secret'));
    expect(res.status).toBe(404);
  });
});
