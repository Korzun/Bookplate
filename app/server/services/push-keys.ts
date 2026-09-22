/**
 * The VAPID keypair, generated on first boot and kept in the settings table.
 *
 * Directly modelled on `getOrCreateJwtSecret` in `services/token.ts`, down to
 * the single atomic upsert with an empty `update`: on conflict the update is a
 * no-op and the upsert returns the FIRST writer's row. SQLite's unique-constraint
 * conflict resolution guarantees exactly one writer's value ever wins, so two
 * concurrent first boots converge on one keypair. The pair is stored in a single
 * row as JSON to make the matched-pair invariant unrepresentable: the value is
 * either fully consistent or missing entirely.
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

const VAPID_KEYS = 'vapid_keys';

export type VapidKeys = { publicKey: string; privateKey: string };

export async function getOrCreateVapidKeys(prisma: PrismaClient): Promise<VapidKeys> {
  const existing = await prisma.setting.findUnique({ where: { key: VAPID_KEYS } });
  if (existing) {
    return JSON.parse(existing.value);
  }

  const generated = webpush.generateVAPIDKeys();
  // One atomic upsert: on conflict the empty update is a no-op and upsert returns
  // the first writer's row. SQLite's unique-constraint semantics guarantee exactly
  // one writer's value ever wins, so concurrent first boots converge on one pair.
  // Storing as JSON makes the matched-pair invariant unrepresentable — the value
  // is either fully consistent or missing.
  const row = await prisma.setting.upsert({
    where: { key: VAPID_KEYS },
    create: { key: VAPID_KEYS, value: JSON.stringify(generated) },
    update: {},
  });
  return JSON.parse(row.value);
}
