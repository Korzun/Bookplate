import * as crypto from 'crypto';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { Readable } from 'stream';

import { encodeGlobalID } from '@pothos/plugin-relay';
import { PrismaBetterSqlite3 } from '@prisma/adapter-better-sqlite3';
import { PrismaClient } from '@prisma/client';
import AdmZip from 'adm-zip';
import cookieParser from 'cookie-parser';
import express, { NextFunction, Request, Response } from 'express';
import { graphql } from 'graphql';
import request from 'supertest';
import type { Mock, MockedFunction } from 'vitest';

import { runMigrations } from '../db/migrate';
import { createChapterSpineMapLoader } from '../graphql/chapter-spine-map-loader';
import type { Context, Stores, Viewer } from '../graphql/context';
import { createOwnerLoader } from '../graphql/owner';
import { createPendingFixLoader } from '../graphql/pending-fix-loader';
import { createProgressLoader } from '../graphql/progress-loader';
import { schema } from '../graphql/schema';
import { createSeriesProgressLoader } from '../graphql/series-progress-loader';
import { createValidationCountsLoader } from '../graphql/validation-counts-loader';
import * as applyEpubChangesModule from '../services/apply-epub-changes';
import { BookStore } from '../services/book-store';
import { DeviceStore } from '../services/device-store';
import { EditionStore } from '../services/edition-store';
import { verifyAccessToken } from '../services/jwt';
import {
  ADMIN_STAGING_ID,
  createReplaceStaging,
  type ReplaceStaging,
} from '../services/replace-staging';
import { UserStore } from '../services/user-store';
import * as validationModule from '../services/validation';
import { AppConfig, EpubMeta, Owner } from '../types';
import { createLoginRateLimit, createUiRouter } from './ui';

vi.mock('../logger');
// Wrap (not replace) the real implementation so every other upload test in
// this file keeps exercising real detection behavior. Individual tests can
// override the return value with mockReturnValueOnce/mockImplementationOnce
// to force a specific proposal/auto-fix shape without affecting other tests.
vi.mock('../utils/metadata-issues', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../utils/metadata-issues')>();
  return {
    ...actual,
    detectMetadataIssues: vi.fn(actual.detectMetadataIssues),
  };
});
vi.mock('../services/epub-validator', () => {
  class EpubValidationError extends Error {
    messages: { id: string; severity: string; message: string }[];
    counts: Record<string, number>;
    threshold: string;
    constructor(
      messages: { id: string; severity: string; message: string }[],
      counts: Record<string, number>,
      threshold: string
    ) {
      super('EPUB failed validation');
      this.name = 'EpubValidationError';
      this.messages = messages;
      this.counts = counts;
      this.threshold = threshold;
    }
  }
  const okReport = {
    valid: true,
    messages: [],
    counts: { FATAL: 0, ERROR: 0, WARNING: 0, INFO: 0, USAGE: 0 },
  };
  return {
    EpubValidationError,
    assertValidEpub: vi.fn().mockResolvedValue(okReport),
    validateEpubReport: vi.fn().mockResolvedValue({ ...okReport, threshold: 'ERROR' }),
    toValidationReport: vi.fn((report: { valid: boolean }, threshold: string) => ({
      valid: report.valid,
      messages: [],
      counts: okReport.counts,
      threshold,
    })),
  };
});
vi.setConfig({ testTimeout: 30000 });
import { assertValidEpub, EpubValidationError } from '../services/epub-validator';
import { ScanJobStore } from '../services/scan-job-store';
import { ThumbnailQueue } from '../services/thumbnail-queue';
import { detectMetadataIssues } from '../utils/metadata-issues';
const mockAssertValid = assertValidEpub as MockedFunction<typeof assertValidEpub>;
const mockDetectMetadataIssues = detectMetadataIssues as MockedFunction<
  typeof detectMetadataIssues
>;

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
let replaceStaging: ReplaceStaging;
let app: express.Express;
let dbPath: string;
let aliceId: string;
// The book-route tests seed books into alice's library and exercise them as
// alice (her own library, no ?user= needed). Admin sessions must target a
// library with ?user=<username>.
let aliceOwner: Owner;
let scanJobStore: ScanJobStore;

const jwtSecret = crypto.randomBytes(32);

const config: AppConfig = {
  libraryName: 'Bookplate',
  username: 'admin',
  password: 'pass',
  booksDir: '',
  dataDir: '/tmp',
  port: 3000,
  maxConcurrentUploads: 3,
  thumbnailWidths: [86, 160],
  validationThreshold: 'ERROR',
};

const mockThumbnailQueue = {
  enqueue: vi.fn(),
  reconcile: vi.fn(),
} as unknown as ThumbnailQueue;

