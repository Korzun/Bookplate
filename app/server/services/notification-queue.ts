/**
 * The drain. Shaped like `ThumbnailQueue` — started once from `index.ts`, poked
 * when work arrives, with a timer so a backed-off row is retried without
 * needing a fresh enqueue to poke it, and exposing `awaitIdle()` so tests
 * settle deterministically instead of racing a sleep.
 *
 * IT NAMES NO CHANNEL. Drivers arrive in a map, one entry today; adding web
 * push is an entry rather than a change to this file. The payload it reads is
 * channel-neutral event data and is rendered by the driver, which is the
 * invariant that keeps a second channel from becoming a migration of every
 * queued row.
 *
 * `now` is injected so the backoff arithmetic is asserted directly rather than
 * through fake timers.
 */
import type { PrismaClient } from '@prisma/client';

import { logger } from '../logger';
import type { SendFailure } from './mailer';
import {
  parsePayload,
  type ChannelDriver,
  type NotificationChannel,
  type NotificationEvent,
  type NotificationRecipient,
} from './notification';

const log = logger('NotificationQueue');

/**
 * Deliberately long-tailed. The failures that reach a retry are a throttled
 * API or an install whose network came back, and neither is fixed by retrying
 * in seconds. Indexed by the attempt that just failed, so a row that has failed
 * `n` times waits `BACKOFF_MS[n - 1]`.
 */
export const BACKOFF_MS: readonly number[] = [60_000, 300_000, 1_500_000, 7_200_000, 36_000_000];
/**
 * One more than the number of waits: N attempts have N-1 gaps between them.
 * DERIVED rather than written out, because the two were originally both 5 and
 * that silently made the last tier unreachable — the schedule the comment above
 * describes was not the schedule the code ran.
 */
export const MAX_ATTEMPTS = BACKOFF_MS.length + 1;
export const TICK_MS = 60_000;
export const RETENTION_MS = 30 * 24 * 60 * 60 * 1000;

/** How many rows one pass will move, so a large backlog cannot monopolise a tick. */
const BATCH_SIZE = 20;

/** No amount of retrying fixes either of these. */
const TERMINAL: readonly SendFailure[] = ['invalid_destination', 'misconfigured'];

export type NotificationQueueDeps = {
  prisma: PrismaClient;
  drivers: Partial<Record<NotificationChannel, ChannelDriver>>;
  now?: () => number;
};

/**
 * The hint the GraphQL layer holds. A poke is best-effort: it is sent AFTER the
 * transaction that enqueued commits (poking inside it would let this drain read
 * uncommitted state and find nothing), and if it is lost the timer picks the row
 * up within `TICK_MS`.
 */
export type NotificationPoker = { poke(): void };

export class NotificationQueue implements NotificationPoker {
  private readonly prisma: PrismaClient;
  private readonly drivers: Partial<Record<NotificationChannel, ChannelDriver>>;
  private readonly now: () => number;
  private timer: NodeJS.Timeout | null = null;
  private running = false;
  private pending = false;
  private current: Promise<void> = Promise.resolve();

  constructor(deps: NotificationQueueDeps) {
    this.prisma = deps.prisma;
    this.drivers = deps.drivers;
    this.now = deps.now ?? Date.now;
  }

  start(): void {
    if (this.timer !== null) return;
    this.timer = setInterval(() => this.poke(), TICK_MS);
    // Never hold the process open on this timer alone.
    this.timer.unref?.();
    this.poke();
  }

  stop(): void {
    if (this.timer !== null) clearInterval(this.timer);
    this.timer = null;
  }

  /** Runs a pass, or notes that another one is owed if a pass is already running. */
  poke(): void {
    if (this.running) {
      this.pending = true;
      return;
    }
    this.running = true;
    this.current = (async () => {
      try {
        do {
          this.pending = false;
          await this.drainOnce();
        } while (this.pending);
      } catch (e) {
        log.warn(`Notification drain failed: ${String(e)}`);
      } finally {
        this.running = false;
      }
    })();
  }

