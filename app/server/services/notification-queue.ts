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
 *
 * Two limits this durability story does NOT cover, both worth stating
 * plainly rather than leaving for a reader to discover the hard way:
 *
 *  1. **One draining process, assumed, not enforced.** A row is neither
 *     claimed nor leased before delivery — `drainOnce` just reads whatever is
 *     due and sends it. Two processes pointed at the same SQLite file would
 *     each pick up the same due rows and double-send every one of them. The
 *     shipped topology is a single add-on container, which is what makes
 *     that acceptable; scaling the drain out to more than one process would
 *     need a claim (e.g. an `UPDATE ... RETURNING` that marks rows as taken)
 *     first.
 *  2. **AT-LEAST-ONCE delivery, not exactly-once.** A crash between a
 *     successful `driver.deliver()` and the `sentAt` write that records it
 *     leaves the row looking undelivered, so it is retried and the recipient
 *     gets a duplicate mail (see `drainOnce`'s handling of that case). What
 *     the outbox actually buys is that NEITHER of these failure modes can
 *     LOSE a notification: a missed or rolled-back `sentAt` write leaves the
 *     row pending rather than gone, and it is picked up again on the next
 *     pass. Not losing the message is the property this table exists to buy;
 *     an occasional duplicate is the cost, not a bug.
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
export const BATCH_SIZE = 20;

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

  /**
   * Runs a pass, or notes that another one is owed if a pass is already
   * running. Keeps passing again — not just when another poke arrived while
   * this one ran, but also while the last batch came back full — so a
   * backlog bigger than `BATCH_SIZE` drains in one `poke()` instead of one
   * `BATCH_SIZE`-sized bite per `TICK_MS`.
   */
  poke(): void {
    if (this.running) {
      this.pending = true;
      return;
    }
    this.running = true;
    this.current = (async () => {
      try {
        let full = false;
        do {
          this.pending = false;
          full = (await this.drainOnce()) === BATCH_SIZE;
        } while (this.pending || full);
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

  /**
   * One pass. Exported behaviour rather than private so tests drive it
   * directly. Returns how many rows it found due, which is what `poke` uses
   * to tell a drained-dry batch from one that filled `BATCH_SIZE` and likely
   * has more waiting behind it.
   */
  async drainOnce(): Promise<number> {
    const now = this.now();
    await this.prune(now);

    const due = await this.prisma.notificationOutbox.findMany({
      where: { sentAt: null, failedAt: null, nextAttemptAt: { lte: now } },
      orderBy: { createdAt: 'asc' },
      take: BATCH_SIZE,
    });

    for (const row of due) {
      // Set the instant delivery is confirmed, so the catch block below can
      // tell "the send itself failed" from "the send succeeded but a
      // persistence write after it threw" — see its comment.
      let delivered = false;
      try {
        const driver = this.drivers[row.channel as NotificationChannel];
        if (driver === undefined) {
          // An install that never configured this channel. Discarded rather than
          // recorded as a failure, so a LAN-only install generates no error noise
          // and the table stays bounded.
          //
          // This branch cannot tell that case apart from a TRANSIENT one: an
          // operator who clears a bad mail token and restarts also makes
          // `createMailer` return `null` until it is reconfigured, so the boot
          // poke discards every notification queued while mail was broken,
          // the same as it would for a LAN-only install that never intends to
          // configure mail at all. The two are indistinguishable at runtime
          // from inside this loop; discarding is still the right call because
          // it is what keeps a permanently-unconfigured install bounded, and
          // a few notifications lost across a misconfiguration-and-restart is
          // an acceptable price for not growing an unbounded backlog behind a
          // channel nobody may ever fix.
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
          delivered = true;
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
        if (delivered) {
          // `driver.deliver()` already succeeded — this row's mail is out —
          // and the throw happened while persisting THAT fact (the `sentAt`
          // update above). Routing it through `retry()` would leave the row
          // pending with a future `nextAttemptAt`, scheduling a mail that
          // already sent to go out a second time. Log and leave the row as
          // it is instead: the header explains why this can only duplicate a
          // send, never lose one.
          log.warn(
            `Failed to persist delivery for ${row.id} after a successful send: ${String(e)}`
          );
          continue;
        }
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

    return due.length;
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
