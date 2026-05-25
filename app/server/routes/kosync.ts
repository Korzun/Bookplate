// app/routes/kosync.ts
import { Router, Request, Response } from 'express';
import { UserStore } from '../services/user-store';
import { kosyncAuth } from '../middleware/auth';
import { logger } from '../logger';

const log = logger('KOSync');

export function createKosyncRouter(userStore: UserStore): Router {
  const router = Router();

  // Registration: POST /kosync/users/create  body: { username, password }
  router.post('/users/create', (req: Request, res: Response) => {
    const { username, password } = req.body as { username?: string; password?: string };
    if (!username || !password) {
      log.warn('Registration rejected — missing username or password');
      res.status(400).json({ username: null });
      return;
    }
    const created = userStore.createUser(username, password);
    if (created) {
      log.info(`User "${username}" registered`);
      res.status(201).json({ username });
    } else {
      log.warn(`Registration rejected — username "${username}" already exists`);
      res.status(402).json({ username: null });
    }
  });

  // Auth check: GET /kosync/users/auth
  router.get('/users/auth', kosyncAuth(userStore), (_req: Request, res: Response) => {
    res.status(200).json({ authorized: 'OK' });
  });

  // Save progress: PUT /kosync/syncs/progress
  router.put('/syncs/progress', kosyncAuth(userStore), (req: Request, res: Response) => {
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
    const saved = userStore.saveProgress(req.kosyncUser!, {
      document,
      progress,
      percentage,
      device,
      device_id,
    });
    log.info(
      `Progress saved for "${req.kosyncUser}" — "${document}" at ${(percentage * 100).toFixed(1)}%`
    );
    res.status(200).json({ document: saved.document, timestamp: saved.timestamp });
  });

  // Get progress: GET /kosync/syncs/progress/:document
  router.get('/syncs/progress/:document', kosyncAuth(userStore), (req: Request, res: Response) => {
    const p = userStore.getProgress(req.kosyncUser!, req.params.document);
    if (!p) {
      log.warn(`Progress not found for "${req.kosyncUser}" — "${req.params.document}"`);
      res.status(404).json({ message: 'Not found' });
      return;
    }
    log.debug(`Progress retrieved for "${req.kosyncUser}" — "${req.params.document}"`);
    res.status(200).json(p);
  });

  return router;
}
