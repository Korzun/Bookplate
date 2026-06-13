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
import { createOpdsRouter } from './opds';
import { EpubMeta, Owner } from '../types';

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

// OPDS uses HTTP Basic Auth — password is sent plaintext (RFC 7617).
function basicAuth(username: string, password: string) {
  const encoded = Buffer.from(`${username}:${password}`).toString('base64');
  return { Authorization: `Basic ${encoded}` };
}

beforeEach(async () => {
  booksDir = fs.mkdtempSync(path.join(os.tmpdir(), 'hass-odps-opds-'));
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
});

describe('Cross-user library isolation', () => {
  let bob: Owner;

  beforeEach(async () => {
    await userStore.createUser('bob', null, 'bobsecret');
    const bobId = await userStore.getUserIdByUsername('bob');
    bob = { userId: bobId!, username: 'bob' };
  });

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
});
