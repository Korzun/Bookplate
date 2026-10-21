// app/server/routes/kosync.ts
import type { PrismaClient } from '@prisma/client';
import { Router, Request, Response } from 'express';

import { logger } from '../logger';
import { kosyncAuth } from '../middleware/auth';
import { resolveBookId } from '../services/book-lineage';
import { getProgress, saveProgress } from '../services/progress';
import { parseReadingEventEnvelope, recordReadingEvent } from '../services/reading-events';
import { asyncHandler } from '../utils/async-handler';

const log = logger('KOSync');

export function createKosyncRouter(prisma: PrismaClient): Router {
  const router = Router();

  // Auth check: GET /sync/users/auth
  router.get('/users/auth', kosyncAuth(prisma), (_req: Request, res: Response) => {
    res.status(200).json({ authorized: 'OK' });
  });

  // Save progress: PUT /sync/syncs/progress
  router.put(
    '/syncs/progress',
    kosyncAuth(prisma),
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
      const currentId = await resolveBookId(prisma, req.kosyncUserId!, document);
      const saved = await saveProgress(prisma, req.kosyncUserId!, {
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
    kosyncAuth(prisma),
    asyncHandler(async (req: Request, res: Response) => {
      const currentId = await resolveBookId(prisma, req.kosyncUserId!, req.params.document);
      const p = await getProgress(prisma, req.kosyncUserId!, currentId);
      if (!p) {
        log.warn(`Progress not found for "${req.kosyncUser}" — "${req.params.document}"`);
        res.status(404).json({ message: 'Not found' });
        return;
      }
      log.debug(`Progress retrieved for "${req.kosyncUser}" — "${req.params.document}"`);
      res.status(200).json(p);
    })
  );

  // CrossPoint plugin events: POST /sync/crosspoint/events
  //
  // Not part of KOSync — it rides on the same credentials so the device needs
  // no second login. The firmware stops draining its queue at the first
  // non-2xx and retries the same event, so a redelivery answers 200 too; a
  // 400 is reserved for a body that will never become valid.
  router.post(
    '/crosspoint/events',
    kosyncAuth(prisma),
    asyncHandler(async (req: Request, res: Response) => {
      const envelope = parseReadingEventEnvelope(req.body);
      if (!envelope) {
        log.warn(`CrossPoint event from "${req.kosyncUser}" rejected — missing envelope fields`);
        res.status(400).json({ message: 'Missing required fields' });
        return;
      }
      // The plugin's setup page posts one to check the URL and credentials.
      if (envelope.event === 'plugin.test') {
        res.status(200).json({ stored: false });
        return;
      }
      const stored = await recordReadingEvent(prisma, req.kosyncUserId!, envelope, req.body);
      log.debug(
        `CrossPoint ${envelope.event} ${envelope.id} from "${req.kosyncUser}"${stored ? '' : ' (duplicate)'}`
      );
      res.status(200).json({ stored });
    })
  );

  return router;
}
