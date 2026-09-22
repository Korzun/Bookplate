/**
 * The channel-blind half of notifications: what events exist, who each one is
 * for, whether a given recipient wants it, and the outbox row that records it.
 *
 * Nothing here knows that a channel is email. `services/notification-channel-
 * email.ts` is the only file that does, which is what makes web push a driver
 * plus rows rather than a change to this file (see the spec's "What web push
 * inherits").
 *
 * `now` is injected (defaulting to `Date.now`) so the queue's backoff tests
 * need no fake timers — the same shape `issueEmailToken` and
 * `ReplaceStagingDeps.now` use.
 */
import { randomUUID } from 'crypto';

import type { Prisma, PrismaClient } from '@prisma/client';

import { logger } from '../logger';
import type { SendResult } from './mailer';

const log = logger('Notification');

/**
 * Stored lowercase and dotted; exposed through the `NotificationEvent` GraphQL
 * enum, whose SCREAMING_CASE members map back onto these exact strings. The
 * enum is `satisfies`-checked against this union so the two cannot drift —
 * the convention `BookRequestStatus` already follows.
 */
export type NotificationEvent =
  | 'book_request.created'
  | 'book_request.fulfilled'
  | 'book_request.declined';

/** Web push adds a member here, a driver, and nothing else. */
export type NotificationChannel = 'email';

/**
 * `'admin'` resolves to the `isConfigAdmin` row; `'subject'` to the user the
 * event is about. Declaring it here rather than at the trigger site is the
 * reason `services/book-request.ts` never learns that a config admin exists.
 */
export type NotificationAudience = 'admin' | 'subject';

export const NOTIFICATION_EVENTS: Record<NotificationEvent, { audience: NotificationAudience }> = {
  'book_request.created': { audience: 'admin' },
  'book_request.fulfilled': { audience: 'subject' },
  'book_request.declined': { audience: 'subject' },
};

export const NOTIFICATION_EVENT_LIST: readonly NotificationEvent[] = Object.keys(
  NOTIFICATION_EVENTS
) as NotificationEvent[];

export const NOTIFICATION_CHANNELS: readonly NotificationChannel[] = ['email'];

/**
 * Everything the three mails need, and nothing that has to be looked up again.
 * A snapshot because the `BookRequest` row may be deleted before the drain
 * runs — see `NotificationOutbox.payload`'s doc comment. It must never hold a
 * rendered message.
 */
export type NotificationPayload = {
  requesterUsername: string;
  title: string;
  author: string;
  note: string;
  declineReason: string;
};

/**
 * Accepts a transaction client as readily as the root one, because the whole
 * point of the enqueue is that it commits with the state change that caused it.
 */
export type NotificationDb = PrismaClient | Prisma.TransactionClient;

/**
 * What a driver needs to decide whether — and how — to reach a recipient on
 * its channel. Shaped around the recipient rather than an address because web
 * push resolves a user to N subscription endpoints and has no notion of a
 * verified address at all; email's driver is the one that reads `email` and
 * `emailVerifiedAt`, not this file.
 */
export type NotificationRecipient = {
  userId: string;
  email: string | null;
  emailVerifiedAt: number | null;
};

/**
 * The contract every channel implements — `services/notification-channel-
 * email.ts` today, a web-push driver alongside it later. Declared here rather
 * than in the email file so the drain (which "names no channel") can import
 * it without importing anything email-shaped.
 */
export type ChannelDriver = {
  deliver(args: {
    recipient: NotificationRecipient;
    event: NotificationEvent;
    payload: NotificationPayload;
  }): Promise<SendResult>;
};

export function parsePayload(json: string): NotificationPayload {
  const raw = JSON.parse(json) as Partial<NotificationPayload>;
  return {
    requesterUsername: raw.requesterUsername ?? '',
    title: raw.title ?? '',
    author: raw.author ?? '',
    note: raw.note ?? '',
    declineReason: raw.declineReason ?? '',
  };
}

export async function isNotificationEnabled(
  db: NotificationDb,
  args: { userId: string; event: NotificationEvent; channel: NotificationChannel }
): Promise<boolean> {
  const row = await db.notificationPreference.findUnique({
    where: {
      userId_event_channel: { userId: args.userId, event: args.event, channel: args.channel },
    },
    select: { enabled: true },
  });
  // An absent row means enabled — see the model's doc comment.
  return row?.enabled ?? true;
}

