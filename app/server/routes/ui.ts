import { createHash, randomUUID } from 'crypto';
import * as fs from 'fs';
import * as path from 'path';

import { decodeGlobalID, encodeGlobalID } from '@pothos/plugin-relay';
import express, { Router, Request, RequestHandler, Response } from 'express';
import multer from 'multer';

import { deriveCurrentChapter } from '../graphql/derive';
import { parseCompoundId } from '../graphql/schema/node-scope';
import { logger } from '../logger';
import { jwtAuth, passwordChangeGate } from '../middleware/auth';
import { applyEpubChanges, replaceEpubBytes } from '../services/apply-epub-changes';
import {
  BookStore,
  BookHashCollisionError,
  BookAlreadyExistsError,
  SelfLinkError,
  DocumentAlreadyLinkedError,
  DocumentIsBookError,
} from '../services/book-store';
import { analyzeEpub, applyAutoAndAccepted, EpubAnalysis } from '../services/epub-import-pipeline';
import { parseEpub, partialMD5 } from '../services/epub-parser';
import { EpubValidationError } from '../services/epub-validator';
import { EpubChanges, repairPackageDocument } from '../services/epub-writer';
import { signAccessToken, AuthUser } from '../services/jwt';
import { stagingIdentityOf, type ReplaceStaging } from '../services/replace-staging';
import { revalidateBook, revalidateLibrary } from '../services/revalidate-library';
import { ScanJobStore } from '../services/scan-job-store';
import { ThumbnailQueue } from '../services/thumbnail-queue';
import { TokenStore, REFRESH_TOKEN_TTL_MS } from '../services/token-store';
import { UserStore } from '../services/user-store';
import { ValidationStore } from '../services/validation-store';
import {
  AppConfig,
  BookListFilters,
  EpubMeta,
  MetadataFix,
  Owner,
  PageCursor,
  SearchSuggestionsResponse,
} from '../types';
import { asyncHandler } from '../utils/async-handler';
import { decodeProgressCursor, parseProgressTake } from '../utils/progress-pagination';

const log = logger('UI');

const ALLOWED_EXTENSIONS = new Set(['.epub']);

/**
 * Shared multer `fileSize` caps (Task 4, pre-client-polish plan §5): EPUB
 * uploads (bulk `/api/books/upload` and staged-EPUB `/api/books/replace-
 * staging`) at 200MB, covers (`/api/books/cover-staging` and the legacy
 * multipart-cover branch of `PATCH /api/books/:id/metadata`) at 20MB.
 * `epubUpload` already carried the 200MB figure pre-Task-4 (bumped up from
 * the plain `upload` instance's previous UNBOUNDED limit — see `upload`
 * below); `coverUpload` is raised here from its previous 10MB. One constant
 * per size, not a hand-typed number at each of the three `multer({...})`
 * call sites, so "align, don't duplicate" (plan wording) holds literally:
 * `coverUpload` is the single multer instance both cover routes share
 * already, and both EPUB routes share `epubUpload`/`upload`'s own limit is
 * set from the same constant `epubUpload` uses.
 *
 * Both caps are EXCLUSIVE, not inclusive maxima (review M-2, confirmed by
 * probe): multer/busboy reject a file at EXACTLY the configured `fileSize`,
 * so the largest file either cap actually admits is `LIMIT - 1` bytes, not
 * `LIMIT`. Pre-existing multer semantics (the old 10MB `coverUpload` figure
 * behaved identically), one byte, no practical effect — noted here rather
 * than silently read as "up to and including 20MB".
 */
const EPUB_UPLOAD_MAX_BYTES = 200 * 1024 * 1024;
const COVER_UPLOAD_MAX_BYTES = 20 * 1024 * 1024;

/**
 * Wraps a multer middleware so exceeding its `fileSize` limit surfaces as
 * an ordinary 413 JSON response, instead of falling through to server.ts's
 * generic "Internal server error" 500 catch-all (Task 4). Multer reports
 * its own errors (`MulterError`, `code: 'LIMIT_FILE_SIZE'` here) via
 * `next(err)`, called from INSIDE multer's own middleware function, before
 * the route's `asyncHandler`-wrapped handler ever runs — `asyncHandler`
 * only catches a rejected promise from the handler it wraps, so it cannot
 * intercept an error multer raises one middleware earlier. Any other
 * multer error (a `fileFilter` rejection never reaches here — it resolves
 * `req.file` to `undefined` instead of erroring, per multer's own
 * contract) is forwarded to `next(err)` unchanged, preserving whatever the
 * app's top-level error middleware already does with it.
 *
 * Module scope (review N-1: an earlier version was declared inside
 * `createUiRouter`, but closes over nothing router-scoped — only the
 * `multer` import — so there was no reason to rebuild it per router
 * instance).
 */
function withUploadLimit(mw: RequestHandler): RequestHandler {
  return (req, res, next) => {
    mw(req, res, (err: unknown) => {
      if (err instanceof multer.MulterError && err.code === 'LIMIT_FILE_SIZE') {
        res.status(413).json({ error: 'File too large' });
        return;
      }
      next(err);
    });
  };
}

const ISO_8601_RE = /^\d{4}(-\d{2}(-\d{2}(T\d{2}:\d{2}(:\d{2}(\.\d+)?)?(Z|[+-]\d{2}:\d{2})?)?)?)?$/;

/**
 * Returns the authenticated user's surrogate ID, or null after responding
 * with 401 (e.g. a token for a since-deleted user, or an admin token used
 * on a user-only route that already passed the isAdmin check).
 */
function requireUserId(req: Request, res: Response): string | null {
  const userId = req.user?.userId;
  if (!userId) {
    log.warn(`Token missing userId for "${req.user?.username ?? 'unknown'}"`);
    res.status(401).json({ error: 'Session expired. Please log in again.' });
    return null;
  }
  return userId;
}

/**
 * The authenticated caller's staging-registry identity — `requireUserId`'s
 * sibling for the two staging routes, `POST /api/books/replace-staging` and
 * `POST /api/books/cover-staging`, only. Unlike `requireUserId`, an admin
 * session (`req.user.userId` unset) is ACCEPTED here (Task 4): it resolves
 * to `ADMIN_STAGING_ID`, the same sentinel `stagingIdentityOf`
 * (`services/replace-staging.ts`) is documented to return for admin
 * callers — the GraphQL staged mutations (`bookAnalyzeReplace`/`bookReplace`/
 * `bookUpdateMetadata`) resolve staged files with the identical helper, so
 * an admin who stages here can consume it there. Only returns null (and
 * 401s, same message/shape as `requireUserId`) for a request that reached
 * this route with neither a userId nor `isAdmin` set — `requireAuth`
 * already rules that out in practice; this is defense-in-depth, matching
 * `requireUserId`'s own belt-and-suspenders shape.
 */
function requireStagingIdentity(req: Request, res: Response): string | null {
  const identity = stagingIdentityOf(req.user!);
  if (identity === null) {
    log.warn(`Token missing userId for "${req.user?.username ?? 'unknown'}"`);
    res.status(401).json({ error: 'Session expired. Please log in again.' });
    return null;
  }
  return identity;
}

const VALID_STATUSES = new Set(['not-started', 'in-progress', 'completed']);

const LOGIN_RATE_LIMIT_WINDOW_MS = 60 * 1000;
const LOGIN_RATE_LIMIT_MAX_ATTEMPTS = 10;
// Final-review-wave T4: below this size, sweeping on every call is cheap
// enough not to matter; gating the O(n) walk behind it means the common
// case (a handful of active windows) never pays a per-request Map scan at
// all — see `createLoginRateLimit`'s doc comment for the full trade-off.
const LOGIN_RATE_LIMIT_SWEEP_THRESHOLD = 256;

type LoginRateLimitWindow = { count: number; windowStart: number };

/**
 * Resolves the client IP the login limiter should key on — used ONLY here,
 * never as Express's own `req.ip`/`trust proxy` setting (review I-2:
 * deliberately not touched globally — that setting also changes
 * `req.secure`/cookie semantics app-wide, a strictly bigger change than
 * this one control needs, and this app already special-cases Cloudflare-
 * proxy behavior in several places — `server.ts`, `middleware/timeout.ts`
 * — without ever setting it).
 *
 * `trustProxyHops` (see `AppConfig.trustProxyHops`'s doc comment, `types.ts`,
 * for the full contract): `0` (or unset — the conservative default) returns
 * `req.socket.remoteAddress` unconditionally, ignoring `X-Forwarded-For`
 * entirely — a spoofed header cannot influence the key. `N > 0` trusts the
 * last `N` hops: build the chain `[client, proxy1, ..., proxyK]` from the
 * header (left-to-right, closest-to-client first — the standard
 * `X-Forwarded-For` convention), then walk back `N` positions from the end
 * to find the address the Nth-trusted-hop-back added — the same algorithm
 * Express's own `trust proxy: n` numeric mode uses internally (`proxy-addr`),
 * just computed by hand here so it affects only this function. Re-review:
 * differential-tested against `proxy-addr` across 80 header/hop-count
 * combinations and matches it on every one WHERE the header has at least
 * `N` entries. The two implementations deliberately DIVERGE, not
 * accidentally, when the header is shorter than `N` (a misconfigured
 * `trustProxyHops`, or a proxy that isn't appending as expected): `proxy-
 * addr` falls through to the leftmost (client-writable) header entry, which
 * a client can forge to mint an arbitrary bucket; this function falls back
 * to the direct peer instead — under-trusting fails safe, `proxy-addr`'s
 * behavior in that same case does not. Every one of the review's 32
 * divergent cases was this function choosing the safer of the two, never
 * the reverse. Over-trusting (`trustProxyHops` set higher than the real hop
 * count, so the chain legitimately has ≥N entries but the Nth-from-the-end
 * one is still a proxy, not the client) is an operator error neither
 * implementation can detect from inside a single request — why
 * `AppConfig.trustProxyHops`'s doc comment warns against it explicitly.
 */
