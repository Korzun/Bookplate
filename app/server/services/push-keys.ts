/**
 * The VAPID keypair, generated on first boot and kept in the settings table.
 *
 * Directly modelled on `getOrCreateJwtSecret` in `services/token.ts`, down to
 * the `upsert` with an empty `update`: on conflict the update is a no-op and
 * the upsert returns the FIRST writer's row, so two concurrent first boots
 * converge on one pair rather than each minting one and the second silently
 * invalidating the first's subscriptions.
 *
 * NOTHING ROTATES THESE. Rotating a VAPID keypair invalidates every existing
 * subscription on every device at once — a support incident, not a maintenance
 * task. If it is ever needed it is an explicit operator action with its own
 * design, not a timer.
 *
 * Not an add-on option, for the same reason the JWT secret is not: an operator
 * has no way to produce a correct value and every way to lose one.
 */
import type { PrismaClient } from '@prisma/client';
import webpush from 'web-push';

const PUBLIC_KEY = 'vapid_public_key';
const PRIVATE_KEY = 'vapid_private_key';

export type VapidKeys = { publicKey: string; privateKey: string };

export async function getOrCreateVapidKeys(prisma: PrismaClient): Promise<VapidKeys> {
  const existing = await prisma.setting.findMany({
    where: { key: { in: [PUBLIC_KEY, PRIVATE_KEY] } },
  });
  const found = new Map(existing.map((row) => [row.key, row.value]));
  const publicKey = found.get(PUBLIC_KEY);
  const privateKey = found.get(PRIVATE_KEY);
  if (publicKey !== undefined && privateKey !== undefined) return { publicKey, privateKey };

  const generated = webpush.generateVAPIDKeys();
  // Two upserts rather than one transaction: the pair is only ever written
  // together and only ever at boot, and an empty `update` makes each one
  // idempotent, so a racing boot that wrote the public key first cannot leave
  // a half-pair behind — both rows converge on the same writer's values.
  const storedPublic = await prisma.setting.upsert({
    where: { key: PUBLIC_KEY },
    create: { key: PUBLIC_KEY, value: generated.publicKey },
    update: {},
  });
  const storedPrivate = await prisma.setting.upsert({
    where: { key: PRIVATE_KEY },
    create: { key: PRIVATE_KEY, value: generated.privateKey },
    update: {},
  });
  return { publicKey: storedPublic.value, privateKey: storedPrivate.value };
}
