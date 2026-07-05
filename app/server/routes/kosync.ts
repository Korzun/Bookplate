// app/server/routes/kosync.ts
import { Router, Request, Response } from 'express';
import { UserStore } from '../services/user-store';
import { BookStore } from '../services/book-store';
import { kosyncAuth } from '../middleware/auth';
import { logger } from '../logger';
import { asyncHandler } from '../utils/async-handler';

const log = logger('KOSync');

export function createKosyncRouter(userStore: UserStore, bookStore: BookStore): Router {
  const router = Router();

  // Auth check: GET /sync/users/auth
  router.get('/users/auth', kosyncAuth(userStore), (_req: Request, res: Response) => {
    res.status(200).json({ authorized: 'OK' });
  });

  // Save progress: PUT /sync/syncs/progress
  router.put(
    '/syncs/progress',
    kosyncAuth(userStore),
    asyncHandler(async (req: Request, res: Response) => {
      const { document, progress, percentage, device, device_id } = req.body as {
        document?: string;
        progress?: string;
        percentage?: number;
        device?: string;
        device_id?: string;
      };
      if (!document || !progress || percentage === undefined || !device || !device_id) {
        res.status(400).json({ message: 'Missing required fields' });
        return;
      }
      const currentId = await bookStore.resolveBookId(req.kosyncUserId!, document);
      const saved = await userStore.saveProgress(req.kosyncUserId!, {
        document: currentId,
        progress,
        percentage,
        device,
        device_id,
      });
      log.info(
        `Progress saved for "${req.kosyncUser}" — "${document}" at ${(percentage * 100).toFixed(1)}%`
      );
      // Return ORIGINAL document (KOSync spec compliance)
      res.status(200).json({ document, timestamp: saved.timestamp });
    })
  );

  // Get progress: GET /sync/syncs/progress/:document
  router.get(
    '/syncs/progress/:document',
    kosyncAuth(userStore),
    asyncHandler(async (req: Request, res: Response) => {
      const currentId = await bookStore.resolveBookId(req.kosyncUserId!, req.params.document);
      const p = await userStore.getProgress(req.kosyncUserId!, currentId);
      if (!p) {
        log.warn(`Progress not found for "${req.kosyncUser}" — "${req.params.document}"`);
        res.status(404).json({ message: 'Not found' });
        return;
      }
      log.debug(`Progress retrieved for "${req.kosyncUser}" — "${req.params.document}"`);
      res.status(200).json(p);
    })
  );

  return router;
}