function resolveLoginClientIp(req: Request, trustProxyHops: number): string {
  const direct = req.socket.remoteAddress ?? 'unknown';
  if (trustProxyHops <= 0) return direct;

  const header = req.headers['x-forwarded-for'];
  const raw = Array.isArray(header) ? header[0] : header;
  if (typeof raw !== 'string' || raw.trim() === '') return direct;

  const chain = raw
    .split(',')
    .map((s) => s.trim())
    .filter((s) => s.length > 0);
  const clientIndex = chain.length - trustProxyHops;
  return clientIndex >= 0 ? chain[clientIndex] : direct;
}

/**
 * Fixed-window rate limiter for `POST /api/login` only (Task 4): 10 attempts
 * per minute per IP, 429 + `Retry-After` on the 11th. Deliberately NOT
 * applied to the OPDS (`routes/opds.ts`) or KOReader sync-password
 * (`routes/kosync.ts`) auth endpoints — those are separate routers with
 * their own `opdsAuth`/`kosyncAuth` middleware (`middleware/auth.ts`), never
 * routed through this function at all. That's deliberate, not an oversight:
 * e-reader/sync clients retry aggressively and automatically on transient
 * network failures (device-side retry storms), or a client typo would lock
 * the DEVICE out of syncing for a window with no user present to notice or
 * retry manually the way a browser login form's user would; the existing
 * mitigation for those endpoints is bcrypt's own cost factor on every
 * attempt, not a request-count limiter.
 *
 * `createReplaceStaging`'s TTL-sweep SHAPE, followed literally, on a
 * different cadence (review I-1: an earlier version of this function only
 * replaced the CURRENT ip's window when stale, which is a per-key reset,
 * not a sweep — every other ip's window lived for the lifetime of the
 * process; a 500k-distinct-IP probe retained 48.3MB never reclaimed).
 * `sweep()` below iterates the whole `windows` Map and deletes every entry
 * whose `windowStart` has aged out — the same iterate-and-delete mechanics
 * `replace-staging.ts`'s own `sweep()` uses, no timer either way, but NOT
 * the same trigger: that precedent sweeps only from `stage()` (new state
 * being written); this one sweeps from every gated `loginRateLimit` call
 * (see the size gate below), including read-only-outcome ones (a request
 * that gets 429'd still triggers a sweep once gated) — unauthenticated
 * login attempts are the only "write" this function has, so every gated
 * call is the sweep trigger, not a subset of them. `size()` is exposed so a
 * test can pin the sweep directly (observing the Map's size) rather than
 * only inferring it from request-response behavior.
 *
 * Size-gated (final-review-wave T4): the O(n) bulk `sweep()` walk only RUNS
 * once `windows.size` exceeds `LOGIN_RATE_LIMIT_SWEEP_THRESHOLD` — bounded
 * by distinct client IPs within one 60s window, so ordinary traffic (a
 * handful of concurrently active windows) never pays a Map scan on every
 * single request, only once the map has grown large enough for a scan to be
 * worth its own cost. Memory is still bounded exactly as I-1 fixed it: the
 * gate only changes WHEN the bulk walk runs, never removes it. THIS ip's own
 * window staleness is still checked separately, at O(1), in
 * `loginRateLimit` itself below — the gate must not weaken per-key
 * correctness for the common (small-map) case, only defer the whole-Map
 * reclamation.
 *
 * `now` is injected as a `() => number` parameter, same shape as
 * `ReplaceStagingDeps.now` — production omits it (defaults to `Date.now`),
 * tests supply a controllable clock so "window expiry admits again" needs
 * no fake timers.
 *
 * A successful login does NOT reset the counter: simpler (one code path for
 * every attempt, success or failure) and safer (a compromised or leaked
 * password being tried successfully 11 times in a minute is exactly the
 * pattern worth throttling too, not a signal to open the window back up).
 *
 * Factory shape mirrors `graphqlBodyLimit` (`middleware/graphql-body-
 * limit.ts`): called once per router build (`createUiRouter`, below), so
 * each test's fresh `createUiRouter(...)` call gets its own isolated Map —
 * no state leaks between tests the way one process-lifetime singleton would.
 *
 * `trustProxyHops` (review I-2) is forwarded to `resolveLoginClientIp` — see
 * that function's doc comment for the full contract; `0` (the default) keys
 * on the raw TCP peer, matching this function's pre-fix behavior exactly.
 */
export function createLoginRateLimit(now: () => number = Date.now, trustProxyHops = 0) {
  const windows = new Map<string, LoginRateLimitWindow>();

  function sweep(current: number): void {
    for (const [ip, window] of windows) {
      if (current - window.windowStart >= LOGIN_RATE_LIMIT_WINDOW_MS) {
        windows.delete(ip);
      }
    }
  }

  function loginRateLimit(req: Request, res: Response, next: express.NextFunction): void {
    const current = now();
    if (windows.size > LOGIN_RATE_LIMIT_SWEEP_THRESHOLD) sweep(current);
    const ip = resolveLoginClientIp(req, trustProxyHops);

    // THIS ip's own window is checked for staleness directly (O(1)) rather
    // than relying on `sweep()` to have dropped it — since the bulk sweep is
    // now size-gated (final-review-wave T4) it may not have run this call at
    // all, so a plain `undefined` check alone would let a stale window's
    // stale count keep accumulating forever below the threshold. This is the
    // one piece of the pre-I-1 per-key logic the size gate brings back;
    // sweep's job is now purely bulk memory reclamation for OTHER ips, not
    // this ip's own correctness.
    let window = windows.get(ip);
    if (window === undefined || current - window.windowStart >= LOGIN_RATE_LIMIT_WINDOW_MS) {
      window = { count: 0, windowStart: current };
      windows.set(ip, window);
    }
    window.count += 1;

    if (window.count > LOGIN_RATE_LIMIT_MAX_ATTEMPTS) {
      const retryAfterSeconds = Math.ceil(
        (window.windowStart + LOGIN_RATE_LIMIT_WINDOW_MS - current) / 1000
      );
      log.warn(`Login rate limit exceeded for ${ip}`);
      res
        .status(429)
        .set('Retry-After', String(Math.max(retryAfterSeconds, 1)))
        .json({ error: 'Too many login attempts. Please try again later.' });
      return;
    }
    next();
  }

  loginRateLimit.size = (): number => windows.size;
  return loginRateLimit;
}

