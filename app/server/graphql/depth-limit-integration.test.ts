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
      editionsRoot: harness.editionsRoot,
      scanJobs: harness.scanJobs,
      thumbnails: harness.thumbnails,
      replaceStaging: harness.replaceStaging,
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

  // Final-review-wave F-1: the shipped UI ALSO renders `LibraryEntry`'s
  // `Series` arm (`SeriesRow`/`useSeriesBookList`) alongside the `Book` arm,
  // nesting a full book card — including a pending-fix banner
  // (`pendingFix.state.autoFixes`) — 3 levels deeper inside the connection.
  // This measured depth 11 and was REJECTED at the old `MAX_DEPTH = 9`; it
  // is the previously-rejected legitimate query the recalibration exists to
  // admit. See `depth-limit.ts`'s recalibration comment for the full
  // measurement table this fixture is the HTTP-level twin of
  // (`depth-limit.test.ts` pins the same shape at the pure boundary-math
  // level).
  it('passes the grid + Series arm + full card (incl. pendingFix.autoFixes) — previously rejected at MAX_DEPTH=9 (F-1)', async () => {
    const GRID_WITH_SERIES_ARM = `
      fragment BookCard on Book {
        series { id name }
        progress { percentage }
        validation { id valid }
        pendingFix { state { autoFixes { field kind from to } } }
      }
      {
        viewer { library { entries(first: 20) {
          edges { node {
            ... on Book { ...BookCard }
            ... on Series { books(first: 10) { edges { node { ...BookCard } } } }
          } }
          pageInfo { hasNextPage endCursor }
        } } }
      }`;

    const response = await post(GRID_WITH_SERIES_ARM);

    expect(depthErrors(response.body)).toEqual([]);
    expect(response.status).toBe(200);
  });

  // One hop of the `Book.series ↔ Series.books` cycle — a book detail screen
  // showing sibling books in the same series is a real, legitimate query
  // shape, not amplification.
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

  // Two hops of the cycle rooted at a directly-addressed `book(id:)` field
  // (rather than through the `Library.entries` connection a client would
  // actually use to reach an arbitrary book) measures 11 — within the
  // recalibrated legitimate range (F-1), so it now passes. Kept explicitly,
  // not dropped, so this trade-off (documented in `depth-limit.ts`'s
  // recalibration comment) stays pinned rather than silently lost: what
  // MAX_DEPTH still bounds is INDEFINITE nesting of the cycle, not this one
  // fixed two-hop shape — see the next test for a THIRD hop still rejecting,
  // and the one after for the real amplification shape (rooted at
  // `Library.entries`, matching how the schema is actually reachable) still
  // rejecting at its true measured depth of 13.
  it('passes two hops of Book → Series → books off a single book(id:) field (bounded, not amplification)', async () => {
    const gid = bookGlobalId(harness.aliceOwner.userId, bookId);
    const TWO_HOPS = `{
      viewer { library { book(id: "${gid}") {
        series { books(first: 50) { edges { node {
          series { books(first: 50) { edges { node { id } } } }
        } } } }
      } } }
    }`;

    const response = await post(TWO_HOPS);

    expect(depthErrors(response.body)).toEqual([]);
    expect(response.status).toBe(200);
  });

  // Three hops off `book(id:)` measures 15 — still well past MAX_DEPTH=12,
  // proving the cycle stays bounded (a client cannot nest it indefinitely
  // just because two hops now fits).
  it('rejects three hops of Book → Series → books off a single book(id:) field', async () => {
    const gid = bookGlobalId(harness.aliceOwner.userId, bookId);
    const THREE_HOPS = `{
      viewer { library { book(id: "${gid}") {
        series { books(first: 50) { edges { node {
          series { books(first: 50) { edges { node {
            series { books(first: 50) { edges { node { id } } } }
          } } } }
        } } } }
      } } }
    }`;

    const response = await post(THREE_HOPS);

    expect(response.body.data ?? null).toBeNull();
    expect(depthErrors(response.body)).toHaveLength(1);
    expect(depthErrors(response.body)[0]).toContain('Split this into smaller operations');
  });

  // The REAL amplification shape (final-review-wave F-1: the ledger
  // previously recorded this as "rejected at depth 11" — corrected in
  // place, it measures 13): two hops of the same `Book.series ↔
  // Series.books` cycle, but rooted at `Library.entries` — the connection
  // the shipped grid actually queries to reach an arbitrary book, unlike
  // the fixed `book(id:)` lookup above. Seen-to-fail is
  // `depth-limit.test.ts`'s pure boundary-math suite (constructing this
  // exact rejection generically); this pins the real schema + real HTTP
  // path additionally rejects the real shape a client would actually send.
  it('rejects two hops of Book → Series → books rooted at Library.entries, with a clear message', async () => {
    const TWO_HOPS_VIA_ENTRIES = `{
      viewer { library { entries(first: 20) { edges { node { ... on Book {
        series { books(first: 50) { edges { node {
          series { books(first: 50) { edges { node { id } } } }
        } } } }
      } } } } } }
    }`;

    const response = await post(TWO_HOPS_VIA_ENTRIES);

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
