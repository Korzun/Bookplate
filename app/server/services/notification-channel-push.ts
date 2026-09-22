/**
 * The ONLY file that knows a notification can be a Web Push message, and the
 * second `ChannelDriver` alongside `notification-channel-email.ts`.
 *
 * `ChannelDriver` takes a RECIPIENT rather than an address precisely for this
 * file: email resolves a user to one verified address, push resolves them to N
 * subscription endpoints and has no notion of a verified anything. That is why
 * both the fan-out and the endpoint lifecycle live here rather than in the
 * queue, which still names no channel.
 *
 * `send` is injected (defaulting to `web-push`) so the tests drive every status
 * code without a network or a real push service — the same shape
 * `ReplaceStagingDeps.now` and `issueEmailToken`'s clock use.
 */
import type { PrismaClient } from '@prisma/client';
import webpush from 'web-push';

import { logger } from '../logger';
import type { SendFailure, SendResult } from './mailer';
import type { ChannelDriver } from './notification';
import type { VapidKeys } from './push-keys';
import {
  deletePushSubscriptionByEndpoint,
  listPushSubscriptionsForUser,
  markPushSubscriptionDelivered,
  type StoredSubscription,
} from './push-subscription';
import { PUSH_TEMPLATES } from './push-template';

const log = logger('PushChannel');

/** Three days. A phone that was off for a week should not surface stale news. */
export const TTL_SECONDS = 259_200;

export type PushSender = (args: {
  subscription: StoredSubscription;
  body: string;
}) => Promise<{ statusCode: number }>;

/**
 * What one endpoint's attempt produced. `'gone'` is kept separate from the
 * `SendFailure` members because it is NOT a verdict on the send — it is
 * subscription lifecycle, and it contributes nothing to the outbox row.
 */
type EndpointOutcome = 'ok' | 'gone' | SendFailure;

/**
 * ONLY `404` and `410` delete anything. `400`, `401`, `403` and `413` mean the
 * SENDER is wrong — a malformed request, VAPID credentials the push service
 * rejected, or a payload over the cap — and say nothing about the
 * subscription. Deleting on those would let one server-side mistake destroy
 * every valid subscription on the install, which no user could recover from
 * without re-enabling push on every device by hand.
 */
function classify(statusCode: number): EndpointOutcome {
  if (statusCode >= 200 && statusCode < 300) return 'ok';
  if (statusCode === 404 || statusCode === 410) return 'gone';
  if (statusCode === 429) return 'throttled';
  if (statusCode >= 500) return 'transient';
  return 'misconfigured';
}

export function createPushChannelDriver(deps: {
  prisma: PrismaClient;
  vapid: VapidKeys;
  /** The `mailto:`/`https:` contact a push service may use to reach the operator. */
  contact: string;
  libraryName: string;
  now?: () => number;
  send?: PushSender;
}): ChannelDriver {
  const now = deps.now ?? Date.now;
  const send: PushSender =
    deps.send ??
    (async ({ subscription, body }) => {
      try {
        const result = await webpush.sendNotification(
          {
            endpoint: subscription.endpoint,
            keys: { p256dh: subscription.p256dh, auth: subscription.auth },
          },
          body,
          {
            TTL: TTL_SECONDS,
            urgency: 'normal',
            vapidDetails: {
              subject: deps.contact,
              publicKey: deps.vapid.publicKey,
              privateKey: deps.vapid.privateKey,
            },
          }
        );
        return { statusCode: result.statusCode };
      } catch (e) {
        // `web-push` REJECTS for any non-2xx response (a `WebPushError`
        // carrying `.statusCode`), rather than resolving with it — so this is
        // the primary path for every 404/410/429/4xx/5xx in production, not
        // an edge case. Normalizing it back into a resolved status here keeps
        // `PushSender`'s contract honest: a caller-injected `send` and the
        // driver's own `catch` (see `deliver`, below) only ever have to mean
        // "a genuine fault", exactly what the `ECONNRESET` test models. A
        // fault with no numeric status (a network failure, or one of
        // `web-push`'s own pre-flight validation errors) still rejects.
        const statusCode = (e as { statusCode?: number }).statusCode;
        if (typeof statusCode === 'number') return { statusCode };
        throw e;
      }
    });

  return {
    async deliver(args): Promise<SendResult> {
      const subscriptions = await listPushSubscriptionsForUser(deps.prisma, args.recipient.userId);
      if (subscriptions.length === 0) {
        // An ABSENCE, not a refusal. The queue deletes the row rather than
        // burying it — see `SendFailure`'s doc comment.
        return { ok: false, reason: 'no_destination' };
      }

      const message = PUSH_TEMPLATES[args.event]({
        libraryName: deps.libraryName,
        payload: args.payload,
      });
      const body = JSON.stringify(message);
      const at = now();

      let anySuccess = false;
      let retryable: SendFailure | null = null;
      let misconfigured = false;

      for (const subscription of subscriptions) {
        let outcome: EndpointOutcome;
        try {
          const { statusCode } = await send({ subscription, body });
          outcome = classify(statusCode);
        } catch (e) {
          // `web-push` throws a WebPushError carrying the status for an HTTP
          // error and a plain Error for a network fault. Read the status when
          // it is there so a `410` thrown rather than returned still prunes.
          const statusCode = (e as { statusCode?: number }).statusCode;
          outcome = typeof statusCode === 'number' ? classify(statusCode) : ('transient' as const);
          if (outcome === 'transient') {
            log.warn(`Push to ${subscription.id} failed: ${String(e)}`);
          }
        }

        switch (outcome) {
          case 'ok':
            anySuccess = true;
            await markPushSubscriptionDelivered(deps.prisma, { id: subscription.id, now: at });
            break;
          case 'gone':
            log.debug(`Endpoint for ${subscription.id} is gone; pruning`);
            await deletePushSubscriptionByEndpoint(deps.prisma, subscription.endpoint);
            break;
          case 'throttled':
          case 'transient':
            retryable = outcome;
            break;
          default:
            log.warn(`Push to ${subscription.id} was rejected as ${outcome}`);
            misconfigured = true;
            break;
        }
      }

      // The aggregate rules, in order, and the order is load-bearing:
      //
      //  1. A retryable failure outranks a success, so the row retries and the
      //     device that failed is not silently dropped. Devices that already
      //     succeeded get a second push, which the template's `tag` collapses
      //     into a replacement rather than a second notification.
      //  2. Otherwise any success is a success.
      //  3. `misconfigured` sits BELOW success because its causes are
      //     install-wide by construction — the same keys and the same payload
      //     go to every endpoint — so it cannot genuinely co-occur with one,
      //     and putting it here means a partial success is never buried. Each
      //     one is logged above regardless.
      //  4. Otherwise nothing is reachable: every endpoint was pruned.
      if (retryable !== null) return { ok: false, reason: retryable };
      if (anySuccess) return { ok: true };
      if (misconfigured) return { ok: false, reason: 'misconfigured' };
      return { ok: false, reason: 'no_destination' };
    },
  };
}