export function createUiRouter(
  bookStore: BookStore,
  userStore: UserStore,
  config: AppConfig,
  thumbnailQueue: ThumbnailQueue,
  tokenStore: TokenStore,
  jwtSecret: Buffer,
  scanJobStore: ScanJobStore,
  validationStore: ValidationStore,
  replaceStaging: ReplaceStaging,
  loginRateLimitNow: () => number = Date.now
): Router {
  const router = Router();

  const requireAuth = jwtAuth(jwtSecret);
  const loginRateLimit = createLoginRateLimit(loginRateLimitNow, config.trustProxyHops ?? 0);

  const REFRESH_COOKIE = 'refresh_token';
  const REFRESH_COOKIE_PATH = '/api/auth';

  async function issueTokens(res: Response, user: AuthUser): Promise<void> {
    const accessToken = signAccessToken(jwtSecret, user);
    const refreshToken = await tokenStore.createRefreshToken({
      username: user.username,
      userId: user.userId ?? null,
    });
    res.cookie(REFRESH_COOKIE, refreshToken, {
      httpOnly: true,
      sameSite: 'strict',
      path: REFRESH_COOKIE_PATH,
      maxAge: REFRESH_TOKEN_TTL_MS,
    });
    res.json({ accessToken });
  }

  function clearRefreshCookie(res: Response): void {
    res.clearCookie(REFRESH_COOKIE, { path: REFRESH_COOKIE_PATH });
  }

  const stagingDir = bookStore.getStagingDir();
  const storage = multer.diskStorage({
    destination: (_req, _file, cb) => {
      try {
        fs.mkdirSync(stagingDir, { recursive: true });
        cb(null, stagingDir);
      } catch (err) {
        cb(err as Error, stagingDir);
      }
    },
    filename: (_req, file, cb) => {
      const unique = `${Date.now()}-${Math.random().toString(36).slice(2, 10)}`;
      cb(null, `${unique}-${path.basename(file.originalname)}`);
    },
  });

  const upload = multer({
    storage,
    limits: { fileSize: EPUB_UPLOAD_MAX_BYTES },
    fileFilter: (_req, file, cb) => {
      const ext = path.extname(file.originalname).toLowerCase();
      cb(null, ALLOWED_EXTENSIONS.has(ext));
    },
  });

  const coverUpload = multer({
    storage: multer.memoryStorage(),
    limits: { fileSize: COVER_UPLOAD_MAX_BYTES },
    fileFilter: (_req, file, cb) => {
      cb(null, file.mimetype.startsWith('image/'));
    },
  });

  const epubUpload = multer({
    storage: multer.memoryStorage(),
    limits: { fileSize: EPUB_UPLOAD_MAX_BYTES },
    fileFilter: (_req, file, cb) => {
      cb(null, ALLOWED_EXTENSIONS.has(path.extname(file.originalname).toLowerCase()));
    },
  });

  /**
   * Resolves which library this request operates on. Regular users always get
   * their own library (passing ?user= is forbidden). Admin sessions have no
   * library, so they must name a target via ?user=<username>.
   * Responds with the appropriate error and returns null when unresolvable.
   */
  async function resolveOwner(req: Request, res: Response): Promise<Owner | null> {
    const target = req.query.user;
    if (req.user!.isAdmin) {
      if (typeof target !== 'string' || !target.trim()) {
        res.status(400).json({ error: 'user query parameter is required for admin sessions' });
        return null;
      }
      const userId = await userStore.getUserIdByUsername(target);
      if (!userId) {
        res.status(404).json({ error: 'User not found' });
        return null;
      }
      return { userId, username: target };
    }
    if (target !== undefined) {
      res.status(403).json({ error: 'Forbidden' });
      return null;
    }
    const userId = requireUserId(req, res);
    if (!userId) return null;
    return { userId, username: req.user!.username };
  }

  /**
   * TEMPORARY (Task 13). Dies with this route: `/api/books/:id` and its
   * siblings below are on spec 3's deletion list, and this dual-form
   * acceptance is not a permanent identifier design — do not extend it or
   * copy it elsewhere.
   *
   * GraphQL's `Book.id` is a Relay global ID encoding `[userId, bookId]`
   * (spec 1's book-relay-id pass removed the raw `bookId` field from the
   * schema entirely — the global ID is now the only book identifier
   * GraphQL emits). But `page/book` is still REST, and the GraphQL-fed
   * library grid navigates to it with that global ID in the URL, which
   * flows straight through to this route's `:id` param. Resolves either
   * form to the raw, content-hash id `bookStore` expects; a raw id (every
   * screen not yet on GraphQL) passes through unchanged.
   *
   * Reuses the schema's own `parseCompoundId` (`graphql/schema/node-
   * scope.ts`) rather than hand-rolling base64/JSON parsing — same
   * encoding, same decoder.
   *
   * THE RULE: the decoded id's embedded userId is a claim, not a
   * credential. It is checked against `owner.userId` — the target THIS
   * request already resolved via `resolveOwner` (the caller's own library,
   * or an admin's `?user=`-named one) — and refused (returns null) on any
   * mismatch. `?user=`/the caller's own session stays authoritative for
   * which library a request targets; a global id can only ever point INTO
   * that already-resolved library, never override it to a different one.
   * Concretely: if an admin passes `?user=bob` but the id decodes to
   * alice's userId, the two disagree and the request is refused — same as
   * it would be if a raw id simply didn't belong to bob's library.
   *
   * WHAT THIS CHECK IS FOR (security-reviewed, Task 13 round 2): every
   * caller of this function passes the returned local id straight into a
   * `bookStore` method that re-scopes its own query by `owner.userId`
   * (`prisma.book.findUnique({ where: { userId_id: { userId:
   * owner.userId, id } } })`, `book-store.ts`) — so for tenant isolation
   * specifically, this check is REDUNDANT with that query today; removing
   * it does not open a cross-tenant read (verified: reducing this function
   * to `return bookId` unconditionally leaves every cross-tenant test in
   * `ui.test.ts`'s Task 13 suite green). What it DOES do, non-redundantly:
   * (1) since book ids are content hashes and two owners routinely hold
   * the same id for the same file (`graphql/schema/node-scope.ts`'s
   * `NO_MATCH_USER_ID` doc comment), without this check a global id naming
   * one owner's book could resolve — via that same owner-scoped query — to
   * a DIFFERENT book the *caller* happens to own under the same hash,
   * silently substituting it; this check refuses that case instead
   * (pinned by the collision test in `ui.test.ts`, the one case besides
   * the admin-`?user=`-disagreement above that actually goes red without
   * it); (2) it is the boundary that stays correct if some future edit
   * ever lets the decoded id reach a query that ISN'T independently
   * re-scoped by `owner` — the exact mistake `graphql/schema/node-
   * scope.ts`'s `ownerScopedFindUnique` exists to prevent on the GraphQL
   * side, one file over, and the pattern a contributor extending this
   * route later could plausibly reach for.
   *
   * Never throws. A string that isn't a well-formed `Book` global id
   * (fails `decodeGlobalID`, decodes to a non-`Book` typename, or fails
   * `parseCompoundId`) is passed through unchanged as a raw id — matching
   * today's behavior for every existing raw id: an unresolvable/malformed
   * id simply fails to match any book downstream and 404s, same as any
   * other unknown raw id does today.
   */
  function resolveBookLocalId(owner: Owner, rawId: string): string | null {
    let decoded: { typename: string; id: string };
    try {
      decoded = decodeGlobalID(rawId);
    } catch {
      return rawId;
    }
    if (decoded.typename !== 'Book') return rawId;
    const parsed = parseCompoundId(decoded.id);
    if (parsed === null) return rawId;
    const [userId, bookId] = parsed;
    return userId === owner.userId ? bookId : null;
  }

  /**
   * The exact inverse of `resolveBookLocalId` above, and byte-identical to
   * the formula GraphQL's own `book/mutation/delete.ts` already uses for
   * `deletedId` (`encodeGlobalID('Book', JSON.stringify([owner.userId,
   * deleted.id]))`) — not a fresh encoding scheme invented for REST.
   *
   * 2026-08-13 final review, C-2 (human ruling, Option 1): `PATCH .../
   * metadata` and `POST .../replace` both return a NEW raw id (editing
   * metadata or replacing the file changes the content hash), and
   * `page/book` (GraphQL) needs a Relay global id to navigate back to it —
   * there is no client-side way to produce one without this. Named
   * `bookGlobalId` (a local helper, not a response field name) to keep this
   * unambiguously distinct from `resolveBookLocalId` above; the two REST
   * response bodies that call it expose it as `globalId` — see their own
   * comments for why that field name, not `id` (already means the raw hash
   * in every REST response) or `documentId` (means raw on the GraphQL side).
   */
  function bookGlobalId(owner: Owner, rawId: string): string {
    return encodeGlobalID('Book', JSON.stringify([owner.userId, rawId]));
  }

  // ── Auth ──────────────────────────────────────────────

  const serveSpa = (_req: Request, res: Response): void => {
    res.sendFile(path.join(__dirname, '../../../client/dist/index.html'));
  };

  router.get('/login', serveSpa);

  router.get('/api/public-config', (_req: Request, res: Response) => {
    res.json({ libraryName: config.libraryName });
  });

  router.use(passwordChangeGate(jwtSecret));

  router.post(
    '/api/login',
    loginRateLimit,
    asyncHandler(async (req: Request, res: Response) => {
      const { username, password } = req.body as { username?: string; password?: string };
      if (typeof username !== 'string' || typeof password !== 'string') {
        res.sendStatus(401);
        return;
      }
      if (username === config.username && password === config.password) {
        log.info(`Admin "${username}" logged in`);
        await tokenStore.deleteExpired();
        await issueTokens(res, { username, isAdmin: true, mustChangePassword: false });
        return;
      }
      if ((await userStore.userExists(username)) && !(await userStore.userHasPassword(username))) {
        log.warn(`Login failed for "${username}" — password not set`);
        res.sendStatus(403);
        return;
      }
      const userId = await userStore.validateUser(username, password);
      if (userId) {
        log.info(`User "${username}" logged in`);
        await tokenStore.deleteExpired();
        await issueTokens(res, {
          userId,
          username,
          isAdmin: false,
          mustChangePassword: await userStore.getMustChangePassword(username),
        });
        return;
      }
      log.warn(`Login failed for username "${username ?? ''}"`);
      res.sendStatus(401);
    })
  );

  router.post(
    '/api/auth/refresh',
    asyncHandler(async (req: Request, res: Response) => {
      const raw = (req.cookies as Record<string, string> | undefined)?.refresh_token;
      const reject = (): void => {
        clearRefreshCookie(res);
        res.status(401).json({ error: 'Unauthorized' });
      };
      if (typeof raw !== 'string' || !raw) {
        reject();
        return;
      }
      const identity = await tokenStore.consumeRefreshToken(raw);
      if (!identity) {
        log.warn('Refresh rejected — unknown, reused, or expired refresh token');
        reject();
        return;
      }
      if (identity.username === config.username) {
        await issueTokens(res, {
          username: identity.username,
          isAdmin: true,
          mustChangePassword: false,
        });
        return;
      }
      // Rebuild claims from current state so renames/deletes and admin actions propagate.
      const userId = await userStore.getUserIdByUsername(identity.username);
      if (!userId) {
        log.warn(`Refresh rejected — user "${identity.username}" no longer exists`);
        reject();
        return;
      }
      await issueTokens(res, {
        userId,
        username: identity.username,
        isAdmin: false,
        mustChangePassword: await userStore.getMustChangePassword(identity.username),
      });
    })
  );

  router.post(
    '/api/auth/logout',
    asyncHandler(async (req: Request, res: Response) => {
      const raw = (req.cookies as Record<string, string> | undefined)?.refresh_token;
      if (typeof raw === 'string' && raw) {
        await tokenStore.revokeRefreshToken(raw);
      }
      log.info('User logged out');
      clearRefreshCookie(res);
      res.status(204).send();
    })
  );

  router.get('/api/config', requireAuth, (_req: Request, res: Response) => {
    res.json({
      libraryName: config.libraryName,
      maxConcurrentUploads: config.maxConcurrentUploads,
    });
  });

  router.get(
    '/api/my/progress',
    requireAuth,
    asyncHandler(async (req: Request, res: Response) => {
      if (req.user!.isAdmin) {
        res.json({ items: [], nextCursor: null });
        return;
      }
      const userId = requireUserId(req, res);
      if (!userId) return;
      const owner: Owner = { userId, username: req.user!.username };
      const cursor = decodeProgressCursor(req.query.cursor);
      const take = parseProgressTake(req.query.take);
      const page = await userStore.getUserProgressPage(userId, cursor, take);
      const spineMaps = await bookStore.getChapterSpineMaps(
        owner,
        page.items.map((p) => p.document)
      );
      const items = page.items.map((p) => {
        const spineMap = spineMaps.get(p.document);
        const currentChapter = deriveCurrentChapter(p.progress, spineMap) ?? undefined;
        return {
          ...p,
          ...(currentChapter !== undefined ? { currentChapter } : {}),
        };
      });
      res.json({ items, nextCursor: page.nextCursor });
    })
  );

  router.delete(
    '/api/my/progress/:document',
    requireAuth,
    asyncHandler(async (req: Request, res: Response) => {
      if (req.user!.isAdmin) {
        res.status(403).json({ error: 'Forbidden' });
        return;
      }
      const userId = requireUserId(req, res);
      if (!userId) return;
      // Permissive, not the strict `resolveBookLocalId` treatment the other
      // book routes get: `:document` is a KOReader document id, and a
      // progress row may legitimately exist for a document with no `Book`
      // row at all (an e-reader syncing a book outside the library). A Book
      // global ID still resolves to its raw id (and, since resolution
      // includes the owner check, a cross-tenant one still 404s instead of
      // clearing a stray row under a hash nobody owns); anything else
      // — including an ordinary document hash — passes through untouched,
      // exactly as `resolveBookLocalId` already behaves for non-global-ID
      // input.
      const owner: Owner = { userId, username: req.user!.username };
      const documentId = resolveBookLocalId(owner, req.params.document);
      if (documentId === null) {
        res.status(404).json({ error: 'Progress record not found' });
        return;
      }
      const cleared = await userStore.clearProgress(userId, documentId);
      if (!cleared) {
        res.status(404).json({ error: 'Progress record not found' });
        return;
      }
      res.status(204).send();
    })
  );

  router.put(
    '/api/my/progress/:document',
    requireAuth,
    asyncHandler(async (req: Request, res: Response) => {
      if (req.user!.isAdmin) {
        res.status(403).json({ error: 'Forbidden' });
        return;
      }
      const userId = requireUserId(req, res);
      if (!userId) return;
      const owner: Owner = { userId, username: req.user!.username };
      // See the DELETE sibling above for why this resolution is permissive
      // rather than the strict treatment the other book routes get.
      const documentId = resolveBookLocalId(owner, req.params.document);
      if (documentId === null) {
        res.status(404).json({ error: 'Progress record not found' });
        return;
      }
      const { currentChapter, percentage, device, device_id } = req.body as Record<string, unknown>;
      if (
        typeof currentChapter !== 'number' ||
        !Number.isInteger(currentChapter) ||
        currentChapter < 1 ||
        typeof percentage !== 'number' ||
        percentage <= 0 ||
        percentage > 1
      ) {
        res.status(400).json({ error: 'Invalid body' });
        return;
      }
      // Synthesise a minimal EPUB CFI so currentChapter persists through GET /api/my/progress
      const book = await bookStore.getBookById(owner, documentId);
      let progress = '';
      if (
        book &&
        book.chapterSpineMap.length > 0 &&
        currentChapter <= book.chapterSpineMap.length
      ) {
        const spineIndex = book.chapterSpineMap[currentChapter - 1];
        progress = `EPUB_CFI(/6/${spineIndex * 2 + 2}!/4/2:0)`;
      }
      await userStore.saveProgress(userId, {
        document: documentId,
        progress,
        percentage,
        device: typeof device === 'string' && device ? device : 'Web',
        device_id: typeof device_id === 'string' ? device_id : '',
      });
      res.status(200).json({});
    })
  );

  router.patch(
    '/api/my/password',
    requireAuth,
    asyncHandler(async (req: Request, res: Response) => {
      if (req.user!.isAdmin) {
        res.status(403).json({ error: 'Forbidden' });
        return;
      }
      const userId = requireUserId(req, res);
      if (!userId) return;
      const { currentPassword, newPassword } = req.body as {
        currentPassword?: string;
        newPassword?: string;
      };
      if (
        typeof currentPassword !== 'string' ||
        !currentPassword ||
        typeof newPassword !== 'string' ||
        !newPassword
      ) {
        res.status(400).json({ error: 'Current and new password are required' });
        return;
      }
      const valid = await userStore.validateUser(req.user!.username, currentPassword);
      if (!valid) {
        res.status(401).json({ error: 'Current password is incorrect' });
        return;
      }
      const newHash = await UserStore.hashLoginPassword(newPassword);
      const changed = await userStore.changePassword(req.user!.username, newHash);
      if (!changed) {
        res.status(404).json({ error: 'User not found' });
        return;
      }
      log.info(`User "${req.user!.username}" changed their password`);
      // Revoke all outstanding refresh tokens, then hand back a fresh pair so
      // the client immediately holds claims with mustChangePassword: false.
      await tokenStore.revokeAllForUsername(req.user!.username);
      await issueTokens(res, {
        userId,
        username: req.user!.username,
        isAdmin: false,
        mustChangePassword: false,
      });
    })
  );

  router.get(
    '/api/my/sync-password',
    requireAuth,
    asyncHandler(async (req: Request, res: Response) => {
      if (req.user!.isAdmin) {
        res.status(403).json({ error: 'Forbidden' });
        return;
      }
      const syncPassword = await userStore.getSyncPassword(req.user!.username);
      if (syncPassword === null) {
        res.status(404).json({ error: 'User not found' });
        return;
      }
      res.json({ syncPassword });
    })
  );

  router.post(
    '/api/my/sync-password/regenerate',
    requireAuth,
    asyncHandler(async (req: Request, res: Response) => {
      if (req.user!.isAdmin) {
        res.status(403).json({ error: 'Forbidden' });
        return;
      }
      const newPassword = UserStore.generateSyncPassword();
      const changed = await userStore.changeSyncPassword(req.user!.username, newPassword);
      if (!changed) {
        res.status(404).json({ error: 'User not found' });
        return;
      }
      log.info(`User "${req.user!.username}" regenerated sync password`);
      res.json({ syncPassword: newPassword });
    })
  );

  // ── Static assets (no auth required) ──────────────────
  // Serves the built client's hashed bundles (/assets/*) plus root brand files
  // (favicon.ico, favicon.svg, apple-touch-icon, site.webmanifest, /png/*).
  // `index: false` so "/" falls through to the SPA catch-all below.
  router.use(express.static(path.join(__dirname, '../../../client/dist'), { index: false }));

  router.get(
    '/api/books',
    requireAuth,
    asyncHandler(async (req: Request, res: Response) => {
      const owner = await resolveOwner(req, res);
      if (!owner) return;

      const { cursor, take, status, query, author, seriesName, subjects, entryType } = req.query;

      if (status !== undefined && (typeof status !== 'string' || !VALID_STATUSES.has(status))) {
        res.status(400).json({
          error: 'Invalid status. Must be "not-started", "in-progress", or "completed".',
        });
        return;
      }

      const entryTypeValue =
        entryType === 'series' || entryType === 'standalone' ? entryType : undefined;

      const queryValue = typeof query === 'string' && query ? query : undefined;
      const authorValue = typeof author === 'string' && author ? author : undefined;
      const seriesNameValue = typeof seriesName === 'string' && seriesName ? seriesName : undefined;
      const subjectsValue: string[] = Array.isArray(subjects)
        ? (subjects as string[]).filter((s): s is string => typeof s === 'string' && s.length > 0)
        : typeof subjects === 'string' && subjects
          ? [subjects]
          : [];

      const filters: BookListFilters | undefined =
        status !== undefined ||
        queryValue !== undefined ||
        authorValue !== undefined ||
        seriesNameValue !== undefined ||
        subjectsValue.length > 0 ||
        entryTypeValue !== undefined
          ? {
              status: status as BookListFilters['status'],
              query: queryValue,
              author: authorValue,
              seriesName: seriesNameValue,
              subjects: subjectsValue.length > 0 ? subjectsValue : undefined,
              entryType: entryTypeValue,
            }
          : undefined;

      if (cursor !== undefined || take !== undefined || filters !== undefined) {
        let pageCursor: PageCursor | null = null;
        if (typeof cursor === 'string' && cursor) {
          try {
            pageCursor = JSON.parse(Buffer.from(cursor, 'base64').toString('utf-8')) as PageCursor;
          } catch {
            pageCursor = null;
          }
        }
        const pageSize =
          typeof take === 'string' ? Math.min(Math.max(parseInt(take, 10) || 20, 1), 100) : 20;
        const result = await bookStore.listBooksPage(owner, pageCursor, pageSize, filters);
        res.json(result);
        return;
      }

      res.json(
        (await bookStore.listBooks(owner)).map((b) => {
          const {
            path: _path,
            description: _description,
            identifiers: _identifiers,
            subjects: _subjects,
            addedAt: _addedAt,
            chapterSpineMap: _chapterSpineMap,
            chapterNames: _chapterNames,
            ...rest
          } = b;
          return rest;
        })
      );
    })
  );

  router.get(
    '/api/search/suggestions',
    requireAuth,
    asyncHandler(async (req: Request, res: Response) => {
      const owner = await resolveOwner(req, res);
      if (!owner) return;
      const { q, author, seriesName, subjects } = req.query;
      if (!q || typeof q !== 'string' || !q.trim()) {
        res.json({ groups: [] } satisfies SearchSuggestionsResponse);
        return;
      }
      const activeSubjects: string[] = Array.isArray(subjects)
        ? (subjects as string[]).filter((s): s is string => typeof s === 'string' && s.length > 0)
        : typeof subjects === 'string' && subjects
          ? [subjects]
          : [];
      const result = await bookStore.getSearchSuggestions(owner, {
        q: q.trim(),
        filter: {
          author: typeof author === 'string' && author ? author : undefined,
          seriesName: typeof seriesName === 'string' && seriesName ? seriesName : undefined,
          activeSubjects,
        },
      });
      res.json(result);
    })
  );

  router.get(
    '/api/subjects',
    requireAuth,
    asyncHandler(async (req: Request, res: Response) => {
      const owner = await resolveOwner(req, res);
      if (!owner) return;
      const subjects = await bookStore.getSubjects(owner);
      res.json({ subjects });
    })
  );

  // Series names ordered by the server-computed sort key (articles stripped),
  // used to populate the series autocomplete in the book edit form.
  router.get(
    '/api/series',
    requireAuth,
    asyncHandler(async (req: Request, res: Response) => {
      const owner = await resolveOwner(req, res);
      if (!owner) return;
      const series = await bookStore.listSeries(owner);
      res.json({ series: series.map((s) => s.name) });
    })
  );

  router.post(
    '/api/books/upload',
    requireAuth,
    withUploadLimit(upload.array('files')),
    asyncHandler(async (req: Request, res: Response) => {
      const owner = await resolveOwner(req, res);
      if (!owner) return;
      const files = req.files as Express.Multer.File[] | undefined;
      if (!files?.length) {
        log.warn('Upload rejected — no valid files (supported: epub)');
        res.status(400).json({ error: 'No valid files uploaded. Supported: epub' });
        return;
      }
      const uploaded: string[] = [];
      const results: {
        filename: string;
        bookId: string;
        applied: MetadataFix[];
        proposals: MetadataFix[];
      }[] = [];
      for (const file of files) {
        const savedPath = file.path;
        let meta: EpubMeta;
        try {
          meta = parseEpub(savedPath);
        } catch (err: unknown) {
          try {
            fs.unlinkSync(savedPath);
          } catch {
            /* file may already be gone */
          }
          res.status(400).json({
            error: `Failed to parse EPUB: ${err instanceof Error ? err.message : String(err)}`,
          });
          return;
        }

        // Repair (RSC-005) + validate. Detection is deferred to the
        // post-addBook applyAutoAndAccepted call below, which re-detects
        // against the persisted book — skipDetect avoids doing that work twice.
        let analysis: EpubAnalysis;
        try {
          analysis = await analyzeEpub(savedPath, {
            originalName: file.originalname,
            librarySubjects: [],
            validationThreshold: config.validationThreshold,
            skipDetect: true,
          });
        } catch (err: unknown) {
          try {
            fs.unlinkSync(savedPath);
          } catch {
            /* file may already be gone */
          }
          throw err;
        }
        if (!analysis.valid) {
          try {
            fs.unlinkSync(savedPath);
          } catch {
            /* file may already be gone */
          }
          res.status(400).json({
            error: 'EPUB failed validation',
            validation: {
              messages: analysis.report.messages,
              counts: analysis.report.counts,
              threshold: analysis.report.threshold,
            },
          });
          return;
        }
        const structuralFix = analysis.structuralFix;

        // Fingerprint reflects the repaired bytes.
        let id: string;
        try {
          id = partialMD5(savedPath);
        } catch (err: unknown) {
          try {
            fs.unlinkSync(savedPath);
          } catch {
            /* file may already be gone */
          }
          res.status(400).json({
            error: `Failed to fingerprint EPUB: ${err instanceof Error ? err.message : String(err)}`,
          });
          return;
        }
        // parseEpub falls back to the file's basename when no dc:title is present.
        // Since savedPath is a staging path with a unique prefix, we must ignore
        // that fallback and use the client's original filename stem instead.
        const stagedTitleFallback = path.basename(savedPath, path.extname(savedPath));
        const realTitle = meta.title === stagedTitleFallback ? '' : meta.title.trim();
        const titleFallback =
          realTitle || path.basename(file.originalname, path.extname(file.originalname));
        try {
          await bookStore.addBook(owner, id, savedPath, { ...meta, title: titleFallback });
        } catch (err: unknown) {
          try {
            fs.unlinkSync(savedPath);
          } catch {
            /* file may already be gone */
          }
          if (err instanceof BookAlreadyExistsError) {
            res.status(409).json({
              error: 'A book with the same fingerprint is already in the library.',
            });
            return;
          }
          throw err;
        }
        await validationStore.saveValidation(owner, id, analysis.report);
        // Detect metadata issues; auto-apply the high-confidence ones in-request.
        let finalId = id;
        const applied: MetadataFix[] = structuralFix ? [structuralFix] : [];
        const proposals: MetadataFix[] = [];
        try {
          const librarySubjects = await bookStore.getSubjects(owner);
          const created = await bookStore.getBookById(owner, id);
          if (created) {
            const result = await applyAutoAndAccepted(
              { bookStore, validationStore, validationThreshold: config.validationThreshold },
              owner,
              created,
              { originalName: file.originalname, librarySubjects, acceptedKeys: [] }
            );
            finalId = result.book.id;
            applied.push(...result.applied);
            proposals.push(...result.proposals);
          }
        } catch (err: unknown) {
          log.warn(
            `Metadata detection skipped for "${file.originalname}": ${err instanceof Error ? err.message : String(err)}`
          );
        }

        if (proposals.length > 0) {
          try {
            await bookStore.upsertPendingFix(owner, finalId, file.originalname, file.size, {
              autoFixes: applied,
              appliedFixes: [],
              proposals,
              undo: null,
            });
          } catch (err: unknown) {
            // Never fail an upload because a pending-fix write failed — the upload
            // already succeeded; the book just won't show proposals until retried.
            log.warn(
              `Pending-fix write skipped for "${file.originalname}": ${err instanceof Error ? err.message : String(err)}`
            );
          }
        }

        thumbnailQueue.enqueue(owner.userId, finalId);
        uploaded.push(file.originalname);
        results.push({ filename: file.originalname, bookId: finalId, applied, proposals });
      }
      log.info(`Books uploaded: ${uploaded.join(', ')}`);
      res.json({ uploaded, results });
    })
  );

  router.get(
    '/api/books/pending-fixes',
    requireAuth,
    asyncHandler(async (req: Request, res: Response) => {
      const owner = await resolveOwner(req, res);
      if (!owner) return;
      res.json(await bookStore.getPendingFixes(owner));
    })
  );

  router.put(
    '/api/books/:id/pending-fixes',
    requireAuth,
    asyncHandler(async (req: Request, res: Response) => {
      const owner = await resolveOwner(req, res);
      if (!owner) return;
      const bookId = resolveBookLocalId(owner, req.params.id);
      if (bookId === null) {
        res.status(404).json({ error: 'Book not found' });
        return;
      }
      const { fileName, fileSize, state } = req.body ?? {};
      if (
        typeof fileName !== 'string' ||
        typeof fileSize !== 'number' ||
        typeof state !== 'object' ||
        state === null
      ) {
        res.status(400).json({ error: 'fileName, fileSize, and state are required' });
        return;
      }
      await bookStore.upsertPendingFix(owner, bookId, fileName, fileSize, {
        autoFixes: state.autoFixes ?? [],
        appliedFixes: state.appliedFixes ?? [],
        proposals: state.proposals ?? [],
        undo: state.undo ?? null,
      });
      res.status(204).end();
    })
  );

  router.delete(
    '/api/books/:id/pending-fixes',
    requireAuth,
    asyncHandler(async (req: Request, res: Response) => {
      const owner = await resolveOwner(req, res);
      if (!owner) return;
      const bookId = resolveBookLocalId(owner, req.params.id);
      if (bookId === null) {
        res.status(404).json({ error: 'Book not found' });
        return;
      }
      await bookStore.deletePendingFix(owner, bookId);
      res.status(204).end();
    })
  );

  router.get(
    '/api/books/:id',
    requireAuth,
    asyncHandler(async (req: Request, res: Response) => {
      const owner = await resolveOwner(req, res);
      if (!owner) return;
      const bookId = resolveBookLocalId(owner, req.params.id);
      if (bookId === null) {
        res.status(404).json({ error: 'Book not found' });
        return;
      }
      const book = await bookStore.getBookById(owner, bookId, { withEditionCount: true });
      if (!book) {
        res.status(404).json({ error: 'Book not found' });
        return;
      }
      const { path: _path, ...rest } = book;
      res.json(rest);
    })
  );

  router.get(
    '/api/books/:id/lineage',
    requireAuth,
    asyncHandler(async (req: Request, res: Response) => {
      const owner = await resolveOwner(req, res);
      if (!owner) return;
      const lineage = await bookStore.getBookLineage(owner, req.params.id);
      if (!lineage) {
        res.status(404).json({ error: 'Book not found' });
        return;
      }
      res.json(lineage);
    })
  );

  router.delete(
    '/api/books/:id/lineage',
    requireAuth,
    asyncHandler(async (req: Request, res: Response) => {
      const owner = await resolveOwner(req, res);
      if (!owner) return;
      const book = await bookStore.getBookById(owner, req.params.id);
      if (!book) {
        res.status(404).json({ error: 'Book not found' });
        return;
      }
      const cleared = await bookStore.clearEditLineage(owner, book.id);
      log.info(`Cleared ${cleared} edit-lineage row(s) for book=${book.id}`);
      res.json({ cleared });
    })
  );

  router.post(
    '/api/books/:id/link',
    requireAuth,
    asyncHandler(async (req: Request, res: Response) => {
      const owner = await resolveOwner(req, res);
      if (!owner) return;
      const { documentId } = req.body as { documentId?: unknown };
      if (typeof documentId !== 'string' || !documentId.trim()) {
        res.status(400).json({ error: 'documentId is required' });
        return;
      }
      try {
        const result = await bookStore.linkDocument(owner, req.params.id, documentId.trim());
        if (result === null) {
          res.status(404).json({ error: 'Book not found' });
          return;
        }
        res.status(204).send();
      } catch (err) {
        if (err instanceof SelfLinkError) {
          res.status(400).json({ error: err.message });
          return;
        }
        if (err instanceof DocumentAlreadyLinkedError) {
          res.status(409).json({ error: err.message });
          return;
        }
        if (err instanceof DocumentIsBookError) {
          res.status(409).json({ error: err.message });
          return;
        }
        throw err;
      }
    })
  );

  router.delete(
    '/api/books/:id/link/:documentId',
    requireAuth,
    asyncHandler(async (req: Request, res: Response) => {
      const owner = await resolveOwner(req, res);
      if (!owner) return;
      const result = await bookStore.unlinkDocument(owner, req.params.id, req.params.documentId);
      if (result === 'not_found') {
        res.status(404).json({ error: 'Lineage entry not found' });
        return;
      }
      if (result === 'edit_row') {
        res.status(400).json({ error: 'Cannot unlink an organic edit entry' });
        return;
      }
      res.status(204).send();
    })
  );

  router.get(
    '/api/books/:id/cover',
    requireAuth,
    asyncHandler(async (req: Request, res: Response) => {
      const owner = await resolveOwner(req, res);
      if (!owner) return;
      const bookId = resolveBookLocalId(owner, req.params.id);
      if (bookId === null) {
        res.status(404).json({ error: 'Book not found' });
        return;
      }
      const { width } = req.query;
      const parsedWidth = typeof width === 'string' ? parseInt(width, 10) : NaN;

      let data: Buffer;
      let mime: string;

      if (!isNaN(parsedWidth) && parsedWidth > 0) {
        const thumbnail = await bookStore.getThumbnail(owner.userId, bookId, parsedWidth);
        if (thumbnail) {
          data = thumbnail.data;
          mime = thumbnail.mime;
        } else {
          log.warn(
            `Cover thumbnail width=${parsedWidth} not found for book ${bookId}, serving full-size`
          );
          const cover = await bookStore.getCover(owner.userId, bookId);
          if (!cover) {
            res.status(404).send('Not found');
            return;
          }
          data = cover.data;
          mime = cover.mime;
        }
      } else {
        const cover = await bookStore.getCover(owner.userId, bookId);
        if (!cover) {
          res.status(404).send('Not found');
          return;
        }
        data = cover.data;
        mime = cover.mime;
      }

      const etag = `"${createHash('md5').update(data).digest('hex')}"`;
      if (req.headers['if-none-match'] === etag) {
        res.status(304).end();
        return;
      }

      // A cache-busting `v` token (the book's mtime) means the URL changes whenever the
      // cover changes, so the response is safe to cache immutably; without it we fall back
      // to revalidate-every-time so a stale cover is never served under a reused URL.
      const versioned = typeof req.query.v === 'string' && req.query.v.length > 0;
      res.set('Content-Type', mime);
      res.set('ETag', etag);
      res.set(
        'Cache-Control',
        versioned ? 'private, max-age=31536000, immutable' : 'private, max-age=0, must-revalidate'
      );
      res.send(data);
    })
  );

  router.get(
    '/api/series/:name',
    requireAuth,
    asyncHandler(async (req: Request, res: Response) => {
      const owner = await resolveOwner(req, res);
      if (!owner) return;
      const series = await bookStore.getSeriesByName(owner, req.params.name);
      if (!series) {
        res.status(404).json({ error: 'Series not found' });
        return;
      }
      res.json(series);
    })
  );

  router.get(
    '/api/series/:name/next-index',
    requireAuth,
    asyncHandler(async (req: Request, res: Response) => {
      const owner = await resolveOwner(req, res);
      if (!owner) return;
      const nextIndex = await bookStore.getSeriesNextIndex(owner, req.params.name);
      res.json({ nextIndex });
    })
  );

  router.get(
    '/api/books/:id/download',
    requireAuth,
    asyncHandler(async (req: Request, res: Response) => {
      const owner = await resolveOwner(req, res);
      if (!owner) return;
      const bookId = resolveBookLocalId(owner, req.params.id);
      if (bookId === null) {
        log.warn(`Download attempted with a cross-tenant global ID: ${req.params.id}`);
        res.status(404).json({ error: 'Book not found' });
        return;
      }
      const book = await bookStore.getBookById(owner, bookId);
      if (!book) {
        log.warn(`Download attempted for unknown book ID: ${bookId}`);
        res.status(404).json({ error: 'Book not found' });
        return;
      }
      log.info(`User "${owner.username}" downloaded "${book.filename}"`);
      res.set('Content-Type', 'application/epub+zip');
      res.set(
        'Content-Disposition',
        `attachment; filename*=UTF-8''${encodeURIComponent(book.filename)}`
      );
      res.sendFile(book.path);
    })
  );

  router.delete(
    '/api/books/:id',
    requireAuth,
    asyncHandler(async (req: Request, res: Response) => {
      const owner = await resolveOwner(req, res);
      if (!owner) return;
      const bookId = resolveBookLocalId(owner, req.params.id);
      if (bookId === null) {
        log.warn(`Delete attempted with a cross-tenant global ID: ${req.params.id}`);
        res.status(404).json({ error: 'Book not found' });
        return;
      }
      const deleted = await bookStore.deleteBook(owner, bookId);
      if (!deleted) {
        log.warn(`Delete attempted for unknown book ID: ${bookId}`);
        res.status(404).json({ error: 'Book not found' });
        return;
      }
      log.info(`Book deleted: "${deleted.filename}"`);
      res.status(204).send();
    })
  );

  router.delete(
    '/api/books/:id/editions',
    requireAuth,
    asyncHandler(async (req: Request, res: Response) => {
      const owner = await resolveOwner(req, res);
      if (!owner) return;
      const bookId = resolveBookLocalId(owner, req.params.id);
      if (bookId === null) {
        log.warn(`Clear editions attempted with a cross-tenant global ID: ${req.params.id}`);
        res.status(404).json({ error: 'Book not found' });
        return;
      }
      const cleared = await bookStore.clearDeviceEditions(owner, bookId);
      if (cleared === null) {
        log.warn(`Clear editions attempted for unknown book ID: ${bookId}`);
        res.status(404).json({ error: 'Book not found' });
        return;
      }
      log.info(`Cleared ${cleared} device edition(s) for book "${bookId}"`);
      res.json({ cleared });
    })
  );

  router.post(
    '/api/books/scan',
    requireAuth,
    asyncHandler(async (req: Request, res: Response) => {
      const owner = await resolveOwner(req, res);
      if (!owner) return;
      if (scanJobStore.isRunning(owner.userId)) {
        res.status(409).json(scanJobStore.get(owner.userId));
        return;
      }
      const job = scanJobStore.start(owner.userId);
      res.status(202).json(job);
      // Run the scan in the background; the client polls /api/books/scan/status.
      void (async () => {
        try {
          const result = await bookStore.scan(owner);
          const val = await revalidateLibrary(
            { bookStore, validationStore, validationThreshold: config.validationThreshold },
            owner
          );
          await thumbnailQueue.reconcile();
          log.info(
            `Scan: ${result.imported.length} imported, ${result.removed.length} removed, ` +
              `${val.validated} validated (${val.failed} failed)`
          );
          scanJobStore.complete(owner.userId, result);
        } catch (err: unknown) {
          const message = err instanceof Error ? err.message : String(err);
          log.error(`Scan failed for "${owner.username}": ${message}`);
          scanJobStore.fail(owner.userId, message);
        }
      })();
    })
  );

  router.get(
    '/api/books/scan/status',
    requireAuth,
    asyncHandler(async (req: Request, res: Response) => {
      const owner = await resolveOwner(req, res);
      if (!owner) return;
      const job = scanJobStore.get(owner.userId);
      res.json(job ?? { status: 'idle' });
    })
  );

  router.patch(
    '/api/books/:id/metadata',
    requireAuth,
    withUploadLimit(coverUpload.single('cover')),
    asyncHandler(async (req: Request, res: Response) => {
      log.info(
        `Metadata edit requested: book=${req.params.id} ` +
          `target=${typeof req.query.user === 'string' ? req.query.user : (req.user?.username ?? 'unknown')} ` +
          `contentType=${req.headers['content-type'] ?? 'none'} ` +
          `hasCover=${req.file ? 'yes' : 'no'} ` +
          `fields=[${Object.keys((req.body ?? {}) as Record<string, unknown>).join(',')}]`
      );
      const owner = await resolveOwner(req, res);
      if (!owner) {
        log.warn(`Metadata edit rejected: could not resolve owner for book=${req.params.id}`);
        return;
      }
      const bookId = resolveBookLocalId(owner, req.params.id);
      if (bookId === null) {
        log.warn(
          `Metadata edit rejected: global id=${req.params.id} not owned by user=${owner.username}`
        );
        res.status(404).json({ error: 'Book not found' });
        return;
      }
      const book = await bookStore.getBookById(owner, bookId);
      if (!book) {
        log.warn(`Metadata edit rejected: book=${bookId} not found for user=${owner.username}`);
        res.status(404).json({ error: 'Book not found' });
        return;
      }

      if (book.valid !== true) {
        res.status(409).json({
          error: 'This book must pass validation before it can be edited.',
        });
        return;
      }

      const body = req.body as Record<string, string>;
      const changes: EpubChanges = {};
      if (body.title !== undefined) changes.title = body.title;
      if (body.author !== undefined) changes.author = body.author;
      if (body.titleSort !== undefined) changes.titleSort = body.titleSort;
      if (body.authorSort !== undefined) changes.authorSort = body.authorSort;
      if (body.publishDate !== undefined) {
        const publishDate = body.publishDate.trim();
        if (publishDate !== '' && !ISO_8601_RE.test(publishDate)) {
          log.warn(
            `Metadata edit rejected: invalid publishDate "${publishDate}" for book=${book.id}`
          );
          res.status(400).json({ error: 'publishDate must be a valid ISO 8601 date string' });
          return;
        }
        changes.publishDate = publishDate;
      }
      if (body.description !== undefined) changes.description = body.description;
      if (body.publisher !== undefined) changes.publisher = body.publisher;
      if (body.series !== undefined) changes.series = body.series;
      if (body.seriesIndex !== undefined) {
        const n = parseFloat(body.seriesIndex);
        if (Number.isNaN(n)) {
          log.warn(
            `Metadata edit rejected: invalid seriesIndex "${body.seriesIndex}" for book=${book.id}`
          );
          res.status(400).json({ error: 'seriesIndex must be a number' });
          return;
        }
        changes.seriesIndex = n;
      }
      if (body.identifiers !== undefined) {
        try {
          changes.identifiers = JSON.parse(body.identifiers) as { scheme: string; value: string }[];
        } catch {
          log.warn(`Metadata edit rejected: invalid identifiers JSON for book=${book.id}`);
          res.status(400).json({ error: 'Invalid identifiers JSON' });
          return;
        }
      }
      if (body.subjects !== undefined) {
        try {
          changes.subjects = JSON.parse(body.subjects) as string[];
        } catch {
          log.warn(`Metadata edit rejected: invalid subjects JSON for book=${book.id}`);
          res.status(400).json({ error: 'Invalid subjects JSON' });
          return;
        }
      }
      if (req.file) {
        changes.coverData = req.file.buffer;
        changes.coverMime = req.file.mimetype;
      }

      log.info(
        `Metadata edit applying changes for book=${book.id}: [${Object.keys(changes).join(',')}]`
      );

      let updated;
      try {
        updated = await applyEpubChanges(
          { bookStore, validationStore, validationThreshold: config.validationThreshold },
          owner,
          book,
          changes
        );
      } catch (err: unknown) {
        if (err instanceof EpubValidationError) {
          log.warn(
            `Metadata edit rejected: edited EPUB failed validation for book=${book.id}: ` +
              err.messages
                .map(
                  (m) =>
                    `${m.severity} ${m.id} ${m.message}` +
                    (m.location
                      ? ` @ ${m.location.path}${m.location.line != null ? `:${m.location.line}` : ''}`
                      : '')
                )
                .join('; ')
          );
          res.status(422).json({
            error: 'Edited EPUB failed validation',
            validation: { messages: err.messages, counts: err.counts, threshold: err.threshold },
          });
          return;
        }
        if (err instanceof BookHashCollisionError) {
          log.warn(
            `Metadata edit rejected: edited book=${book.id} now collides with another book's fingerprint`
          );
          res.status(409).json({
            error:
              'The edited book now has the same fingerprint as another book in your library. ' +
              'Remove the duplicate book and try again.',
          });
          return;
        }
        log.error(
          `Metadata edit failed for book=${book.id}: ${err instanceof Error ? (err.stack ?? err.message) : String(err)}`
        );
        res.status(500).json({
          error: `Failed to update EPUB: ${err instanceof Error ? err.message : String(err)}`,
        });
        return;
      }

      if (req.file) {
        thumbnailQueue.enqueue(owner.userId, updated.id);
      }

      log.info(`Book metadata updated: "${updated.filename}"`);
      const {
        path: _path,
        chapterSpineMap: _chapterSpineMap,
        chapterNames: _chapterNames,
        ...rest
      } = updated;
      // `globalId` (2026-08-13 final review, C-2 — additive, `id` above is
      // UNCHANGED and stays the raw content hash every existing consumer of
      // this response already reads): the Relay global id for `rest.id`
      // (the NEW, post-edit raw id) — see `bookGlobalId`'s own doc comment.
      res.json({ ...rest, globalId: bookGlobalId(owner, updated.id) });
    })
  );

  router.post(
    '/api/books/:id/regen-chapters',
    requireAuth,
    asyncHandler(async (req: Request, res: Response) => {
      const owner = await resolveOwner(req, res);
      if (!owner) return;
      const book = await bookStore.getBookById(owner, req.params.id);
      if (!book) {
        res.status(404).json({ error: 'Book not found' });
        return;
      }

      if (book.valid !== true) {
        res.status(409).json({
          error: 'This book must pass validation before it can be edited.',
        });
        return;
      }

      let updated: Awaited<ReturnType<typeof bookStore.reimportBook>>;
      try {
        updated = await bookStore.reimportBook(owner, req.params.id);
      } catch (err) {
        if (err instanceof BookHashCollisionError) {
          res.status(409).json({ error: 'Book fingerprint collision during re-import' });
          return;
        }
        throw err;
      }
      if (!updated) {
        res.status(500).json({ error: 'Failed to re-import book' });
        return;
      }

      log.info(`Book chapters regenerated: "${updated.filename}"`);
      const { path: _path, ...rest } = updated;
      res.json(rest);
    })
  );

  router.post(
    '/api/books/:id/validate',
    requireAuth,
    asyncHandler(async (req: Request, res: Response) => {
      const owner = await resolveOwner(req, res);
      if (!owner) return;
      const bookId = resolveBookLocalId(owner, req.params.id);
      if (bookId === null) {
        res.status(404).json({ error: 'Book not found' });
        return;
      }
      const book = await bookStore.getBookById(owner, bookId);
      if (!book) {
        res.status(404).json({ error: 'Book not found' });
        return;
      }
      const report = await revalidateBook(
        { validationStore, validationThreshold: config.validationThreshold },
        owner,
        book
      );
      log.info(`Book validated: "${book.filename}" (valid=${report.valid})`);
      res.json(report);
    })
  );

  /**
   * Adjudicated 2026-08-01 (spec, §"Seams that stay REST" → "Replace
   * staging"): the GraphQL `bookAnalyzeReplace`/`bookReplace` mutations
   * cannot carry EPUB bytes themselves (binary boundary), and the legacy
   * `/replace/analyze`/`/replace` routes below are pure multer uploads with
   * no separable JSON-only leg. This route is the one exception to "REST
   * routes stay untouched" this migration otherwise holds to: it is new, not
   * a change to an existing route, and exists solely so the two GraphQL
   * mutations have bytes to operate on.
   *
   * Deliberately `requireStagingIdentity`, not `resolveOwner`: the staged
   * file is keyed to the *authenticated* caller's staging identity, never a
   * `?user=`-named target. Since Task 4, that includes admin sessions (no
   * row in the users table, `req.user.userId` unset) — they stage under
   * `ADMIN_STAGING_ID` rather than 401ing, so a config admin can stage a
   * replacement candidate too, same as any user. `bookAnalyzeReplace`/
   * `bookReplace` read this back the same way, via `stagingIdentityOf
   * (context.viewer)`, never the resolved book owner — see those mutations'
   * doc comments.
   */
  router.post(
    '/api/books/replace-staging',
    requireAuth,
    withUploadLimit(epubUpload.single('file')),
    asyncHandler(async (req: Request, res: Response) => {
      const identity = requireStagingIdentity(req, res);
      if (!identity) return;
      if (!req.file) {
        res.status(400).json({ error: 'No file uploaded' });
        return;
      }
      // `'epub'` explicit (matches `stage()`'s own default) — self-documenting
      // now that a second kind exists, see `/api/books/cover-staging` below.
      const stagedUploadId = replaceStaging.stage(
        req.file.buffer,
        identity,
        req.file.originalname,
        'epub'
      );
      res.json({ stagedUploadId });
    })
  );

  /**
   * Task 3b (2026-08-01): the image-kind sibling of `/api/books/replace-
   * staging` above, generalizing the same staging seam
   * (`services/replace-staging.ts`) to cover bytes so `bookUpdateMetadata`'s
   * optional `stagedCoverId` has something to resolve. A SIBLING route, not
   * a `kind` field on the existing one: multer's `fileFilter`/`limits` are
   * chosen per-route at router-setup time (`coverUpload` vs `epubUpload`,
   * declared above), before any request body — including a hypothetical
   * `kind` field — has been parsed, so one endpoint cannot dispatch to two
   * different multer configs. Uses `coverUpload` (memory storage, `image/*`
   * MIME filter, `COVER_UPLOAD_MAX_BYTES` (20MB) limit — the exact config
   * `PATCH /api/books/:id/metadata`'s multipart-cover branch uses,
   * `coverUpload.single('cover')`
   * at this file's top and again on that route below) with the SAME field
   * name, `cover`, for the same reason: this route stages bytes for that
   * exact same cover-write path, just deferred into a later
   * `bookUpdateMetadata` call instead of applied inline.
   *
   * `requireStagingIdentity`, not `resolveOwner`, matching `/replace-staging`
   * exactly: the staged file is keyed to the *authenticated* caller's
   * staging identity, never a `?user=`-named target (see
   * `replace-staging.ts`'s doc comment) — an admin session stages under
   * `ADMIN_STAGING_ID` here the same way it does on that route (Task 4).
   */
  router.post(
    '/api/books/cover-staging',
    requireAuth,
    withUploadLimit(coverUpload.single('cover')),
    asyncHandler(async (req: Request, res: Response) => {
      const identity = requireStagingIdentity(req, res);
      if (!identity) return;
      if (!req.file) {
        res.status(400).json({ error: 'No file uploaded' });
        return;
      }
      const stagedUploadId = replaceStaging.stage(
        req.file.buffer,
        identity,
        req.file.originalname,
        'cover',
        req.file.mimetype
      );
      res.json({ stagedUploadId });
    })
  );

  router.post(
    '/api/books/:id/replace/analyze',
    requireAuth,
    withUploadLimit(epubUpload.single('file')),
    asyncHandler(async (req: Request, res: Response) => {
      const owner = await resolveOwner(req, res);
      if (!owner) return;
      const bookId = resolveBookLocalId(owner, req.params.id);
      if (bookId === null) {
        res.status(404).json({ error: 'Book not found' });
        return;
      }
      const book = await bookStore.getBookById(owner, bookId);
      if (!book) {
        res.status(404).json({ error: 'Book not found' });
        return;
      }
      if (!req.file) {
        res.status(400).json({ error: 'No file uploaded' });
        return;
      }
      const dir = bookStore.getStagingDir();
      fs.mkdirSync(dir, { recursive: true });
      const tmpPath = path.join(dir, `analyze-${randomUUID()}.epub`);
      fs.writeFileSync(tmpPath, req.file.buffer);
      try {
        const analysis = await analyzeEpub(tmpPath, {
          originalName: req.file.originalname,
          librarySubjects: await bookStore.getSubjects(owner),
          validationThreshold: config.validationThreshold,
        });
        res.json({
          valid: analysis.valid,
          messages: analysis.report.messages,
          counts: analysis.report.counts,
          threshold: analysis.report.threshold,
          autoFixes: analysis.autoFixes,
          proposals: analysis.proposals,
        });
      } finally {
        fs.unlinkSync(tmpPath);
      }
    })
  );

  router.post(
    '/api/books/:id/replace',
    requireAuth,
    withUploadLimit(epubUpload.single('file')),
    asyncHandler(async (req: Request, res: Response) => {
      const owner = await resolveOwner(req, res);
      if (!owner) return;
      const bookId = resolveBookLocalId(owner, req.params.id);
      if (bookId === null) {
        res.status(404).json({ error: 'Book not found' });
        return;
      }
      const book = await bookStore.getBookById(owner, bookId);
      if (!book) {
        res.status(404).json({ error: 'Book not found' });
        return;
      }
      if (!req.file) {
        res.status(400).json({ error: 'No file uploaded' });
        return;
      }

      let acceptedKeys: string[] = [];
      try {
        const parsed = JSON.parse((req.body.acceptedFixKeys as string) ?? '[]') as unknown;
        if (Array.isArray(parsed) && parsed.every((k) => typeof k === 'string')) {
          acceptedKeys = parsed;
        }
      } catch {
        acceptedKeys = [];
      }

      // Structurally repair the candidate buffer before swapping it in, so
      // the file that gets persisted matches what /replace/analyze previewed.
      // Best-effort, like analyzeEpub's own repair guard: on failure, fall
      // through using the original candidate bytes so replaceEpubBytes's own
      // validation still runs (a normal 422/success) instead of a bare 500.
      const dir = bookStore.getStagingDir();
      fs.mkdirSync(dir, { recursive: true });
      const tmpPath = path.join(dir, `replace-${randomUUID()}.epub`);
      fs.writeFileSync(tmpPath, req.file.buffer);
      let repairedBytes: Buffer = req.file.buffer;
      try {
        try {
          repairedBytes = repairPackageDocument(tmpPath).bytes;
        } catch (err: unknown) {
          log.warn(
            `Package repair skipped for "${req.file.originalname}": ${err instanceof Error ? err.message : String(err)}`
          );
        }
      } finally {
        fs.unlinkSync(tmpPath);
      }

      let finalBook: Awaited<ReturnType<typeof replaceEpubBytes>>;
      try {
        const deps = {
          bookStore,
          validationStore,
          validationThreshold: config.validationThreshold,
        };
        const updated = await replaceEpubBytes(deps, owner, book, repairedBytes);
        const result = await applyAutoAndAccepted(deps, owner, updated, {
          originalName: req.file.originalname,
          librarySubjects: await bookStore.getSubjects(owner),
          acceptedKeys,
        });
        finalBook = result.book;
      } catch (err: unknown) {
        if (err instanceof EpubValidationError) {
          res.status(422).json({
            error: 'EPUB failed validation',
            validation: { messages: err.messages, counts: err.counts, threshold: err.threshold },
          });
          return;
        }
        if (err instanceof BookHashCollisionError) {
          res
            .status(409)
            .json({ error: 'A book with the same fingerprint is already in the library.' });
          return;
        }
        throw err;
      }
      log.info(`Book replaced: "${finalBook.filename}"`);
      const { path: _p, ...rest } = finalBook;
      // `globalId` (2026-08-13 final review, C-2 — additive, same as the
      // metadata route above): the Relay global id for `rest.id` (the NEW,
      // post-replace raw id).
      res.json({ ...rest, globalId: bookGlobalId(owner, finalBook.id) });
    })
  );

  // ── SPA catch-all — serves index.html for all non-API GET routes ──────────
  router.get('*', serveSpa);

  return router;
}
