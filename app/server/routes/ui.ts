import express, { Router, Request, Response } from 'express';
import multer from 'multer';
import * as path from 'path';
import * as fs from 'fs';
import { createHash } from 'crypto';
import {
  BookStore,
  BookHashCollisionError,
  BookAlreadyExistsError,
  SelfLinkError,
  DocumentAlreadyLinkedError,
  DocumentIsBookError,
} from '../services/book-store';
import { AppConfig, EpubMeta, Owner, PageCursor } from '../types';
import { UserStore } from '../services/user-store';
import { jwtAuth, passwordChangeGate } from '../middleware/auth';
import { signAccessToken, AuthUser } from '../services/jwt';
import { TokenStore, REFRESH_TOKEN_TTL_MS } from '../services/token-store';
import { logger } from '../logger';
import { parseEpub, partialMD5 } from '../services/epub-parser';
import { writeMetadata, EpubChanges } from '../services/epub-writer';
import { parseCfiSpineIndex, spineIndexToChapter } from '../utils/cfi';
import { ThumbnailQueue } from '../services/thumbnail-queue';

const log = logger('UI');

const ALLOWED_EXTENSIONS = new Set(['.epub']);

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

export function createUiRouter(
  bookStore: BookStore,
  userStore: UserStore,
  config: AppConfig,
  thumbnailQueue: ThumbnailQueue,
  tokenStore: TokenStore,
  jwtSecret: Buffer
): Router {
  const router = Router();

  const requireAuth = jwtAuth(jwtSecret);

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
    fileFilter: (_req, file, cb) => {
      const ext = path.extname(file.originalname).toLowerCase();
      cb(null, ALLOWED_EXTENSIONS.has(ext));
    },
  });

  const coverUpload = multer({
    storage: multer.memoryStorage(),
    limits: { fileSize: 10 * 1024 * 1024 },
    fileFilter: (_req, file, cb) => {
      cb(null, file.mimetype.startsWith('image/'));
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

  // ── Auth ──────────────────────────────────────────────

  const serveSpa = (_req: Request, res: Response): void => {
    res.sendFile(path.join(__dirname, '../../../client/dist/index.html'));
  };

  router.get('/login', serveSpa);

  router.use(passwordChangeGate(jwtSecret));

  router.post('/api/login', async (req: Request, res: Response) => {
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
  });

  router.post('/api/auth/refresh', async (req: Request, res: Response) => {
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
  });

  router.post('/api/auth/logout', async (req: Request, res: Response) => {
    const raw = (req.cookies as Record<string, string> | undefined)?.refresh_token;
    if (typeof raw === 'string' && raw) {
      await tokenStore.revokeRefreshToken(raw);
    }
    log.info('User logged out');
    clearRefreshCookie(res);
    res.status(204).send();
  });

  router.get('/api/config', requireAuth, (_req: Request, res: Response) => {
    res.json({ maxConcurrentUploads: config.maxConcurrentUploads });
  });

  router.get('/api/my/progress', requireAuth, async (req: Request, res: Response) => {
    if (req.user!.isAdmin) {
      res.json([]);
      return;
    }
    const userId = requireUserId(req, res);
    if (!userId) return;
    const owner: Owner = { userId, username: req.user!.username };
    const progressList = await userStore.getUserProgress(userId);
    const items = await Promise.all(
      progressList.map(async (p) => {
        const spineIndex = parseCfiSpineIndex(p.progress);
        const book = await bookStore.getBookById(owner, p.document);
        const currentChapter =
          spineIndex !== null && book && book.chapterSpineMap.length > 0
            ? (spineIndexToChapter(spineIndex, book.chapterSpineMap) ?? undefined)
            : undefined;
        const currentChapterName =
          currentChapter !== undefined && book && book.chapterNames.length > 0
            ? book.chapterNames[currentChapter - 1] || undefined
            : undefined;
        return {
          ...p,
          ...(currentChapter !== undefined ? { currentChapter } : {}),
          ...(currentChapterName !== undefined ? { currentChapterName } : {}),
        };
      })
    );
    res.json(items);
  });

  router.delete('/api/my/progress/:document', requireAuth, async (req: Request, res: Response) => {
    if (req.user!.isAdmin) {
      res.status(403).json({ error: 'Forbidden' });
      return;
    }
    const userId = requireUserId(req, res);
    if (!userId) return;
    const cleared = await userStore.clearProgress(userId, req.params.document);
    if (!cleared) {
      res.status(404).json({ error: 'Progress record not found' });
      return;
    }
    res.status(204).send();
  });

  router.put('/api/my/progress/:document', requireAuth, async (req: Request, res: Response) => {
    if (req.user!.isAdmin) {
      res.status(403).json({ error: 'Forbidden' });
      return;
    }
    const userId = requireUserId(req, res);
    if (!userId) return;
    const owner: Owner = { userId, username: req.user!.username };
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
    const book = await bookStore.getBookById(owner, req.params.document);
    let progress = '';
    if (book && book.chapterSpineMap.length > 0 && currentChapter <= book.chapterSpineMap.length) {
      const spineIndex = book.chapterSpineMap[currentChapter - 1];
      progress = `EPUB_CFI(/6/${spineIndex * 2 + 2}!/4/2:0)`;
    }
    await userStore.saveProgress(userId, {
      document: req.params.document,
      progress,
      percentage,
      device: typeof device === 'string' && device ? device : 'Web',
      device_id: typeof device_id === 'string' ? device_id : '',
    });
    res.status(200).json({});
  });

  router.patch('/api/my/password', requireAuth, async (req: Request, res: Response) => {
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
  });

  router.get('/api/my/sync-password', requireAuth, async (req: Request, res: Response) => {
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
  });

  router.post(
    '/api/my/sync-password/regenerate',
    requireAuth,
    async (req: Request, res: Response) => {
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
    }
  );

  // ── Static assets (no auth required) ──────────────────
  router.use('/assets', express.static(path.join(__dirname, '../../../client/dist/assets')));

  router.get('/api/books', requireAuth, async (req: Request, res: Response) => {
    const owner = await resolveOwner(req, res);
    if (!owner) return;

    const { cursor, take } = req.query;

    if (cursor !== undefined || take !== undefined) {
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
      const result = await bookStore.listBooksPage(owner, pageCursor, pageSize);
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
  });

  router.post(
    '/api/books/upload',
    requireAuth,
    upload.array('files'),
    async (req: Request, res: Response) => {
      const owner = await resolveOwner(req, res);
      if (!owner) return;
      const files = req.files as Express.Multer.File[] | undefined;
      if (!files?.length) {
        log.warn('Upload rejected — no valid files (supported: epub)');
        res.status(400).json({ error: 'No valid files uploaded. Supported: epub' });
        return;
      }
      const uploaded: string[] = [];
      for (const file of files) {
        const savedPath = file.path;
        let meta: EpubMeta;
        let id: string;
        try {
          meta = parseEpub(savedPath);
          id = partialMD5(savedPath);
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
        thumbnailQueue.enqueue(owner.userId, id);
        uploaded.push(file.originalname);
      }
      log.info(`Books uploaded: ${uploaded.join(', ')}`);
      res.json({ uploaded });
    }
  );

  router.get('/api/books/:id', requireAuth, async (req: Request, res: Response) => {
    const owner = await resolveOwner(req, res);
    if (!owner) return;
    const book = await bookStore.getBookById(owner, req.params.id);
    if (!book) {
      res.status(404).json({ error: 'Book not found' });
      return;
    }
    const { path: _path, ...rest } = book;
    res.json(rest);
  });

  router.get('/api/books/:id/lineage', requireAuth, async (req: Request, res: Response) => {
    const owner = await resolveOwner(req, res);
    if (!owner) return;
    const lineage = await bookStore.getBookLineage(owner, req.params.id);
    if (!lineage) {
      res.status(404).json({ error: 'Book not found' });
      return;
    }
    res.json(lineage);
  });

  router.post('/api/books/:id/link', requireAuth, async (req: Request, res: Response) => {
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
  });

  router.delete(
    '/api/books/:id/link/:documentId',
    requireAuth,
    async (req: Request, res: Response) => {
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
    }
  );

  router.get('/api/books/:id/cover', requireAuth, async (req: Request, res: Response) => {
    const owner = await resolveOwner(req, res);
    if (!owner) return;
    const { width } = req.query;
    const parsedWidth = typeof width === 'string' ? parseInt(width, 10) : NaN;

    let data: Buffer;
    let mime: string;

    if (!isNaN(parsedWidth) && parsedWidth > 0) {
      const thumbnail = await bookStore.getThumbnail(owner.userId, req.params.id, parsedWidth);
      if (thumbnail) {
        data = thumbnail.data;
        mime = thumbnail.mime;
      } else {
        log.warn(
          `Cover thumbnail width=${parsedWidth} not found for book ${req.params.id}, serving full-size`
        );
        const cover = await bookStore.getCover(owner.userId, req.params.id);
        if (!cover) {
          res.status(404).send('Not found');
          return;
        }
        data = cover.data;
        mime = cover.mime;
      }
    } else {
      const cover = await bookStore.getCover(owner.userId, req.params.id);
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

    res.set('Content-Type', mime);
    res.set('ETag', etag);
    res.set('Cache-Control', 'private, max-age=0, must-revalidate');
    res.send(data);
  });

  router.delete('/api/books/:id', requireAuth, async (req: Request, res: Response) => {
    const owner = await resolveOwner(req, res);
    if (!owner) return;
    const deleted = await bookStore.deleteBook(owner, req.params.id);
    if (!deleted) {
      log.warn(`Delete attempted for unknown book ID: ${req.params.id}`);
      res.status(404).json({ error: 'Book not found' });
      return;
    }
    log.info(`Book deleted: "${deleted.filename}"`);
    res.status(204).send();
  });

  router.post('/api/books/scan', requireAuth, async (req: Request, res: Response) => {
    const owner = await resolveOwner(req, res);
    if (!owner) return;
    const result = await bookStore.scan(owner);
    await thumbnailQueue.reconcile();
    log.info(`Scan: ${result.imported.length} imported, ${result.removed.length} removed`);
    res.json(result);
  });

  router.patch(
    '/api/books/:id/metadata',
    requireAuth,
    coverUpload.single('cover'),
    async (req: Request, res: Response) => {
      const owner = await resolveOwner(req, res);
      if (!owner) return;
      const book = await bookStore.getBookById(owner, req.params.id);
      if (!book) {
        res.status(404).json({ error: 'Book not found' });
        return;
      }

      const body = req.body as Record<string, string>;
      const changes: EpubChanges = {};
      if (body.title !== undefined) changes.title = body.title;
      if (body.author !== undefined) changes.author = body.author;
      if (body.titleSort !== undefined) changes.titleSort = body.titleSort;
      if (body.authorSort !== undefined) changes.authorSort = body.authorSort;
      if (body.publishDate !== undefined) {
        if (body.publishDate !== '' && !ISO_8601_RE.test(body.publishDate)) {
          res.status(400).json({ error: 'publishDate must be a valid ISO 8601 date string' });
          return;
        }
        changes.publishDate = body.publishDate;
      }
      if (body.description !== undefined) changes.description = body.description;
      if (body.publisher !== undefined) changes.publisher = body.publisher;
      if (body.series !== undefined) changes.series = body.series;
      if (body.seriesIndex !== undefined) {
        const n = parseFloat(body.seriesIndex);
        if (Number.isNaN(n)) {
          res.status(400).json({ error: 'seriesIndex must be a number' });
          return;
        }
        changes.seriesIndex = n;
      }
      if (body.identifiers !== undefined) {
        try {
          changes.identifiers = JSON.parse(body.identifiers) as { scheme: string; value: string }[];
        } catch {
          res.status(400).json({ error: 'Invalid identifiers JSON' });
          return;
        }
      }
      if (body.subjects !== undefined) {
        try {
          changes.subjects = JSON.parse(body.subjects) as string[];
        } catch {
          res.status(400).json({ error: 'Invalid subjects JSON' });
          return;
        }
      }
      if (req.file) {
        changes.coverData = req.file.buffer;
        changes.coverMime = req.file.mimetype;
      }

      try {
        writeMetadata(book.path, changes);
      } catch (err: unknown) {
        res.status(500).json({
          error: `Failed to update EPUB: ${err instanceof Error ? err.message : String(err)}`,
        });
        return;
      }

      let updated;
      try {
        updated = await bookStore.reimportBook(owner, req.params.id);
      } catch (err) {
        if (err instanceof BookHashCollisionError) {
          res.status(409).json({
            error:
              'The edited book now has the same fingerprint as another book in your library. ' +
              'Remove the duplicate book and try again.',
          });
          return;
        }
        throw err;
      }
      if (!updated) {
        res.status(500).json({ error: 'Failed to re-import book after update' });
        return;
      }
      thumbnailQueue.enqueue(owner.userId, updated.id);

      log.info(`Book metadata updated: "${updated.filename}"`);
      const {
        path: _path,
        chapterSpineMap: _chapterSpineMap,
        chapterNames: _chapterNames,
        ...rest
      } = updated;
      res.json(rest);
    }
  );

  router.post('/api/books/:id/regen-chapters', requireAuth, async (req: Request, res: Response) => {
    const owner = await resolveOwner(req, res);
    if (!owner) return;
    const book = await bookStore.getBookById(owner, req.params.id);
    if (!book) {
      res.status(404).json({ error: 'Book not found' });
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
  });

  // ── SPA catch-all — serves index.html for all non-API GET routes ──────────
  router.get('*', serveSpa);

  return router;
}