const FAKE_META: EpubMeta = {
  title: 'Test Book',
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

/**
 * A readable stream emitting exactly `totalBytes`, generated one 1MB chunk
 * at a time rather than materialized as a single Buffer up front — so the
 * 200MB/20MB upload-cap tests below don't need to hold a 200MB+ Buffer in
 * memory just to prove multer's `fileSize` limit actually rejects a request
 * that large. superagent's `.attach()` accepts any readable stream.
 */
function oversizedStream(totalBytes: number): Readable {
  const CHUNK_BYTES = 1024 * 1024;
  let sent = 0;
  return new Readable({
    read() {
      if (sent >= totalBytes) {
        this.push(null);
        return;
      }
      const size = Math.min(CHUNK_BYTES, totalBytes - sent);
      this.push(Buffer.alloc(size, 'x'));
      sent += size;
    },
  });
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
    version?: string;
    modified?: string[];
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
  const modifiedMeta = (opts.modified ?? [])
    .map((ts) => `<meta property="dcterms:modified">${ts}</meta>`)
    .join('\n    ');

  const opf = `<?xml version="1.0" encoding="UTF-8"?>
<package xmlns="http://www.idpf.org/2007/opf" version="${opts.version ?? '2.0'}">
  <metadata xmlns:dc="http://purl.org/dc/elements/1.1/">
    ${opts.title !== undefined ? `<dc:title>${opts.title}</dc:title>` : ''}
    ${opts.author !== undefined ? `<dc:creator>${opts.author}</dc:creator>` : ''}
    ${opts.description !== undefined ? `<dc:description>${opts.description}</dc:description>` : ''}
    ${coverMeta}
    ${seriesMeta}
    ${modifiedMeta}
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

// Thin wrapper over makeEpub for metadata-detection tests: builds an EPUB
// whose dc:title/dc:creator carry no file-as attribute, so titleSort/authorSort
// parse as empty and detectMetadataIssues has something to find. Omitting
// `title` builds an EPUB with no dc:title element at all (title-less EPUB).
function buildTestEpub(opts: { title?: string; author: string }): Buffer {
  return makeEpub({ title: opts.title, author: opts.author });
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

/**
 * Executes a REAL GraphQL query against the exact same `prisma`/stores this
 * file's REST `app` uses — not a second, disconnected harness
 * (`graphql/test-util.ts`'s `createHarness()` builds its own isolated
 * db/booksDir, which would defeat the one thing this exists for). This is
 * what lets a test PATCH/POST a REST route, then feed that response's
 * `globalId` straight into `Library.book` and prove it resolves the SAME
 * row the REST call just touched — the C-2 round-trip requirement
 * (2026-08-13 final review, human ruling): a pair of one-sided unit tests
 * (REST asserts a well-formed id; GraphQL asserts `Library.book` accepts
 * SOME global id) could both stay green while the two sides silently
 * disagreed on the compound-id shape. This proves the actual handoff.
 */
async function gqlExecute(
  source: string,
  viewer: Viewer
): ReturnType<typeof graphql<Record<string, unknown>>> {
  const stores: Stores = {
    book: bookStore,
    user: userStore,
    device: new DeviceStore(prisma),
    edition: new EditionStore(path.join(os.tmpdir(), 'ui-test-round-trip-editions'), prisma),
    scanJob: scanJobStore,
    thumbnail: mockThumbnailQueue,
    replaceStaging,
  };
  const contextValue: Context = {
    viewer,
    prisma,
    stores,
    config: { ...config, booksDir },
    loadOwner: createOwnerLoader(prisma),
    loadProgress: createProgressLoader(prisma),
    loadPendingFix: createPendingFixLoader(prisma),
    loadChapterSpineMap: createChapterSpineMapLoader(prisma),
    loadSeriesProgress: createSeriesProgressLoader(prisma),
    loadValidationCounts: createValidationCountsLoader(prisma),
  };
  return graphql({ schema, source, contextValue });
}

beforeEach(async () => {
  booksDir = fs.mkdtempSync(path.join(os.tmpdir(), 'bookplate-ui-'));
  dbPath = path.join(
    os.tmpdir(),
    `test-${Date.now()}-${Math.random().toString(36).slice(2)}.sqlite`
  );
  const adapter = new PrismaBetterSqlite3({ url: `file:${dbPath}` });
  prisma = new PrismaClient({ adapter } as ConstructorParameters<typeof PrismaClient>[0]);
  await runMigrations(prisma, booksDir);
  bookStore = new BookStore(booksDir, prisma);
  replaceStaging = createReplaceStaging({ stagingDir: bookStore.getStagingDir() });
  userStore = new UserStore(prisma);
  await userStore.createUser('alice', await UserStore.hashLoginPassword('alicepass'));
  aliceId = (await userStore.getUserIdByUsername('alice'))!;
  aliceOwner = { userId: aliceId, username: 'alice' };

  scanJobStore = new ScanJobStore();
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
      jwtSecret,
      prisma,
      replaceStaging
    )
  );
  // Terminal error middleware mirrors server.ts so unexpected throws → 500
  app.use((_err: unknown, _req: Request, res: Response, _next: NextFunction): void => {
    if (!res.headersSent) {
      res.status(500).json({ error: 'Internal server error' });
    }
  });
  (mockThumbnailQueue.enqueue as Mock).mockClear();
  (mockThumbnailQueue.reconcile as Mock).mockClear();
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

  describe('rate limiting (Task 4)', () => {
    it('the 11th attempt within a minute gets 429 + Retry-After, and successful logins do NOT reset the window', async () => {
      // All ten SUCCEED — proving success doesn't reset the counter (if it
      // did, this loop would never exhaust the window and the 11th call
      // below would also succeed).
      for (let i = 0; i < 10; i++) {
        const res = await request(app)
          .post('/api/login')
          .send('username=admin&password=pass')
          .set('Content-Type', 'application/x-www-form-urlencoded');
        expect(res.status).toBe(200);
      }
      const res11 = await request(app)
        .post('/api/login')
        .send('username=admin&password=pass')
        .set('Content-Type', 'application/x-www-form-urlencoded');
      expect(res11.status).toBe(429);
      expect(res11.headers['retry-after']).toBeDefined();
      expect(res11.body).toEqual({ error: 'Too many login attempts. Please try again later.' });
    });

    it('window expiry admits again (injected clock via createUiRouter’s optional now parameter — no fake timers)', async () => {
      let now = 0;
      const clockedApp = express();
      clockedApp.use(express.json());
      clockedApp.use(express.urlencoded({ extended: false }));
      clockedApp.use(cookieParser());
      clockedApp.use(
        '/',
        createUiRouter(
          bookStore,
          userStore,
          { ...config, booksDir },
          mockThumbnailQueue,
          jwtSecret,
          prisma,
          replaceStaging,
          () => now
        )
      );

      for (let i = 0; i < 11; i++) {
        await request(clockedApp)
          .post('/api/login')
          .send('username=admin&password=pass')
          .set('Content-Type', 'application/x-www-form-urlencoded');
      }
      // Window exhausted (11 attempts, all at now=0 — same window).
      const stillDenied = await request(clockedApp)
        .post('/api/login')
        .send('username=admin&password=pass')
        .set('Content-Type', 'application/x-www-form-urlencoded');
      expect(stillDenied.status).toBe(429);

      now = 60_001; // just past the 60s window
      const admittedAgain = await request(clockedApp)
        .post('/api/login')
        .send('username=admin&password=pass')
        .set('Content-Type', 'application/x-www-form-urlencoded');
      expect(admittedAgain.status).toBe(200);
    });

    // I-2: proves config.trustProxyHops actually threads from AppConfig
    // through createUiRouter into the limiter (the unit-level tests below
    // exercise resolveLoginClientIp/createLoginRateLimit directly, which
    // doesn't prove this wiring). All requests below share ONE real TCP
    // connection to the test app — X-Forwarded-For is the only thing that
    // varies, so distinct outcomes can only come from the header being read.
    it('config.trustProxyHops threads through createUiRouter — two X-Forwarded-For clients behind one trusted proxy are limited independently', async () => {
      const proxyApp = express();
      proxyApp.use(express.json());
      proxyApp.use(express.urlencoded({ extended: false }));
      proxyApp.use(cookieParser());
      proxyApp.use(
        '/',
        createUiRouter(
          bookStore,
          userStore,
          { ...config, booksDir, trustProxyHops: 1 },
          mockThumbnailQueue,
          jwtSecret,
          prisma,
          replaceStaging
        )
      );

      for (let i = 0; i < 10; i++) {
        await request(proxyApp)
          .post('/api/login')
          .set('X-Forwarded-For', 'client-a')
          .send('username=admin&password=pass')
          .set('Content-Type', 'application/x-www-form-urlencoded');
      }
      const aRes = await request(proxyApp)
        .post('/api/login')
        .set('X-Forwarded-For', 'client-a')
        .send('username=admin&password=pass')
        .set('Content-Type', 'application/x-www-form-urlencoded');
      expect(aRes.status).toBe(429);

      const bRes = await request(proxyApp)
        .post('/api/login')
        .set('X-Forwarded-For', 'client-b')
        .send('username=admin&password=pass')
        .set('Content-Type', 'application/x-www-form-urlencoded');
      expect(bRes.status).toBe(200);
    });
  });
});

describe('createLoginRateLimit (Task 4, unit-level — mirrors graphqlBodyLimit’s direct-call tests)', () => {
  function mockRes(): {
    res: Response;
    state: { status?: number; headers: Record<string, string>; body?: unknown };
  } {
    const state: { status?: number; headers: Record<string, string>; body?: unknown } = {
      headers: {},
    };
    const res = {
      status(code: number) {
        state.status = code;
        return res;
      },
      set(name: string, value: string) {
        state.headers[name] = value;
        return res;
      },
      json(payload: unknown) {
        state.body = payload;
        return res;
      },
    } as unknown as Response;
    return { res, state };
  }

  // `resolveLoginClientIp` (review I-2) reads `req.socket.remoteAddress` and
  // `req.headers['x-forwarded-for']` directly — never Express's own `req.ip`
  // — so the fake request needs both, not the `{ ip }` shape the pre-review
  // version of these tests used.
  function fakeReq(remoteAddress: string, forwardedFor?: string): Request {
    return {
      socket: { remoteAddress },
      headers: forwardedFor !== undefined ? { 'x-forwarded-for': forwardedFor } : {},
    } as unknown as Request;
  }

  it('allows the first 10 attempts for one IP, denies the 11th with 429 + Retry-After', () => {
    const limiter = createLoginRateLimit(() => 1_000);
    for (let i = 0; i < 10; i++) {
      const next = vi.fn();
      const { res, state } = mockRes();
      limiter(fakeReq('1.2.3.4'), res, next);
      expect(next).toHaveBeenCalledTimes(1);
      expect(state.status).toBeUndefined();
    }

    const next = vi.fn();
    const { res, state } = mockRes();
    limiter(fakeReq('1.2.3.4'), res, next);
    expect(next).not.toHaveBeenCalled();
    expect(state.status).toBe(429);
    expect(state.headers['Retry-After']).toBeDefined();
    expect(state.body).toEqual({ error: 'Too many login attempts. Please try again later.' });
  });

  it('a different IP is unaffected by another IP’s exhausted window', () => {
    const limiter = createLoginRateLimit(() => 1_000);
    for (let i = 0; i < 11; i++) {
      const { res } = mockRes();
      limiter(fakeReq('1.2.3.4'), res, vi.fn());
    }
    // 1.2.3.4's window is now exhausted (11th above was denied) — a
    // never-before-seen IP still gets through on its first attempt.
    const next = vi.fn();
    const { res, state } = mockRes();
    limiter(fakeReq('5.6.7.8'), res, next);
    expect(next).toHaveBeenCalledTimes(1);
    expect(state.status).toBeUndefined();
  });

  it('admits again once the window has expired, via the injected clock alone', () => {
    let now = 0;
    const limiter = createLoginRateLimit(() => now);
    for (let i = 0; i < 11; i++) {
      const { res } = mockRes();
      limiter(fakeReq('9.9.9.9'), res, vi.fn());
    }
    // The 11th call above (still at now=0) was denied — confirm, then
    // advance the clock past the window and confirm admission resumes.
    const deniedNext = vi.fn();
    const { res: deniedRes, state: deniedState } = mockRes();
    limiter(fakeReq('9.9.9.9'), deniedRes, deniedNext);
    expect(deniedNext).not.toHaveBeenCalled();
    expect(deniedState.status).toBe(429);

    now = 60_001;
    const next = vi.fn();
    const { res, state } = mockRes();
    limiter(fakeReq('9.9.9.9'), res, next);
    expect(next).toHaveBeenCalledTimes(1);
    expect(state.status).toBeUndefined();
  });

  // N-2: pin the exact window-boundary instant. `>=` means `now === windowStart
  // + WINDOW_MS` is already a NEW window (admitted) — a future `>` typo would
  // keep the old window alive one tick too long and this test would redden.
  it('at exactly the window boundary (now === windowStart + 60000), a fresh window has already started', () => {
    let now = 0;
    const limiter = createLoginRateLimit(() => now);
    for (let i = 0; i < 11; i++) {
      const { res } = mockRes();
      limiter(fakeReq('4.4.4.4'), res, vi.fn());
    }
    // 11th above (at now=0) was denied.
    now = 60_000; // exactly WINDOW_MS later, not 60_001
    const next = vi.fn();
    const { res, state } = mockRes();
    limiter(fakeReq('4.4.4.4'), res, next);
    expect(next).toHaveBeenCalledTimes(1);
    expect(state.status).toBeUndefined();
  });

  // I-1 fix: the Map must not grow without bound. `sweep()` deletes every
  // entry whose window has aged out — assert directly on the Map's size
  // (via the exported `.size()` accessor) rather than only inferring
  // reclamation from request/response behavior, which is exactly the gap
  // the review named ("a sweep test needs to observe the Map's size"). Seeds
  // past `LOGIN_RATE_LIMIT_SWEEP_THRESHOLD` (final-review-wave T4: the sweep
  // is now size-gated, so a below-threshold seed would never trigger it —
  // see the next test for that boundary).
  it('sweeps expired entries out of the Map once past the size threshold, bounding memory (I-1)', () => {
    let now = 0;
    const limiter = createLoginRateLimit(() => now);
    const seedCount = 300; // > LOGIN_RATE_LIMIT_SWEEP_THRESHOLD (256)

    for (let i = 0; i < seedCount; i++) {
      const { res } = mockRes();
      limiter(fakeReq(`10.0.${Math.floor(i / 256)}.${i % 256}`), res, vi.fn());
    }
    expect(limiter.size()).toBe(seedCount);

    // Every one of those windows is now stale; a single new request from an
    // unrelated IP crosses the threshold and should sweep all of them away,
    // leaving only itself.
    now = 60_001;
    const { res } = mockRes();
    limiter(fakeReq('255.255.255.255'), res, vi.fn());
    expect(limiter.size()).toBe(1);
  });

  // Final-review-wave T4: below the threshold, `loginRateLimit` must NOT pay
  // for a sweep on every call — the whole point of gating it. Proven here by
  // seeding stale entries that stay UNDER the threshold and showing they
  // are NOT reclaimed by a subsequent request (they would be, immediately,
  // under the old unconditional-sweep behavior the test above used to pin).
  it('does not sweep below the size threshold, even with stale entries present', () => {
    let now = 0;
    const limiter = createLoginRateLimit(() => now);
    const seedCount = 50; // well under LOGIN_RATE_LIMIT_SWEEP_THRESHOLD (256)

    for (let i = 0; i < seedCount; i++) {
      const { res } = mockRes();
      limiter(fakeReq(`10.1.0.${i}`), res, vi.fn());
    }
    expect(limiter.size()).toBe(seedCount);

    now = 60_001; // every seeded window is now stale
    const { res } = mockRes();
    limiter(fakeReq('255.255.255.255'), res, vi.fn());
    // No sweep fired — the new entry is simply added alongside the stale ones.
    expect(limiter.size()).toBe(seedCount + 1);
  });

  describe('resolveLoginClientIp / trustProxyHops (I-2 — contained fix, no Express trust-proxy setting touched)', () => {
    it('direct-connection behavior is unchanged: with trustProxyHops unset (0), the TCP peer is used even if a header is present', () => {
      const limiter = createLoginRateLimit(() => 1_000); // trustProxyHops defaults to 0
      for (let i = 0; i < 10; i++) {
        const { res } = mockRes();
        limiter(fakeReq('203.0.113.9', 'attacker-forged-value'), res, vi.fn());
      }
      // Exhausted 203.0.113.9's window (the real peer) regardless of the
      // forged header — the 11th, still from that same peer with a
      // DIFFERENT forged header value, is still denied because the header
      // was never consulted.
      const next = vi.fn();
      const { res, state } = mockRes();
      limiter(fakeReq('203.0.113.9', 'different-forged-value'), res, next);
      expect(next).not.toHaveBeenCalled();
      expect(state.status).toBe(429);
    });

    it('a forged X-Forwarded-For does NOT influence the key when trustProxyHops is 0 — two different headers from the same peer share one window', () => {
      const limiter = createLoginRateLimit(() => 1_000, 0);
      const { res: res1, state: state1 } = mockRes();
      limiter(fakeReq('203.0.113.9', '1.1.1.1'), res1, vi.fn());
      const { res: res2, state: state2 } = mockRes();
      limiter(fakeReq('203.0.113.9', '2.2.2.2'), res2, vi.fn());
      expect(state1.status).toBeUndefined();
      expect(state2.status).toBeUndefined();
      // Both counted against the SAME (peer-keyed) window — a 9-more burst
      // from either forged identity exhausts it.
      for (let i = 0; i < 9; i++) {
        const { res } = mockRes();
        limiter(fakeReq('203.0.113.9', `spoofed-${i}`), res, vi.fn());
      }
      const { res: res11, state: state11 } = mockRes();
      limiter(fakeReq('203.0.113.9', 'yet-another-spoof'), res11, vi.fn());
      expect(state11.status).toBe(429);
    });

    it('with trustProxyHops=1, two distinct clients behind the same one trusted proxy are limited INDEPENDENTLY', () => {
      const limiter = createLoginRateLimit(() => 1_000, 1);
      const proxyAddress = '10.10.10.10'; // the one trusted hop's own address
      for (let i = 0; i < 10; i++) {
        const { res } = mockRes();
        limiter(fakeReq(proxyAddress, '198.51.100.1'), res, vi.fn());
      }
      // Client A (198.51.100.1) is now exhausted...
      const { res: aRes, state: aState } = mockRes();
      limiter(fakeReq(proxyAddress, '198.51.100.1'), aRes, vi.fn());
      expect(aState.status).toBe(429);
      // ...but client B, behind the SAME proxy (identical direct peer
      // address), is unaffected — the limiter keyed on the header's client
      // entry, not the shared proxy address.
      const { res: bRes, state: bState } = mockRes();
      limiter(fakeReq(proxyAddress, '198.51.100.2'), bRes, vi.fn());
      expect(bState.status).toBeUndefined();
    });

    it('with trustProxyHops=1, a missing X-Forwarded-For falls back to the direct peer (fail-safe, not a crash)', () => {
      const limiter = createLoginRateLimit(() => 1_000, 1);
      const { res, state } = mockRes();
      limiter(fakeReq('10.10.10.10'), res, vi.fn());
      expect(state.status).toBeUndefined();
      expect(limiter.size()).toBe(1);
    });
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

  // Task 4: `upload` (this route's multer instance) previously carried NO
  // `fileSize` limit at all — an unbounded sink. Now capped at 200MB,
  // matching `epubUpload`'s existing figure. `withUploadLimit` (routes/ui.ts)
  // maps multer's own `LIMIT_FILE_SIZE` error to a 413 JSON response — read
  // via a real 200MB+1-byte upload (streamed, not buffered) rather than
  // assumed, since without that wrapper this would 500 via the generic
  // catch-all instead (multer's error reaches `next(err)` from INSIDE the
  // multer middleware, one step before this route's `asyncHandler` even
  // starts, so `asyncHandler`'s own promise-rejection catch can never see it).
  it('rejects a file over the 200MB cap with 413, not the generic 500', async () => {
    const token = await loginAlice();
    const res = await request(app)
      .post('/api/books/upload')
      .set(...bearer(token))
      .attach('files', oversizedStream(200 * 1024 * 1024 + 1), 'huge.epub');
    expect(res.status).toBe(413);
    expect(res.body).toEqual({ error: 'File too large' });
  }, 30000);

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

  // Task 7 (book-edit spec): `fix-review`'s Edit link needs a Relay global
  // id for a book whose only proposals are flag-only (`to: null`) —
  // produced right here, at upload-analysis time, before any later PATCH
  // ever runs. `patchBookMetadata`'s own `globalId` (step 6's C-2 fix)
  // can't cover this case, so this response must carry one directly.
  it('each upload result carries a globalId that Library.book resolves to the SAME book', async () => {
    const epubBuf = makeEpub({ title: 'Global Id Upload Book', author: 'A' });
    const token = await loginAlice();
    const res = await request(app)
      .post('/api/books/upload')
      .attach('files', epubBuf, 'globalid.epub')
      .set(...bearer(token));
    expect(res.status).toBe(200);
    const result = res.body.results[0] as { bookId: string; globalId: string };
    // Unmistakable from the pre-existing raw `bookId` field — same naming
    // rule the metadata/replace responses already follow.
    expect(result.globalId).not.toBe(result.bookId);
    expect(result.globalId).toBe(bookGlobalId(aliceId, result.bookId));

    // THE ROUND TRIP: feed the response's OWN globalId into a REAL
    // `Library.book` query over the same db this upload just wrote to —
    // proves the id this route emits is one `page/book-edit` can actually
    // use, not just a well-formed-looking string.
    const aliceViewer: Viewer = {
      userId: aliceId,
      username: 'alice',
      isAdmin: false,
      mustChangePassword: false,
    };
    const gqlResult = await gqlExecute(
      `{ viewer { library { book(id: "${result.globalId}") { id title } } } }`,
      aliceViewer
    );
    expect(gqlResult.errors).toBeUndefined();
    const data = gqlResult.data as {
      viewer: { library: { book: { id: string; title: string } | null } };
    };
    expect(data.viewer.library.book).not.toBeNull();
    expect(data.viewer.library.book!.title).toBe('Global Id Upload Book');
    expect(data.viewer.library.book!.id).toBe(result.globalId);
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

  it('persists validation after a successful upload', async () => {
    const spy = vi.spyOn(validationModule, 'saveValidation');
    const epubBuf = makeEpub({ title: 'Validated Book' });
    const token = await loginAlice();
    const res = await request(app)
      .post('/api/books/upload')
      .attach('files', epubBuf, 'validated.epub')
      .set(...bearer(token));
    expect(res.status).toBe(200);
    expect(spy).toHaveBeenCalled();
    const [, , bookId] = spy.mock.calls[0];
    expect(typeof bookId).toBe('string');
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
    // A particle name keeps author-sort-missing a proposal (its derivation is
    // unreliable, so it's never auto-applied), so the book's id/fingerprint
    // doesn't shift via reimport before the duplicate check.
    const epubBuf = makeEpub({ title: 'Dup', author: 'A de Cee' });
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
    // Single-token author makes author-sort-missing auto-eligible, so this
    // exercises the reimport path: the upload-time filename-fallback title
    // must survive the auto-fix's applyEpubChanges -> reimportBook round trip.
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

  it('rejects an EPUB that fails validation with 400 and does not store it', async () => {
    const epubBuf = makeEpub({ title: 'Bad Book', author: 'A' });
    mockAssertValid.mockRejectedValueOnce(
      new EpubValidationError(
        [{ id: 'RSC-005', severity: 'ERROR', message: 'parse error' }],
        {
          FATAL: 0,
          ERROR: 1,
          WARNING: 0,
          INFO: 0,
          USAGE: 0,
        },
        'ERROR'
      )
    );
    const token = await loginAlice();
    const res = await request(app)
      .post('/api/books/upload')
      .set(...bearer(token))
      .attach('files', epubBuf, 'bad.epub');

    expect(res.status).toBe(400);
    expect(res.body.error).toMatch(/validation/i);
    expect(res.body.validation.messages[0].id).toBe('RSC-005');
    expect(res.body.validation.threshold).toBe('ERROR');

    const onDisk = fs
      .readdirSync(booksDir)
      .filter((f) => f.endsWith('.epub') && !f.startsWith('staged-'));
    expect(onDisk).toHaveLength(0);
  });

  it('returns 500 (not a crash) when assertValidEpub throws an unexpected non-validation error', async () => {
    const epubBuf = makeEpub({ title: 'Boom Book', author: 'A' });
    mockAssertValid.mockRejectedValueOnce(new Error('boom'));
    const token = await loginAlice();
    const res = await request(app)
      .post('/api/books/upload')
      .set(...bearer(token))
      .attach('files', epubBuf, 'boom.epub');

    expect(res.status).toBe(500);
  });
});

describe('POST /api/books/upload — metadata detection', () => {
  it('auto-applies a missing title sort and reports it as applied', async () => {
    const token = await loginAlice();
    // Build an EPUB whose dc:title is "The Test Title" with no title file-as.
    const epub = buildTestEpub({ title: 'The Test Title', author: 'Peter Watts' });
    const res = await request(app)
      .post('/api/books/upload')
      .set(...bearer(token))
      .attach('files', epub, 'the-test-title.epub')
      .expect(200);

    expect(res.body.results).toHaveLength(1);
    const result = res.body.results[0];
    const applied = result.applied.find((f: { kind: string }) => f.kind === 'title-sort-missing');
    expect(applied).toBeTruthy();
    expect(applied.to).toBe('Test Title, The');

    // The persisted book reflects the applied fix.
    const book = await bookStore.getBookById(aliceOwner, result.bookId);
    expect(book?.titleSort).toBe('Test Title, The');
  });

  it('returns a low-confidence author sort as a proposal, not applied', async () => {
    const token = await loginAlice();
    const epub = buildTestEpub({ title: 'Some Book', author: 'Ursula K. Le Guin' }); // no author file-as
    const res = await request(app)
      .post('/api/books/upload')
      .set(...bearer(token))
      .attach('files', epub, 'some-book.epub')
      .expect(200);

    const result = res.body.results[0];
    const proposal = result.proposals.find(
      (f: { kind: string }) => f.kind === 'author-sort-missing'
    );
    expect(proposal).toBeTruthy();
    expect(proposal.to).toBe('Guin, Ursula K. Le');
    expect(
      result.applied.find((f: { kind: string }) => f.kind === 'author-sort-missing')
    ).toBeUndefined();
  });

  it('preserves the filename-fallback title through an auto-applied author fix', async () => {
    const token = await loginAlice();
    // No dc:title at all, so the stored title is the filename-fallback
    // ('my-great-book'). A single-token author makes author-sort-missing
    // auto-eligible, which triggers applyEpubChanges -> reimportBook. The
    // reimport re-parses the title from the EPUB bytes on disk; without the
    // fix, that clobbers the fallback with a hash-like id.
    const epub = buildTestEpub({ author: 'Peter Watts' });
    const res = await request(app)
      .post('/api/books/upload')
      .set(...bearer(token))
      .attach('files', epub, 'my-great-book.epub')
      .expect(200);

    const result = res.body.results[0];
    const applied = result.applied.find((f: { kind: string }) => f.kind === 'author-sort-missing');
    expect(applied).toBeTruthy();

    const book = await bookStore.getBookById(aliceOwner, result.bookId);
    expect(book?.title).toBe('my-great-book');
  });

  it('never fails an upload when the auto-fix write fails; surfaces it as a proposal instead', async () => {
    // Force the auto-apply write (applyEpubChanges -> buildUpdatedEpub) to
    // fail for this single upload, simulating e.g. a disk error while
    // rewriting the EPUB. The route must catch this and surface the would-be
    // metadata auto-fix as a proposal — never a 500. (The structural
    // dcterms:modified repair is a separate, earlier step that already
    // succeeded, so it legitimately remains in `applied`.)
    const spy = vi
      .spyOn(applyEpubChangesModule, 'applyEpubChanges')
      .mockRejectedValueOnce(new Error('simulated write failure'));
    try {
      const token = await loginAlice();
      const epub = buildTestEpub({ title: 'The Test Title', author: 'Peter Watts' });
      const res = await request(app)
        .post('/api/books/upload')
        .set(...bearer(token))
        .attach('files', epub, 'the-test-title.epub')
        .expect(200);

      const result = res.body.results[0];
      // No metadata auto-fix leaked into `applied` — only the structural repair.
      expect(result.applied.every((f: { field: string }) => f.field === 'document')).toBe(true);
      const proposal = result.proposals.find(
        (f: { kind: string }) => f.kind === 'title-sort-missing'
      );
      expect(proposal).toBeTruthy();
      expect(proposal.to).toBe('Test Title, The');
    } finally {
      spy.mockRestore();
    }
  });
});

describe('POST /api/books/upload — pending_fixes persistence', () => {
  it('upload persists a pending_fixes row when there are proposals', async () => {
    mockDetectMetadataIssues.mockReturnValueOnce([
      {
        field: 'subjects',
        kind: 'subjects-split',
        from: 'A & B',
        to: null,
        changes: {},
        autoEligible: false,
      },
    ]);

    const token = await loginAlice();
    await request(app)
      .post('/api/books/upload')
      .set(...bearer(token))
      .attach('files', makeEpub({ title: 'Pending Fix Book', author: 'A' }), 'book.epub')
      .expect(200);

    const rows = await prisma.pendingFix.findMany({ where: { userId: aliceId } });
    expect(rows).toHaveLength(1);
    const state = JSON.parse(rows[0].state);
    expect(state.proposals).toHaveLength(1);
  });

  it('does not persist a pending_fixes row when detection yields no proposals', async () => {
    mockDetectMetadataIssues.mockReturnValueOnce([]);

    const token = await loginAlice();
    await request(app)
      .post('/api/books/upload')
      .set(...bearer(token))
      .attach('files', makeEpub({ title: 'No Fix Book', author: 'A' }), 'book.epub')
      .expect(200);

    const rows = await prisma.pendingFix.findMany({ where: { userId: aliceId } });
    expect(rows).toHaveLength(0);
  });

  it('does not persist a pending_fixes row when detection yields only auto-eligible issues', async () => {
    mockDetectMetadataIssues.mockReturnValueOnce([
      {
        field: 'titleSort',
        kind: 'title-sort-missing',
        from: '',
        to: 'Book, No Fix',
        changes: { titleSort: 'Book, No Fix' },
        autoEligible: true,
      },
    ]);

    const token = await loginAlice();
    await request(app)
      .post('/api/books/upload')
      .set(...bearer(token))
      .attach('files', makeEpub({ title: 'No Fix Book', author: 'A' }), 'book.epub')
      .expect(200);

    const rows = await prisma.pendingFix.findMany({ where: { userId: aliceId } });
    expect(rows).toHaveLength(0);
  });
});

describe('POST /api/books/upload — dcterms:modified repair', () => {
  it('dedupes a duplicate dcterms:modified and reports a document fix', async () => {
    const token = await loginAlice();
    const epub = makeEpub({
      version: '3.0',
      title: 'Dup Modified',
      author: 'Peter Watts',
      modified: ['2020-01-01T00:00:00Z', '2022-01-01T00:00:00Z'],
    });
    const res = await request(app)
      .post('/api/books/upload')
      .set(...bearer(token))
      .attach('files', epub, 'dup.epub')
      .expect(200);

    const result = res.body.results[0];
    const fix = result.applied.find((f: { kind: string }) => f.kind === 'duplicate-modified-date');
    expect(fix).toBeTruthy();
    expect(fix.field).toBe('document');
    // Book is retrievable under the (repaired) id.
    expect(await bookStore.getBookById(aliceOwner, result.bookId)).not.toBeNull();
  });

  it('injects a missing dcterms:modified and reports a document fix', async () => {
    const token = await loginAlice();
    const epub = makeEpub({
      version: '3.0',
      title: 'No Modified',
      author: 'Peter Watts',
      modified: [],
    });
    const res = await request(app)
      .post('/api/books/upload')
      .set(...bearer(token))
      .attach('files', epub, 'nomod.epub')
      .expect(200);
    expect(
      res.body.results[0].applied.find((f: { kind: string }) => f.kind === 'missing-modified-date')
    ).toBeTruthy();
  });

  it('does not touch an EPUB3 that already has exactly one dcterms:modified', async () => {
    const token = await loginAlice();
    const epub = makeEpub({
      version: '3.0',
      title: 'One Modified',
      author: 'Peter Watts',
      modified: ['2020-01-01T00:00:00Z'],
    });
    const res = await request(app)
      .post('/api/books/upload')
      .set(...bearer(token))
      .attach('files', epub, 'onemod.epub')
      .expect(200);
    expect(
      res.body.results[0].applied.find((f: { field: string }) => f.field === 'document')
    ).toBeUndefined();
  });

  it('applies both a structural repair and a post-add auto-fix to the same upload', async () => {
    const token = await loginAlice();
    const epub = makeEpub({
      version: '3.0',
      title: 'The Coexist Book',
      author: 'Peter Watts',
      modified: ['2020-01-01T00:00:00Z', '2022-01-01T00:00:00Z'],
    });
    const res = await request(app)
      .post('/api/books/upload')
      .set(...bearer(token))
      .attach('files', epub, 'coexist.epub')
      .expect(200);

    const result = res.body.results[0];
    const structuralFix = result.applied.find(
      (f: { kind: string }) => f.kind === 'duplicate-modified-date'
    );
    expect(structuralFix).toBeTruthy();
    expect(structuralFix.field).toBe('document');

    const metadataFix = result.applied.find(
      (f: { kind: string }) => f.kind === 'title-sort-missing'
    );
    expect(metadataFix).toBeTruthy();

    // The returned bookId is the final post-auto-fix id and is retrievable.
    expect(await bookStore.getBookById(aliceOwner, result.bookId)).not.toBeNull();
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

  it('serves an immutable cache header when a version token is present', async () => {
    await bookStore.addBook(aliceOwner, 'cacheBook', stage('cacheBook'), {
      ...FAKE_META,
      coverData: Buffer.from('cacheable-cover'),
      coverMime: 'image/jpeg',
    });

    const token = await loginAlice();
    const res = await request(app)
      .get('/api/books/cacheBook/cover?v=12345')
      .set(...bearer(token));
    expect(res.status).toBe(200);
    expect(res.headers['cache-control']).toBe('private, max-age=31536000, immutable');
    expect(res.headers['etag']).toBeTruthy();
  });

  it('revalidates every time when no version token is present', async () => {
    await bookStore.addBook(aliceOwner, 'noVerBook', stage('noVerBook'), {
      ...FAKE_META,
      coverData: Buffer.from('revalidate-cover'),
      coverMime: 'image/jpeg',
    });

    const token = await loginAlice();
    const res = await request(app)
      .get('/api/books/noVerBook/cover')
      .set(...bearer(token));
    expect(res.status).toBe(200);
    expect(res.headers['cache-control']).toBe('private, max-age=0, must-revalidate');
  });

  it('returns 304 when the ETag matches If-None-Match', async () => {
    await bookStore.addBook(aliceOwner, 'etagBook', stage('etagBook'), {
      ...FAKE_META,
      coverData: Buffer.from('etag-cover'),
      coverMime: 'image/jpeg',
    });

    const token = await loginAlice();
    const first = await request(app)
      .get('/api/books/etagBook/cover')
      .set(...bearer(token));
    const etag = first.headers['etag'];
    expect(etag).toBeTruthy();

    const second = await request(app)
      .get('/api/books/etagBook/cover')
      .set(...bearer(token))
      .set('If-None-Match', etag);
    expect(second.status).toBe(304);
  });
});

describe('GET /api/books/:id/download', () => {
  it('streams the epub with attachment headers', async () => {
    await bookStore.addBook(aliceOwner, 'dl1', stage('dl1', 'EPUBDATA'), FAKE_META);
    const [book] = await bookStore.listBooks(aliceOwner);

    const token = await loginAlice();
    const res = await request(app)
      .get(`/api/books/${book.id}/download`)
      .set(...bearer(token));

    expect(res.status).toBe(200);
    expect(res.headers['content-type']).toContain('application/epub+zip');
    expect(res.headers['content-disposition']).toContain('attachment');
    expect(res.headers['content-disposition']).toContain(encodeURIComponent(book.filename));
    // supertest/superagent only buffers responses to a Buffer for mime types it
    // recognizes as binary (image/audio/video/font); `application/epub+zip` isn't
    // one of those, so the body arrives via `res.text` instead of `res.body`.
    expect(res.text).toBe('EPUBDATA');
  });

  it('returns 401 without a token', async () => {
    const res = await request(app).get('/api/books/whatever/download');
    expect(res.status).toBe(401);
  });

  it('returns 404 for an unknown book id', async () => {
    const token = await loginAlice();
    const res = await request(app)
      .get('/api/books/deadbeefdeadbeef/download')
      .set(...bearer(token));
    expect(res.status).toBe(404);
  });
});

// The two `/api/books/:id/*` REST routes that survive the client's move to
// GraphQL. GraphQL's `Book.id` is a Relay global ID encoding [userId,
// bookId] (spec 1's book-relay-id pass removed the raw `bookId` field from
// the schema entirely), and the GraphQL-fed library grid navigates to both
// of these with that global ID in `:id` — see `resolveBookLocalId`'s doc
// comment in `ui.ts` for the reachability analysis and the authorization
// rule.
function bookGlobalId(userId: string, bookId: string): string {
  return encodeGlobalID('Book', JSON.stringify([userId, bookId]));
}

describe('surviving book REST routes accept a Relay global ID', () => {
  let bobToken: string;
  let aliceBookId: string;

  beforeEach(async () => {
    await userStore.createUser('bob', await UserStore.hashLoginPassword('bobpass'));
    const bobRes = await request(app)
      .post('/api/login')
      .send('username=bob&password=bobpass')
      .set('Content-Type', 'application/x-www-form-urlencoded');
    bobToken = (bobRes.body as { accessToken: string }).accessToken;

    await bookStore.addBook(aliceOwner, 'gidbook', stage('gidbook'), FAKE_META);
    aliceBookId = (await bookStore.listBooks(aliceOwner))[0].id;
  });

  describe('GET /api/books/:id/download', () => {
    it('resolves a Relay global ID', async () => {
      const token = await loginAlice();
      const globalId = bookGlobalId(aliceId, aliceBookId);
      const res = await request(app)
        .get(`/api/books/${encodeURIComponent(globalId)}/download`)
        .set(...bearer(token));
      expect(res.status).toBe(200);
    });

    it("refuses another user's global ID", async () => {
      const globalId = bookGlobalId(aliceId, aliceBookId);
      const res = await request(app)
        .get(`/api/books/${encodeURIComponent(globalId)}/download`)
        .set(...bearer(bobToken));
      expect(res.status).toBe(404);
    });
  });

  describe('GET /api/books/:id/cover', () => {
    it('resolves a Relay global ID', async () => {
      await bookStore.addBook(aliceOwner, 'cover-gid', stage('cover-gid'), {
        ...FAKE_META,
        coverData: Buffer.from('gid-cover-bytes'),
        coverMime: 'image/jpeg',
      });
      const token = await loginAlice();
      const globalId = bookGlobalId(aliceId, 'cover-gid');
      const res = await request(app)
        .get(`/api/books/${encodeURIComponent(globalId)}/cover`)
        .set(...bearer(token));
      expect(res.status).toBe(200);
      expect(Buffer.from(res.body).toString()).toBe('gid-cover-bytes');
    });

    it("404s on another tenant's global id", async () => {
      await bookStore.addBook(aliceOwner, 'cover-gid2', stage('cover-gid2'), {
        ...FAKE_META,
        coverData: Buffer.from('gid-cover-bytes'),
        coverMime: 'image/jpeg',
      });
      const globalId = bookGlobalId(aliceId, 'cover-gid2');
      const res = await request(app)
        .get(`/api/books/${encodeURIComponent(globalId)}/cover`)
        .set(...bearer(bobToken));
      expect(res.status).toBe(404);
    });
  });
});

describe('POST /api/books/replace-staging', () => {
  it('stages the uploaded file and returns a stagedUploadId, keyed to the caller', async () => {
    const token = await loginAlice();
    const res = await request(app)
      .post('/api/books/replace-staging')
      .set(...bearer(token))
      .attach('file', makeEpub({ title: 'Staged', author: 'A' }), 'staged.epub');

    expect(res.status).toBe(200);
    expect(typeof res.body.stagedUploadId).toBe('string');
    expect(res.body.stagedUploadId.length).toBeGreaterThan(0);
    // Actually resolvable back through the same shared instance, for alice
    // specifically — proves it landed keyed to her, not unkeyed or global.
    const staged = replaceStaging.resolve(res.body.stagedUploadId as string, aliceId);
    expect(staged).not.toBeNull();
    expect(staged?.originalName).toBe('staged.epub');
  });

  it('returns 401 without a token', async () => {
    const res = await request(app)
      .post('/api/books/replace-staging')
      .attach('file', makeEpub({ title: 'X' }), 'x.epub');
    expect(res.status).toBe(401);
  });

  it('returns 400 with no file', async () => {
    const token = await loginAlice();
    const res = await request(app)
      .post('/api/books/replace-staging')
      .set(...bearer(token));
    expect(res.status).toBe(400);
  });

  it('accepts an admin session, staging under ADMIN_STAGING_ID (Task 4)', async () => {
    const token = await loginAdmin();
    const res = await request(app)
      .post('/api/books/replace-staging')
      .set(...bearer(token))
      .attach('file', makeEpub({ title: 'X' }), 'x.epub');

    expect(res.status).toBe(200);
    expect(typeof res.body.stagedUploadId).toBe('string');
    // Resolvable under the admin sentinel, not under alice's userId.
    expect(
      replaceStaging.resolve(res.body.stagedUploadId as string, ADMIN_STAGING_ID)
    ).not.toBeNull();
    expect(replaceStaging.resolve(res.body.stagedUploadId as string, aliceId)).toBeNull();
  });

  // Task 4: `epubUpload` (shared with the legacy replace/analyze routes)
  // caps at 200MB. Same `withUploadLimit` wrapper and 413 shape as
  // `/api/books/upload`'s identical test above.
  it('rejects a file over the 200MB cap with 413, not the generic 500', async () => {
    const token = await loginAlice();
    const res = await request(app)
      .post('/api/books/replace-staging')
      .set(...bearer(token))
      .attach('file', oversizedStream(200 * 1024 * 1024 + 1), 'huge.epub');
    expect(res.status).toBe(413);
    expect(res.body).toEqual({ error: 'File too large' });
  }, 30000);
});

describe('POST /api/books/cover-staging', () => {
  it('stages the uploaded image and returns a stagedUploadId, keyed to the caller', async () => {
    const token = await loginAlice();
    const coverBytes = Buffer.from('fake-png-cover');
    const res = await request(app)
      .post('/api/books/cover-staging')
      .set(...bearer(token))
      .attach('cover', coverBytes, { filename: 'cover.png', contentType: 'image/png' });

    expect(res.status).toBe(200);
    expect(typeof res.body.stagedUploadId).toBe('string');
    expect(res.body.stagedUploadId.length).toBeGreaterThan(0);
    // Resolvable back through the shared instance, for alice specifically,
    // and only under the 'cover' kind — same shared registry the EPUB
    // staging route above writes into, just a different kind tag.
    const staged = replaceStaging.resolve(res.body.stagedUploadId as string, aliceId, 'cover');
    expect(staged).not.toBeNull();
    expect(staged?.originalName).toBe('cover.png');
    expect(staged?.mimeType).toBe('image/png');
    expect(replaceStaging.resolve(res.body.stagedUploadId as string, aliceId, 'epub')).toBeNull();
  });

  it('rejects a non-image file (coverUpload’s MIME filter, same as the metadata route’s cover field)', async () => {
    const token = await loginAlice();
    const res = await request(app)
      .post('/api/books/cover-staging')
      .set(...bearer(token))
      .attach('cover', Buffer.from('not an image'), {
        filename: 'notes.txt',
        contentType: 'text/plain',
      });
    // multer's fileFilter silently drops the file rather than erroring —
    // same behaviour `coverUpload` already has on the metadata route.
    expect(res.status).toBe(400);
  });

  it('returns 401 without a token', async () => {
    const res = await request(app)
      .post('/api/books/cover-staging')
      .attach('cover', Buffer.from('x'), { filename: 'x.png', contentType: 'image/png' });
    expect(res.status).toBe(401);
  });

  it('returns 400 with no file', async () => {
    const token = await loginAlice();
    const res = await request(app)
      .post('/api/books/cover-staging')
      .set(...bearer(token));
    expect(res.status).toBe(400);
  });

  it('accepts an admin session, staging under ADMIN_STAGING_ID (Task 4)', async () => {
    const token = await loginAdmin();
    const res = await request(app)
      .post('/api/books/cover-staging')
      .set(...bearer(token))
      .attach('cover', Buffer.from('x'), { filename: 'x.png', contentType: 'image/png' });

    expect(res.status).toBe(200);
    expect(typeof res.body.stagedUploadId).toBe('string');
    expect(
      replaceStaging.resolve(res.body.stagedUploadId as string, ADMIN_STAGING_ID, 'cover')
    ).not.toBeNull();
    expect(replaceStaging.resolve(res.body.stagedUploadId as string, aliceId, 'cover')).toBeNull();
  });

  // Task 4: `coverUpload` (shared with `PATCH /api/books/:id/metadata`'s
  // multipart-cover branch) is raised from its previous 10MB to 20MB here.
  it('rejects a file over the 20MB cap with 413, not the generic 500', async () => {
    const token = await loginAlice();
    const res = await request(app)
      .post('/api/books/cover-staging')
      .set(...bearer(token))
      .attach('cover', oversizedStream(20 * 1024 * 1024 + 1), {
        filename: 'huge.png',
        contentType: 'image/png',
      });
    expect(res.status).toBe(413);
    expect(res.body).toEqual({ error: 'File too large' });
  }, 30000);
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

  it("user A cannot reach user B's book", async () => {
    const res = await request(app)
      .get(`/api/books/${aliceBookId}/download`)
      .set(...bearer(bobToken));
    expect(res.status).toBe(404);
  });

  it('non-admin sending ?user= gets 403', async () => {
    const res = await request(app)
      .get(`/api/books/${aliceBookId}/download?user=alice`)
      .set(...bearer(bobToken));
    expect(res.status).toBe(403);
  });

  it('admin without ?user= gets 400', async () => {
    const token = await loginAdmin();
    const res = await request(app)
      .get(`/api/books/${aliceBookId}/download`)
      .set(...bearer(token));
    expect(res.status).toBe(400);
  });

  it('admin with ?user= operates on the target library', async () => {
    const token = await loginAdmin();
    const res = await request(app)
      .get(`/api/books/${aliceBookId}/download?user=alice`)
      .set(...bearer(token));
    expect(res.status).toBe(200);
  });

  it('admin targeting an unknown user gets 404', async () => {
    const token = await loginAdmin();
    const res = await request(app)
      .get(`/api/books/${aliceBookId}/download?user=nobody`)
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

// The guard that keeps the catch-all above from swallowing API paths. Every
// route this router shed in the GraphQL migration now lands here, and a
// caller that reaches one must get a parseable JSON 404 rather than 200 with
// an HTML body.
describe('unmatched /api/* paths', () => {
  it('GET at a retired API path returns a JSON 404, not the SPA', async () => {
    const token = await loginAlice();
    const res = await request(app)
      .get('/api/books')
      .set(...bearer(token));
    expect(res.status).toBe(404);
    expect(res.body).toEqual({ error: 'Not found' });
    expect(res.text).not.toContain('<!DOCTYPE html>');
  });

  it('answers 404 for a retired non-GET API path too', async () => {
    const token = await loginAlice();
    const res = await request(app)
      .patch('/api/books/someid/metadata')
      .set(...bearer(token))
      .send({ title: 'x' });
    expect(res.status).toBe(404);
    expect(res.body).toEqual({ error: 'Not found' });
  });

  it('answers 404 for an unknown API path without a token', async () => {
    const res = await request(app).get('/api/nope');
    expect(res.status).toBe(404);
    expect(res.body).toEqual({ error: 'Not found' });
  });

  it('does not shadow a surviving API route', async () => {
    const res = await request(app).get('/api/public-config');
    expect(res.status).toBe(200);
    expect(res.body.libraryName).toEqual(expect.any(String));
  });

  it('leaves non-API paths on the SPA catch-all', async () => {
    const res = await request(app).get('/apiary');
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
      .get('/api/books/whatever/download')
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