export async function setNotificationPreference(
  db: NotificationDb,
  args: {
    userId: string;
    event: NotificationEvent;
    channel: NotificationChannel;
    enabled: boolean;
  }
): Promise<void> {
  const key = { userId: args.userId, event: args.event, channel: args.channel };
  await db.notificationPreference.upsert({
    where: { userId_event_channel: key },
    create: { ...key, enabled: args.enabled },
    update: { enabled: args.enabled },
  });
}

/**
 * Which events a viewer is ever a recipient of. The config admin only ever
 * receives `'admin'`-audience events and a reader only ever `'subject'` ones,
 * so the audience IS the role filter and there is no second table of rules.
 */
export function eventsForRole(role: 'admin' | 'reader'): NotificationEvent[] {
  const audience: NotificationAudience = role === 'admin' ? 'admin' : 'subject';
  return NOTIFICATION_EVENT_LIST.filter(
    (event) => NOTIFICATION_EVENTS[event].audience === audience
  );
}

/**
 * The role's whole catalogue with effective state, not just the stored rows —
 * the settings card renders what it is handed, and a client that reconstructed
 * the defaults itself would be a second place for them to drift.
 *
 * `channels` is passed in rather than read from `NOTIFICATION_CHANNELS` so the
 * caller can omit a channel this install has not configured; an empty list
 * yields an empty catalogue and the card renders nothing.
 */
export async function listNotificationPreferences(
  db: NotificationDb,
  args: { userId: string; role: 'admin' | 'reader'; channels: readonly NotificationChannel[] }
): Promise<Array<{ event: NotificationEvent; channel: NotificationChannel; enabled: boolean }>> {
  const events = eventsForRole(args.role);
  if (events.length === 0 || args.channels.length === 0) return [];

  const stored = await db.notificationPreference.findMany({
    where: { userId: args.userId, event: { in: events }, channel: { in: [...args.channels] } },
    select: { event: true, channel: true, enabled: true },
  });
  const byKey = new Map(stored.map((row) => [`${row.event}\u0000${row.channel}`, row.enabled]));

  return events.flatMap((event) =>
    args.channels.map((channel) => ({
      event,
      channel,
      enabled: byKey.get(`${event}\u0000${channel}`) ?? true,
    }))
  );
}

/**
 * Records that something happened, for every channel the recipient has not
 * muted.
 *
 * WRITES NOTHING AND THROWS NOTHING when there is no recipient row: the
 * `isConfigAdmin` row is absent on an install where `ensureAdminUser` refused
 * to act on a username collision (see that function), and a book request must
 * still succeed there.
 *
 * The preference is read HERE, at enqueue, so the outbox stays a record of
 * messages somebody actually wants. A user who mutes after the enqueue and
 * before the drain still gets that one message, which is the correct reading
 * of a queue that has already accepted it.
 *
 * `config.mail` is deliberately NOT consulted: this function holds no config,
 * and a row destined for an install with no driver is discarded by the drain.
 * "The outbox records, the drain decides" is one rule rather than two.
 */
export async function enqueueNotification(
  db: NotificationDb,
  args: {
    event: NotificationEvent;
    subjectUserId: string;
    payload: NotificationPayload;
    now?: number;
  }
): Promise<void> {
  const now = args.now ?? Date.now();
  const { audience } = NOTIFICATION_EVENTS[args.event];

  let recipientId: string | null = args.subjectUserId;
  if (audience === 'admin') {
    const admin = await db.user.findFirst({
      where: { isConfigAdmin: true },
      select: { id: true },
    });
    recipientId = admin?.id ?? null;
  }
  if (recipientId === null) {
    log.debug(`No recipient for ${args.event}; nothing enqueued`);
    return;
  }

  const payload = JSON.stringify(args.payload);
  for (const channel of NOTIFICATION_CHANNELS) {
    if (!(await isNotificationEnabled(db, { userId: recipientId, event: args.event, channel }))) {
      continue;
    }
    await db.notificationOutbox.create({
      data: {
        id: randomUUID(),
        userId: recipientId,
        event: args.event,
        channel,
        payload,
        attempts: 0,
        nextAttemptAt: now,
        createdAt: now,
      },
    });
  }
}