  /** Resolves when the pass in flight (if any) has finished. */
  async awaitIdle(): Promise<void> {
    await this.current;
  }

  /** One pass. Exported behaviour rather than private so tests drive it directly. */
  async drainOnce(): Promise<void> {
    const now = this.now();
    await this.prune(now);

    const due = await this.prisma.notificationOutbox.findMany({
      where: { sentAt: null, failedAt: null, nextAttemptAt: { lte: now } },
      orderBy: { createdAt: 'asc' },
      take: BATCH_SIZE,
    });

    for (const row of due) {
      try {
        const driver = this.drivers[row.channel as NotificationChannel];
        if (driver === undefined) {
          // An install that never configured this channel. Discarded rather than
          // recorded as a failure, so a LAN-only install generates no error noise
          // and the table stays bounded.
          log.debug(`No driver for channel ${row.channel}; discarding ${row.id}`);
          await this.prisma.notificationOutbox.delete({ where: { id: row.id } });
          continue;
        }

        const recipient = await this.loadRecipient(row.userId);
        if (recipient === null) {
          log.debug(`Recipient ${row.userId} is gone; discarding ${row.id}`);
          await this.prisma.notificationOutbox.delete({ where: { id: row.id } });
          continue;
        }

        const result = await driver.deliver({
          recipient,
          event: row.event as NotificationEvent,
          payload: parsePayload(row.payload),
        });

        if (result.ok) {
          await this.prisma.notificationOutbox.update({
            where: { id: row.id },
            data: { sentAt: now, lastError: null },
          });
          continue;
        }

        if (TERMINAL.includes(result.reason)) {
          await this.prisma.notificationOutbox.update({
            where: { id: row.id },
            data: { failedAt: now, lastError: `terminal: ${result.reason}` },
          });
          continue;
        }

        await this.retry(row, now, result.reason);
      } catch (e) {
        // A thrown error (a malformed payload's JSON.parse, a driver that
        // threw instead of resolving) is not distinguishable from a transient
        // fault from here, so it gets the same retry-then-bury treatment. The
        // alternative — leaving the row untouched — wedges every row behind
        // it forever, since `due` is ordered oldest-first and a row that never
        // buries itself is first again on every subsequent pass.
        log.warn(`Notification delivery threw for ${row.id}: ${String(e)}`);
        await this.retry(row, now, String(e));
      }
    }
  }

  /** Backs a row off on the published schedule, or buries it at the cap. */
  private async retry(
    row: { id: string; attempts: number; nextAttemptAt: number },
    now: number,
    reason: string
  ): Promise<void> {
    const attempts = row.attempts + 1;
    const exhausted = attempts >= MAX_ATTEMPTS;
    await this.prisma.notificationOutbox.update({
      where: { id: row.id },
      data: {
        attempts,
        lastError: `${reason} (attempt ${attempts})`,
        failedAt: exhausted ? now : null,
        nextAttemptAt: exhausted ? row.nextAttemptAt : now + BACKOFF_MS[attempts - 1],
      },
    });
  }

  private async loadRecipient(userId: string): Promise<NotificationRecipient | null> {
    const row = await this.prisma.user.findUnique({
      where: { id: userId },
      select: { id: true, email: true, emailVerifiedAt: true },
    });
    return row === null
      ? null
      : { userId: row.id, email: row.email, emailVerifiedAt: row.emailVerifiedAt };
  }

  /** Settled rows are kept for a window so an operator can see what happened. */
  private async prune(now: number): Promise<void> {
    const cutoff = now - RETENTION_MS;
    await this.prisma.notificationOutbox.deleteMany({
      where: { OR: [{ sentAt: { lt: cutoff } }, { failedAt: { lt: cutoff } }] },
    });
  }
}
