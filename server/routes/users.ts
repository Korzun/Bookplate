// app/routes/users.ts
import { Router, Request, Response } from 'express';
import { UserStore } from '../services/user-store';
import { sessionAuth, adminAuth } from '../middleware/auth';
import { logger } from '../logger';

const log = logger('Users');

export function createUsersRouter(userStore: UserStore, adminUsername: string): Router {
  const router = Router();
  router.use(sessionAuth);
  router.use(adminAuth);

  router.get('/', (_req: Request, res: Response) => {
    const users = userStore.listUsers();
    log.debug(`Users list fetched (${users.length} users)`);
    res.json(users);
  });

  router.get('/:username/progress', (req: Request, res: Response) => {
    const { username } = req.params;
    if (!userStore.userExists(username)) {
      log.warn(`Progress fetch for unknown user "${username}"`);
      res.status(404).json({ error: 'User not found' });
      return;
    }
    const progress = userStore.getUserProgress(username);
    log.debug(`Progress fetched for "${username}" (${progress.length} records)`);
    res.json(progress);
  });

  router.delete('/:username/progress/:document', (req: Request, res: Response) => {
    const { username, document } = req.params;
    if (!userStore.userExists(username)) {
      log.warn(`Progress clear attempted for unknown user "${username}"`);
      res.status(404).json({ error: 'User not found' });
      return;
    }
    const cleared = userStore.clearProgress(username, document);
    if (!cleared) {
      log.warn(`Progress clear: no record for "${username}" document "${document}"`);
      res.status(404).json({ error: 'Progress record not found' });
      return;
    }
    log.info(`Progress cleared for "${username}" document "${document}"`);
    res.status(204).send();
  });

  router.delete('/:username', (req: Request, res: Response) => {
    const { username } = req.params;
    const deleted = userStore.deleteUser(username);
    if (!deleted) {
      log.warn(`Delete attempted for unknown user "${username}"`);
      res.status(404).json({ error: 'User not found' });
      return;
    }
    log.info(`User "${username}" deleted`);
    res.status(204).send();
  });

  router.post('/', (req: Request, res: Response) => {
    const { username, password } = req.body as { username?: string; password?: string };
    if (
      typeof username !== 'string' ||
      typeof password !== 'string' ||
      !username.trim() ||
      !password.trim()
    ) {
      res.status(400).json({ error: 'Username and password are required' });
      return;
    }
    const trimmedUsername = username.trim();
    if (trimmedUsername === adminUsername) {
      log.warn(`Registration rejected — username "${trimmedUsername}" is reserved`);
      res.status(409).json({ error: 'Username already exists' });
      return;
    }
    const key = UserStore.hashPassword(password);
    const created = userStore.createUser(trimmedUsername, key);
    if (!created) {
      log.warn(`Registration failed — duplicate username "${trimmedUsername}"`);
      res.status(409).json({ error: 'Username already exists' });
      return;
    }
    log.info(`User "${trimmedUsername}" registered by admin`);
    res.status(201).json({ username: trimmedUsername });
  });

  return router;
}
