import { Router, Request, Response, RequestHandler } from 'express';

import { logger } from '../logger';
import { adminAuth } from '../middleware/auth';
import { DeviceStore, DeviceInput, DeviceSlugConflictError } from '../services/device-store';
import { EditionStore } from '../services/edition-store';
import { UserStore } from '../services/user-store';
import { asyncHandler } from '../utils/async-handler';
import { generateSlug } from '../utils/slug';

const log = logger('devices-router');

const FITS = new Set(['contain', 'cover', 'fill', 'smart']);

function parseBody(raw: Record<string, unknown>): DeviceInput | { error: string } {
  const name = raw.name;
  if (typeof name !== 'string' || !name.trim()) return { error: 'name is required' };
  if (name.trim().length > 50) return { error: 'name must be 50 characters or fewer' };
  // A symbol-only name (e.g. "!!!") derives an empty slug, which would break the
  // unique constraint and the /devices/:slug/download URL.
  if (!generateSlug(name.trim())) {
    return { error: 'name must contain at least one letter or number' };
  }

  const dim = (v: unknown, label: string): number | null | { error: string } => {
    if (v === null || v === undefined) return null;
    if (typeof v !== 'number' || !Number.isInteger(v) || v <= 0) {
      return { error: `${label} must be a positive integer` };
    }
    return v;
  };
  const w = dim(raw.coverWidth, 'coverWidth');
  if (w && typeof w === 'object') return w;
  const h = dim(raw.coverHeight, 'coverHeight');
  if (h && typeof h === 'object') return h;

  const coverFit = raw.coverFit;
  if (typeof coverFit !== 'string' || !FITS.has(coverFit)) {
    return { error: 'coverFit must be contain, cover, smart, or fill' };
  }
  if (typeof raw.bwCover !== 'boolean') return { error: 'bwCover must be a boolean' };
  if (typeof raw.simplify !== 'boolean') return { error: 'simplify must be a boolean' };

  return {
    name: name.trim(),
    coverWidth: w as number | null,
    coverHeight: h as number | null,
    coverFit: coverFit as DeviceInput['coverFit'],
    bwCover: raw.bwCover,
    simplify: raw.simplify,
  };
}

export function createDevicesRouter(
  deviceStore: DeviceStore,
  editionStore: EditionStore,
  userStore: UserStore,
  requireAuth: RequestHandler
): Router {
  const router = Router();
  // Every route requires a logged-in user. Listing devices is open to any user
  // (regular users need the per-device OPDS catalog URLs to set up their readers);
  // creating, editing, and deleting devices stay admin-only.
  router.use(requireAuth);

  router.get(
    '/',
    asyncHandler(async (req: Request, res: Response) => {
      const user = req.user;
      if (user?.isAdmin) {
        res.json(await deviceStore.list());
        return;
      }
      if (!user?.userId) {
        res.json([]);
        return;
      }
      res.json(await deviceStore.listForUser(user.userId));
    })
  );

  router.post(
    '/',
    adminAuth,
    asyncHandler(async (req: Request, res: Response) => {
      const parsed = parseBody(req.body as Record<string, unknown>);
      if ('error' in parsed) {
        res.status(400).json({ error: parsed.error });
        return;
      }
      if (await deviceStore.getBySlug(generateSlug(parsed.name))) {
        res.status(409).json({ error: 'A device with this name/slug already exists' });
        return;
      }
      try {
        res.status(201).json(await deviceStore.create(parsed));
      } catch (err) {
        if (err instanceof DeviceSlugConflictError) {
          res.status(409).json({ error: 'A device with this name/slug already exists' });
          return;
        }
        throw err;
      }
    })
  );

  router.patch(
    '/:id',
    adminAuth,
    asyncHandler(async (req: Request, res: Response) => {
      const existing = await deviceStore.getById(req.params.id);
      if (!existing) {
        res.status(404).json({ error: 'Device not found' });
        return;
      }
      const parsed = parseBody(req.body as Record<string, unknown>);
      if ('error' in parsed) {
        res.status(400).json({ error: parsed.error });
        return;
      }
      const newSlug = generateSlug(parsed.name);
      const clash = await deviceStore.getBySlug(newSlug);
      if (clash && clash.id !== existing.id) {
        res.status(409).json({ error: 'Slug already in use' });
        return;
      }
      let updated;
      try {
        updated = await deviceStore.update(existing.id, parsed);
      } catch (err) {
        if (err instanceof DeviceSlugConflictError) {
          res.status(409).json({ error: 'Slug already in use' });
          return;
        }
        throw err;
      }
      if (!updated) {
        res.status(404).json({ error: 'Device not found' });
        return;
      }
      try {
        await editionStore.purgeForDevice(existing.id); // settings changed -> stale cache
      } catch (err) {
        log.warn(
          `PATCH /:id — edition-cache purge failed for device "${existing.id}" — ${err instanceof Error ? err.message : String(err)}`
        );
      }
      res.json(updated);
    })
  );

  router.delete(
    '/:id',
    adminAuth,
    asyncHandler(async (req: Request, res: Response) => {
      const existing = await deviceStore.getById(req.params.id);
      if (!existing) {
        res.status(404).json({ error: 'Device not found' });
        return;
      }
      const deleted = await deviceStore.delete(existing.id);
      if (!deleted) {
        res.status(404).json({ error: 'Device not found' });
        return;
      }
      try {
        await editionStore.purgeForDevice(existing.id);
      } catch (err) {
        log.warn(
          `DELETE /:id — edition-cache purge failed for device "${existing.id}" — ${err instanceof Error ? err.message : String(err)}`
        );
      }
      res.status(204).end();
    })
  );

  router.get(
    '/:id/users',
    adminAuth,
    asyncHandler(async (req: Request, res: Response) => {
      const device = await deviceStore.getById(req.params.id);
      if (!device) {
        res.status(404).json({ error: 'Device not found' });
        return;
      }
      res.json(await deviceStore.listUsernamesForDevice(device.id));
    })
  );

  router.put(
    '/:id/users/:username',
    adminAuth,
    asyncHandler(async (req: Request, res: Response) => {
      const device = await deviceStore.getById(req.params.id);
      if (!device) {
        res.status(404).json({ error: 'Device not found' });
        return;
      }
      const userId = await userStore.getUserIdByUsername(req.params.username);
      if (!userId) {
        res.status(404).json({ error: 'User not found' });
        return;
      }
      await deviceStore.enableUser(device.id, userId);
      res.status(204).end();
    })
  );

  router.delete(
    '/:id/users/:username',
    adminAuth,
    asyncHandler(async (req: Request, res: Response) => {
      const device = await deviceStore.getById(req.params.id);
      if (!device) {
        res.status(404).json({ error: 'Device not found' });
        return;
      }
      const userId = await userStore.getUserIdByUsername(req.params.username);
      if (!userId) {
        res.status(404).json({ error: 'User not found' });
        return;
      }
      await deviceStore.disableUser(device.id, userId);
      try {
        await editionStore.purgeForDeviceAndUser(device.id, userId);
      } catch (err) {
        log.warn(
          `DELETE /:id/users/:username — edition purge failed for device "${device.id}" user "${userId}" — ${err instanceof Error ? err.message : String(err)}`
        );
      }
      res.status(204).end();
    })
  );

  return router;
}
