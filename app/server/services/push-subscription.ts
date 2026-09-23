/**
 * Every read and write of `push_subscriptions`, in one place, so the driver
 * (which prunes dead endpoints) and the GraphQL layer (which lists and removes
 * devices) never hand-roll a query between them.
 *
 * Two shapes come out of here, deliberately not one. `StoredSubscription`
 * carries the endpoint and keys and is for the DRIVER. The row shape returned
 * by `listPushSubscriptionRows` carries neither and is for GRAPHQL: a push
 * endpoint is a bearer capability URL — anyone holding it plus the keys can
 * send to that device — so it is written by the client, read by the driver,
 * and returned to nobody.
 */
import { randomUUID } from 'crypto';

import type { PrismaClient } from '@prisma/client';

/**
 * How many browsers one account may have registered for push at once. A
 * module constant, not an add-on config option — same reasoning as
 * `MAX_OPEN_BOOK_REQUESTS` (`services/book-request.ts`): nobody will tune
 * this number, so it costs nothing to make it fixed. Re-subscribing an
 * endpoint this account ALREADY holds a row for is exempt (see
 * `upsertPushSubscription`'s own doc comment) — the cap only ever refuses a
 * genuinely NEW device.
 */
export const MAX_PUSH_SUBSCRIPTIONS_PER_USER = 20;

export type StoredSubscription = {
  id: string;
  endpoint: string;
  p256dh: string;
  auth: string;
};

export type SubscriptionRow = {
  id: string;
  label: string;
  createdAt: number;
  lastSuccessAt: number | null;
};

/**
 * Keyed on `endpoint`, which is unique GLOBALLY rather than per user. A
 * browser holds one subscription per origin, so the same endpoint arriving
 * under a second account means the browser changed hands — the update re-binds
 * `userId` rather than inserting a second row, which is what stops a shared
 * browser from receiving two accounts' notifications.
 *
 * The keys are updated too: a browser may re-subscribe with fresh keys against
 * an endpoint it already holds, and a stale `p256dh` encrypts a payload the
 * device cannot decrypt — a silent, undiagnosable delivery failure.
 *
 * `lastSuccessAt` is deliberately NOT reset here. A device that keeps working
 * across a re-sync has not stopped working.
 *
 * Capped at `MAX_PUSH_SUBSCRIPTIONS_PER_USER`, refusing the insert (returning
 * `null`) rather than evicting an older row: an eviction would silently stop
 * notifying a device its owner never touched and never asked to remove — the
 * exact kind of silent, undiagnosable failure this file's other comments
 * already avoid elsewhere (the `p256dh`/`auth` update above, for one).
 * Refusing a NEW device at least fails where the reader can see it (the
 * settings switch not turning on), and they still hold every already-working
 * device. The cap is checked and the row written in ONE transaction, the same
 * `createBookRequest` shape, so two concurrent registrations cannot both read
 * a count under the cap and both insert.
 *
 * The check only runs for a genuinely NEW endpoint. Re-subscribing a browser
 * this account already holds a row for must always succeed — it is the same
 * device, not a new one — so it is exempt from the cap entirely, checked via
 * the same `findUnique` this function needs anyway to decide whether the
 * upsert below will insert or update.
 */
export async function upsertPushSubscription(
  prisma: PrismaClient,
  args: {
    userId: string;
    endpoint: string;
    p256dh: string;
    auth: string;
    label: string;
    now?: number;
  }
): Promise<{ id: string } | null> {
  const now = args.now ?? Date.now();
  return prisma.$transaction(async (tx) => {
    const existing = await tx.pushSubscription.findUnique({
      where: { endpoint: args.endpoint },
      select: { id: true },
    });
    if (existing === null) {
      const count = await tx.pushSubscription.count({ where: { userId: args.userId } });
      if (count >= MAX_PUSH_SUBSCRIPTIONS_PER_USER) return null;
    }
    return tx.pushSubscription.upsert({
      where: { endpoint: args.endpoint },
      create: {
        id: randomUUID(),
        userId: args.userId,
        endpoint: args.endpoint,
        p256dh: args.p256dh,
        auth: args.auth,
        label: args.label,
        createdAt: now,
      },
      update: {
        userId: args.userId,
        p256dh: args.p256dh,
        auth: args.auth,
        label: args.label,
      },
      select: { id: true },
    });
  });
}

/** For the driver: everything needed to encrypt and post. */
export async function listPushSubscriptionsForUser(
  prisma: PrismaClient,
  userId: string
): Promise<StoredSubscription[]> {
  return prisma.pushSubscription.findMany({
    where: { userId },
    select: { id: true, endpoint: true, p256dh: true, auth: true },
    orderBy: { createdAt: 'asc' },
  });
}

/** For GraphQL: no endpoint, no keys. See the header. */
export async function listPushSubscriptionRows(
  prisma: PrismaClient,
  userId: string
): Promise<SubscriptionRow[]> {
  return prisma.pushSubscription.findMany({
    where: { userId },
    select: { id: true, label: true, createdAt: true, lastSuccessAt: true },
    orderBy: { createdAt: 'asc' },
  });
}

/**
 * Scoped to the owner in the WHERE clause rather than checked first: a
 * find-then-delete would be a TOCTOU window, and `deleteMany` reports how many
 * rows matched, which is exactly the authorization answer the caller needs.
 */
export async function deletePushSubscription(
  prisma: PrismaClient,
  args: { userId: string; id: string }
): Promise<boolean> {
  const { count } = await prisma.pushSubscription.deleteMany({
    where: { id: args.id, userId: args.userId },
  });
  return count > 0;
}

/**
 * `deleteMany` rather than `delete` so a second call is a no-op instead of a
 * `P2025`: the driver prunes a `410` endpoint at the same time a user may be
 * removing that device by hand.
 */
export async function deletePushSubscriptionByEndpoint(
  prisma: PrismaClient,
  endpoint: string
): Promise<void> {
  await prisma.pushSubscription.deleteMany({ where: { endpoint } });
}

/** Same no-op tolerance: the row may have been pruned since it was read. */
export async function markPushSubscriptionDelivered(
  prisma: PrismaClient,
  args: { id: string; now: number }
): Promise<void> {
  await prisma.pushSubscription.updateMany({
    where: { id: args.id },
    data: { lastSuccessAt: args.now },
  });
}
