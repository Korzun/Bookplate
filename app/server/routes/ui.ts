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
} from '../services/book-store';
import { AppConfig, EpubMeta } from '../types';
import { UserStore } from '../services/user-store';
import { sessionAuth, adminAuth } from '../middleware/auth';
import { logger } from '../logger';
import { parseEpub, partialMD5 } from '../services/epub-parser';
import { writeMetadata, EpubChanges } from '../services/epub-writer';
import { parseCfiSpineIndex, spineIndexToChapter } from '../utils/cfi';
import { ThumbnailQueue } from '../services/thumbnail-queue';

const log = logger('UI');

const ALLOWED_EXTENSIONS = new Set(['.epub']);

export function createUiRouter(
  bookStore: BookStore,
  userStore: UserStore,
  config: AppConfig,
  thumbnailQueue: ThumbnailQueue
): Router {
  const router = Router();

  const stagingDir = path.join(bookStore.getBooksDir(), '.staging');
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

  // ── Auth ──────────────────────────────────────────────

  const serveSpa = (_req: Request, res: Response): void => {
    res.sendFile(path.join(__dirname, '../../../client/dist/index.html'));
  };

  router.get('/login', serveSpa);

  router.post('/api/login', async (req: Request, res: Response) => {
    const { username, password } = req.body as { username?: string; password?: string };
    if (typeof username !== 'string' || typeof password !== 'string') {
      res.sendStatus(401);
      return;
    }
    if (username === config.username && password === config.password) {
      req.session.authenticated = true;
      req.session.isAdmin = true;
      req.session.username = username;
      log.info(`Admin "${username}" logged in`);
      res.sendStatus(200);
      return;
    }
    if (await userStore.validateUser(username, password)) {
      req.session.authenticated = true;
      req.session.isAdmin = false;
      req.session.username = username;
      log.info(`User "${username}" logged in`);
      res.sendStatus(200);
      return;
    }
    log.warn(`Login failed for username "${username ?? ''}"`);
    res.sendStatus(401);
  });

  router.post('/logout', (req: Request, res: Response) => {
    log.info('User logged out');
    req.session.destroy(() => res.redirect('/login'));
  });

  router.get('/api/me', sessionAuth, (req: Request, res: Response) => {
    res.json({ username: req.session.username, isAdmin: req.session.isAdmin });
  });

  router.get('/api/config', sessionAuth, (_req: Request, res: Response) => {
    res.json({ maxConcurrentUploads: config.maxConcurrentUploads });
  });

  router.get('/api/my/progress', sessionAuth, async (req: Request, res: Response) => {
    if (req.session.isAdmin) {
      res.json([]);
      return;
    }
    const progressList = await userStore.getUserProgress(req.session.username!);
    const items = await Promise.all(
      progressList.map(async (p) => {
        const spineIndex = parseCfiSpineIndex(p.progress);
        const book = await bookStore.getBookById(p.document);
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

  router.delete('/api/my/progress/:document', sessionAuth, async (req: Request, res: Response) => {
    if (req.session.isAdmin) {
      res.status(403).json({ error: 'Forbidden' });
      return;
    }
    const cleared = await userStore.clearProgress(req.session.username!, req.params.document);
    if (!cleared) {
      res.status(404).json({ error: 'Progress record not found' });
      return;
    }
    res.status(204).send();
  });

  router.put('/api/my/progress/:document', sessionAuth, async (req: Request, res: Response) => {
    if (req.session.isAdmin) {
      res.status(403).json({ error: 'Forbidden' });
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
    const book = await bookStore.getBookById(req.params.document);
    let progress = '';
    if (book && book.chapterSpineMap.length > 0 && currentChapter <= book.chapterSpineMap.length) {
      const spineIndex = book.chapterSpineMap[currentChapter - 1];
      progress = `EPUB_CFI(/6/${spineIndex * 2 + 2}!/4/2:0)`;
    }
    await userStore.saveProgress(req.session.username!, {
      document: req.params.document,
      progress,
      percentage,
      device: typeof device === 'string' && device ? device : 'Web',
      device_id: typeof device_id === 'string' ? device_id : '',
    });
    res.status(200).json({});
  });

  // ── Static assets (no auth required) ──────────────────
  router.use('/assets', express.static(path.join(__dirname, '../../../client/dist/assets')));

  router.get('/api/books', sessionAuth, async (_req: Request, res: Response) => {
    res.json(
      (await bookStore.listBooks()).map((b) => {
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
    sessionAuth,
    upload.array('files'),
    async (req: Request, res: Response) => {
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
          await bookStore.addBook(id, savedPath, { ...meta, title: titleFallback });
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
        thumbnailQueue.enqueue(id);
        uploaded.push(file.originalname);
      }
      log.info(`Books uploaded: ${uploaded.join(', ')}`);
      res.json({ uploaded });
    }
  );

  router.get('/api/books/:id', sessionAuth, async (req: Request, res: Response) => {
    const book = await bookStore.getBookById(req.params.id);
    if (!book) {
      res.status(404).json({ error: 'Book not found' });
      return;
    }
    const { path: _path, ...rest } = book;
    res.json(rest);
  });

  router.get(
    '/api/books/:id/lineage',
    sessionAuth,
    adminAuth,
    async (req: Request, res: Response) => {
      const lineage = await bookStore.getBookLineage(req.params.id);
      if (!lineage) {
        res.status(404).json({ error: 'Book not found' });
        return;
      }
      res.json(lineage);
    }
  );

  router.post(
    '/api/books/:id/link',
    sessionAuth,
    adminAuth,
    async (req: Request, res: Response) => {
      const { documentId } = req.body as { documentId?: unknown };
      if (typeof documentId !== 'string' || !documentId.trim()) {
        res.status(400).json({ error: 'documentId is required' });
        return;
      }
      try {
        const result = await bookStore.linkDocument(req.params.id, documentId.trim());
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
        throw err;
      }
    }
  );

  router.delete(
    '/api/books/:id/link/:documentId',
    sessionAuth,
    adminAuth,
    async (req: Request, res: Response) => {
      const result = await bookStore.unlinkDocument(req.params.id, req.params.documentId);
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

  router.get('/api/books/:id/cover', sessionAuth, async (req: Request, res: Response) => {
    const { width } = req.query;
    const parsedWidth = typeof width === 'string' ? parseInt(width, 10) : NaN;

    let data: Buffer;
    let mime: string;

    if (!isNaN(parsedWidth) && parsedWidth > 0) {
      const thumbnail = await bookStore.getThumbnail(req.params.id, parsedWidth);
      if (thumbnail) {
        data = thumbnail.data;
        mime = thumbnail.mime;
      } else {
        log.warn(
          `Cover thumbnail width=${parsedWidth} not found for book ${req.params.id}, serving full-size`
        );
        const cover = await bookStore.getCover(req.params.id);
        if (!cover) {
          res.status(404).send('Not found');
          return;
        }
        data = cover.data;
        mime = cover.mime;
      }
    } else {
      const cover = await bookStore.getCover(req.params.id);
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

  router.delete('/api/books/:id', sessionAuth, adminAuth, async (req: Request, res: Response) => {
    const deleted = await bookStore.deleteBook(req.params.id);
    if (!deleted) {
      log.warn(`Delete attempted for unknown book ID: ${req.params.id}`);
      res.status(404).json({ error: 'Book not found' });
      return;
    }
    log.info(`Book deleted: "${deleted.filename}"`);
    res.status(204).send();
  });

  router.post('/api/books/scan', sessionAuth, adminAuth, async (_req: Request, res: Response) => {
    const result = await bookStore.scan();
    await thumbnailQueue.reconcile();
    log.info(`Scan: ${result.imported.length} imported, ${result.removed.length} removed`);
    res.json(result);
  });

  router.patch(
    '/api/books/:id/metadata',
    sessionAuth,
    adminAuth,
    coverUpload.single('cover'),
    async (req: Request, res: Response) => {
      const book = await bookStore.getBookById(req.params.id);
      if (!book) {
        res.status(404).json({ error: 'Book not found' });
        return;
      }

      const body = req.body as Record<string, string>;
      const changes: EpubChanges = {};
      if (body.title !== undefined) changes.title = body.title;
      if (body.author !== undefined) changes.author = body.author;
      if (body.fileAs !== undefined) changes.fileAs = body.fileAs;
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
        updated = await bookStore.reimportBook(req.params.id);
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
      thumbnailQueue.enqueue(updated.id);

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

  router.post(
    '/api/books/:id/regen-chapters',
    sessionAuth,
    adminAuth,
    async (req: Request, res: Response) => {
      const book = await bookStore.getBookById(req.params.id);
      if (!book) {
        res.status(404).json({ error: 'Book not found' });
        return;
      }

      let updated: Awaited<ReturnType<typeof bookStore.reimportBook>>;
      try {
        updated = await bookStore.reimportBook(req.params.id);
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
    }
  );

  // ── SPA catch-all — serves index.html for all non-API GET routes ──────────
  router.get('*', sessionAuth, serveSpa);

  return router;
}
