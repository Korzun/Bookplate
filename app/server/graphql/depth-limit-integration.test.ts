import { encodeGlobalID } from '@pothos/plugin-relay';
import express from 'express';
import request from 'supertest';

import { signAccessToken } from '../services/jwt';
import { MAX_DEPTH } from './depth-limit';
import { createHarness, type Harness } from './test-util';
import { createGraphqlHandler } from './yoga';

vi.mock('../logger');

const jwtSecret = Buffer.from('c'.repeat(64), 'hex');
const bookGlobalId = (userId: string, id: string): string =>
  encodeGlobalID('Book', JSON.stringify([userId, id]));

let harness: Harness;
let app: express.Express;
let bookId: string;

const aliceToken = () =>
  signAccessToken(jwtSecret, {
    userId: harness.aliceOwner.userId,
    username: 'alice',
    isAdmin: false,
    mustChangePassword: false,
  });

beforeEach(async () => {
  harness = await createHarness();
  bookId = 'd'.repeat(32);

  await harness.prisma.series.create({
    data: {
      id: 's-1',
      userId: harness.aliceOwner.userId,
      name: 'Expanse',
      sortKey: 'expanse',
      bookCount: 1,
    },
  });
  await harness.prisma.book.create({
    data: {
      userId: harness.aliceOwner.userId,
      id: bookId,
      title: 'Depth Fixture',
      seriesId: 's-1',
      seriesIndex: 1,
      size: 1,
      mtime: 1,
      addedAt: 1,
    },
  });
  await harness.prisma.progress.create({
    data: {
      userId: harness.aliceOwner.userId,
      document: bookId,
      progress: '/x',
      percentage: 0.25,
      device: 'Kobo',
      deviceId: 'dev-1',
      timestamp: 1_700_000_000,
    },
  });
  await harness.prisma.validation.create({
    data: {
      userId: harness.aliceOwner.userId,
      bookId,
      valid: true,
      threshold: 'strict',
      validatedAt: 1_700_000_000,
    },
  });

  const server = express();
  server.use(
    '/graphql',
    createGraphqlHandler({
      prisma: harness.prisma,
      stores: harness.stores,
      config: harness.config,
      jwtSecret,
      isProduction: false,
    })
  );
  app = server;
});

afterEach(async () => {
  await harness.cleanup();
});

const post = (query: string) =>
  request(app).post('/graphql').set('Authorization', `Bearer ${aliceToken()}`).send({ query });

const depthErrors = (body: { errors?: { message?: string }[] }): string[] =>
  (body.errors ?? [])
    .map((error) => error.message ?? '')
    .filter((message) => message.includes('nested too deeply'));

describe(`depth limit (MAX_DEPTH = ${MAX_DEPTH}) — real HTTP, real schema`, () => {
  // The exact calibration fixture depth-limit.ts's comment measures depth 6
  // against: entries connection, nested `... on Book { series, progress,
  // validation }`, and pageInfo. This is the "every real screen query
  // passes" half of the seen-to-fail pair below.
  it('passes the library-grid screen query', async () => {
    const GRID = `{
      viewer { library { entries(first: 20) {
        edges { node { ... on Book {
          series { id name }
          progress { percentage }
          validation { id valid }
        } } }
        pageInfo { hasNextPage endCursor }
      } } }
    }`;

    const response = await post(GRID);

    expect(depthErrors(response.body)).toEqual([]);
    expect(response.status).toBe(200);
  });

  // One hop of the `Book.series ↔ Series.books` cycle — a book detail screen
  // showing sibling books in the same series is a real, legitimate query
  // shape, not amplification. Passing here is what proves MAX_DEPTH's "+2"
  // margin buys something real, not just slack.
  it('passes one hop of Book → Series → books (a legitimate "sibling books" query)', async () => {
    const gid = bookGlobalId(harness.aliceOwner.userId, bookId);
    const ONE_HOP = `{
      viewer { library { book(id: "${gid}") {
        series { books(first: 50) { edges { node { id } } } }
      } } }
    }`;

    const response = await post(ONE_HOP);

    expect(depthErrors(response.body)).toEqual([]);
    expect(response.status).toBe(200);
  });

  // Two hops of the same cycle — the amplification shape the brief names
  // explicitly: `book { series { books { edges { node { series { books … } }
  // } } } }`. Seen-to-fail is `depth-limit.test.ts`'s pure boundary-math
  // suite (constructing this exact rejection generically); this pins the
  // real schema + real HTTP path additionally rejects the real shape a
  // client would actually send.
  it('rejects two hops of Book → Series → books, with a clear message', async () => {
    const gid = bookGlobalId(harness.aliceOwner.userId, bookId);
    const TWO_HOPS = `{
      viewer { library { book(id: "${gid}") {
        series { books(first: 50) { edges { node {
          series { books(first: 50) { edges { node { id } } } }
        } } } }
      } } }
    }`;

    const response = await post(TWO_HOPS);

    expect(response.body.data ?? null).toBeNull();
    expect(depthErrors(response.body)).toHaveLength(1);
    expect(depthErrors(response.body)[0]).toContain('Split this into smaller operations');
  });

  // Sampling of the repo's own deepest-looking existing test operations
  // (picked from series/model.test.ts and book/lineage.test.ts) — none of
  // them were written with MAX_DEPTH in mind, so this is the check that
  // calibrating the limit didn't quietly break real, already-shipped query
  // shapes.
  it('passes the deepest existing test queries in the repo', async () => {
    // series/model.test.ts: viewer→library→seriesByName→books→edges→node→title (depth 6).
    const seriesByNameBooks = await post(
      '{ viewer { library { seriesByName(name: "Expanse") { name books { edges { node { title seriesIndex } } } } } } }'
    );
    expect(depthErrors(seriesByNameBooks.body)).toEqual([]);
    expect(seriesByNameBooks.status).toBe(200);

    // book/lineage.test.ts: viewer→library→book→lineage→oldBook/newBook→id (depth 5).
    const gid = bookGlobalId(harness.aliceOwner.userId, bookId);
    const lineage = await post(
      `{ viewer { library { book(id: "${gid}") { lineage { oldId newId oldBook { id } newBook { id title } } } } } }`
    );
    expect(depthErrors(lineage.body)).toEqual([]);
    expect(lineage.status).toBe(200);
  });
});
