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
): Promise<{ id: string }> {
  const now = args.now ?? Date.now();
  const row = await prisma.pushSubscription.upsert({
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
  return row;
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
