import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';

import { encodeGlobalID } from '@pothos/plugin-relay';
import express from 'express';
import request from 'supertest';

import { createUiRouter } from '../../../routes/ui';
import { signAccessToken } from '../../../services/jwt';
import { seedBook } from '../../../test-support/seed-book';
import { createHarness, type Harness } from '../../test-util';
import { createGraphqlHandler } from '../../yoga';

vi.mock('../../../logger');

/**
 * The test task-2's own report names explicitly: a GraphQL `harness.execute`
 * call never leaves the process, so a bug where `coverUrl` looked
 * plausible but 400ed against the real REST route (the original admin-
 * broken-URL bug this task fixes: `resolveOwner` in `routes/ui.ts` 400s an
 * admin session with no `?user=`) would sail through every other test in this
 * file's siblings. This file is the one place both transports run in the same
 * process against the same in-memory registries/`prisma`, so a URL minted by
 * GraphQL can be handed straight to `supertest` against the REST router that
 * actually serves it.
 */

let harness: Harness;
let app: express.Express;

const jwtSecret = Buffer.from('e'.repeat(64), 'hex');

const bookGlobalId = (userId: string, id: string): string =>
  encodeGlobalID('Book', JSON.stringify([userId, id]));

beforeEach(async () => {
  harness = await createHarness();

  app = express();
  app.use(
    '/graphql',
    createGraphqlHandler({
      prisma: harness.prisma,
      scanJobs: harness.scanJobs,
      thumbnails: harness.thumbnails,
      replaceStaging: harness.replaceStaging,
      config: harness.config,
      jwtSecret,
      isProduction: false,
    })
  );
  app.use(
    '/',
    createUiRouter(
      harness.editionsRoot,
      harness.config,
      harness.thumbnails,
      jwtSecret,
      harness.prisma,
      harness.replaceStaging
    )
  );
});

afterEach(async () => {
  await harness.cleanup();
});

const BOOK_ID = 'c'.repeat(32);

const seedCover = async (): Promise<void> => {
  const stagedPath = path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'url-it-')), 'staged.epub');
  fs.writeFileSync(stagedPath, 'not a real epub, addBook does not parse it');
  await seedBook(
    harness.prisma,
    { booksRoot: harness.config.booksDir },
    harness.aliceOwner,
    BOOK_ID,
    stagedPath,
    {
      title: 'Cover Fetch Test',
      titleSort: '',
      authorSort: '',
      publishDate: '',
      author: '',
      description: '',
      publisher: '',
      series: '',
      seriesIndex: 0,
      identifiers: [],
      subjects: [],
      coverData: Buffer.from('fake-jpeg-bytes'),
      coverMime: 'image/jpeg',
      chapterCount: 0,
      chapterSpineMap: [],
      chapterNames: [],
      pageCount: 0,
    }
  );
};

const coverUrlFor = async (token: string, viewerGid: string, gid: string): Promise<string> => {
  const result = await request(app)
    .post('/graphql')
    .set('Authorization', `Bearer ${token}`)
    .send({
      query: `query ($id: ID!, $bookId: ID!) {
        user(id: $id) { library { book(id: $bookId) { coverUrl } } }
      }`,
      variables: { id: viewerGid, bookId: gid },
    });
  expect(result.body.errors).toBeUndefined();
  return (result.body.data as { user: { library: { book: { coverUrl: string } } } }).user.library
    .book.coverUrl;
};

describe('Book URL fields are REST-fetchable', () => {
  // This is the test that would have caught the original bug: a `coverUrl`
  // minted for an admin session without `?user=<username>` 400s against
  // REST's `resolveOwner` (`routes/ui.ts` — an admin session has no
  // library of its own to default to). Seen-to-fail: reverting `book/
  // model.ts`'s `coverUrl` resolver to the pre-task-2 bare
  // `` `/api/books/${book.id}/cover` `` and re-running this test turns this
  // 200 into a 400 (verified manually while developing this test; not left
  // as a permanent toggle since the whole point of this suite is pinning the
  // FIXED behaviour).
  it('returns 200 for a coverUrl minted for an admin viewer', async () => {
    await seedCover();
    const adminToken = signAccessToken(jwtSecret, {
      username: 'admin',
      isAdmin: true,
      mustChangePassword: false,
    });
    const gid = bookGlobalId(harness.aliceOwner.userId, BOOK_ID);

    const coverUrl = await coverUrlFor(adminToken, harness.aliceGlobalId, gid);
    expect(coverUrl).toContain('user=alice');

    const response = await request(app).get(coverUrl).set('Authorization', `Bearer ${adminToken}`);

    expect(response.status).toBe(200);
    expect(Buffer.from(response.body as Buffer).toString()).toBe('fake-jpeg-bytes');
  });

  // Self-session companion: a coverUrl minted for alice reading her own book
  // carries no `?user=`, and REST's `resolveOwner` FORBIDS a non-admin
  // session that sends one at all — so this also proves the self-shaped URL
  // (no `user=` param) is independently fetchable, not merely that some URL
  // shape happens to work.
  it("returns 200 for a coverUrl minted for the book's own owner", async () => {
    await seedCover();
    const aliceToken = signAccessToken(jwtSecret, {
      userId: harness.aliceOwner.userId,
      username: 'alice',
      isAdmin: false,
      mustChangePassword: false,
    });
    const gid = bookGlobalId(harness.aliceOwner.userId, BOOK_ID);

    const result = await request(app)
      .post('/graphql')
      .set('Authorization', `Bearer ${aliceToken}`)
      .send({
        query: `query ($bookId: ID!) {
          viewer { library { book(id: $bookId) { coverUrl } } }
        }`,
        variables: { bookId: gid },
      });
    expect(result.body.errors).toBeUndefined();
    const coverUrl = (result.body.data as { viewer: { library: { book: { coverUrl: string } } } })
      .viewer.library.book.coverUrl;
    expect(coverUrl).not.toContain('user=');

    const response = await request(app).get(coverUrl).set('Authorization', `Bearer ${aliceToken}`);

    expect(response.status).toBe(200);
    expect(Buffer.from(response.body as Buffer).toString()).toBe('fake-jpeg-bytes');
  });
});
