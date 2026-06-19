// app/routes/users.ts
import * as fs from 'fs';
import * as path from 'path';
import { Router, Request, RequestHandler, Response } from 'express';
import { UserStore } from '../services/user-store';
import { TokenStore } from '../services/token-store';
import { adminAuth } from '../middleware/auth';
import { logger } from '../logger';
import { isValidUsername } from '../utils/username';

const log = logger('Users');

export function createUsersRouter(
  userStore: UserStore,
  adminUsername: string,
  requireAuth: RequestHandler,
  tokenStore: TokenStore,
  booksRoot: string
): Router {
  const router = Router();
  router.use(requireAuth);
  router.use(adminAuth);

  router.get('/', async (_req: Request, res: Response) => {
    const users = await userStore.listUsers();
    log.debug(`Users list fetched (${users.length} users)`);
    res.json(users);
  });

  router.get('/:username/progress', async (req: Request, res: Response) => {
    const { username } = req.params;
    const userId = await userStore.getUserIdByUsername(username);
    if (!userId) {
      log.warn(`Progress fetch for unknown user "${username}"`);
      res.status(404).json({ error: 'User not found' });
      return;
    }
    const progress = await userStore.getUserProgress(userId);
    log.debug(`Progress fetched for "${username}" (${progress.length} records)`);
    res.json(progress);
  });

  router.delete('/:username/progress/:document', async (req: Request, res: Response) => {
    const { username, document } = req.params;
    const userId = await userStore.getUserIdByUsername(username);
    if (!userId) {
      log.warn(`Progress clear attempted for unknown user "${username}"`);
      res.status(404).json({ error: 'User not found' });
      return;
    }
    const cleared = await userStore.clearProgress(userId, document);
    if (!cleared) {
      log.warn(`Progress clear: no record for "${username}" document "${document}"`);
      res.status(404).json({ error: 'Progress record not found' });
      return;
    }
    log.info(`Progress cleared for "${username}" document "${document}"`);
    res.status(204).send();
  });

  router.delete('/:username', async (req: Request, res: Response) => {
    const { username } = req.params;
    const deleted = await userStore.deleteUser(username);
    if (!deleted) {
      log.warn(`Delete attempted for unknown user "${username}"`);
      res.status(404).json({ error: 'User not found' });
      return;
    }
    if (isValidUsername(username)) {
      fs.rmSync(path.join(booksRoot, username), { recursive: true, force: true });
    }
    log.info(`User "${username}" deleted`);
    res.status(204).send();
  });

  router.post('/:username/reset-password', async (req: Request, res: Response) => {
    const { username } = req.params;
    if (username === adminUsername) {
      log.warn(`Password reset attempted for built-in admin "${username}"`);
      res.status(403).json({ error: 'Cannot reset the built-in admin password' });
      return;
    }
    const password = await userStore.resetPassword(username);
    if (password === null) {
      log.warn(`Password reset attempted for unknown user "${username}"`);
      res.status(404).json({ error: 'User not found' });
      return;
    }
    await tokenStore.revokeAllForUsername(username);
    log.info(`Password reset for user "${username}"`);
    res.json({ password });
  });

  router.post('/', async (req: Request, res: Response) => {
    const { username } = req.body as { username?: string };
    if (typeof username !== 'string' || !username.trim()) {
      res.status(400).json({ error: 'Username is required' });
      return;
    }
    const trimmedUsername = username.trim();
    if (!isValidUsername(trimmedUsername)) {
      log.warn(`Registration rejected — invalid username "${trimmedUsername}"`);
      res.status(400).json({
        error:
          'Username may only contain letters, numbers, dots, underscores and dashes, and must start with a letter or number',
      });
      return;
    }
    if (trimmedUsername === adminUsername) {
      log.warn(`Registration rejected — username "${trimmedUsername}" is reserved`);
      res.status(409).json({ error: 'Username already exists' });
      return;
    }
    fs.mkdirSync(path.join(booksRoot, trimmedUsername), { recursive: true });
    const password = UserStore.generateLoginPassword();
    const passwordHash = await UserStore.hashLoginPassword(password);
    const created = await userStore.createUser(trimmedUsername, passwordHash, undefined, true);
    if (!created) {
      log.warn(`Registration failed — duplicate username "${trimmedUsername}"`);
      res.status(409).json({ error: 'Username already exists' });
      return;
    }
    log.info(`User "${trimmedUsername}" registered by admin`);
    res.status(201).json({ username: trimmedUsername, password });
  });

  return router;
}
