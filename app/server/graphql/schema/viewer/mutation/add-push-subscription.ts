import { z } from 'zod';

import {
  listPushSubscriptionRows,
  upsertPushSubscription,
} from '../../../../services/push-subscription';
import { builder } from '../../builder';
import { model as pushSubscriptionModel } from '../../push-subscription/model';
import { resolveViewerUserId } from './resolve-user-id';

/**
 * `endpoint` must parse as a URL with an `https:` scheme. This value is a
 * bearer capability URL the server POSTs to on every notification, so an
 * arbitrary one is a blind SSRF primitive aimed at the LAN this add-on runs
 * on.
 *
 * What the scheme check actually closes, stated precisely because it is less
 * than it sounds: it rules out the NON-https schemes — `http:` to a plaintext
 * LAN service, and `file:`/`gopher:`-style schemes a URL parser will accept.
 * It does NOT restrict the HOST. `https://192.168.1.1/anything` and
 * `https://nas.local/` both pass, so a blind POST at an https LAN service
 * remains reachable by anyone who can call this mutation — which is any
 * authenticated account, for itself.
 *
 * It is left there deliberately rather than closed by accident: narrowing it
 * means allowlisting hosts or rejecting private address ranges after DNS
 * resolution, which is a real piece of work (and a DNS-rebinding problem of
 * its own), and this is a self-hosted add-on whose attacker model is an
 * account the operator created. Worth doing if that model ever widens; worth
 * not pretending is already done in the meantime.
 *
 * `p256dh`/`auth` must be non-empty base64url (the client's own
 * `toBase64Url`, `lib/push.ts`, never emits padding, hence no `=`) —
 * `web-push` rejects an empty key PRE-FLIGHT with a plain `Error` carrying no
 * `statusCode`, which the driver's `classify` (`notification-channel-push.ts`)
 * has no status to read and so calls `transient`, which is NEVER pruned: one
 * such row would drag every future notification for that user through the
 * full retry ladder, re-pushing their working devices each time. Length caps
 * are generous, not measured — same "cheap insurance, not a modeled bound"
 * reasoning `book-request/mutation/create.ts`'s own `.max()` calls use.
 */
const BASE64URL = /^[A-Za-z0-9_-]+$/;

function isHttpsUrl(value: string): boolean {
  try {
    return new URL(value).protocol === 'https:';
  } catch {
    return false;
  }
}

const inputSchema = z.object({
  endpoint: z.string().trim().min(1).max(2048).refine(isHttpsUrl, 'endpoint must be an https URL'),
  p256dh: z.string().trim().min(1).max(256).regex(BASE64URL, 'p256dh must be base64url'),
  auth: z.string().trim().min(1).max(256).regex(BASE64URL, 'auth must be base64url'),
  label: z.string().trim().max(100),
});

/**
 * Registers the calling browser for push, or re-registers it.
 *
 * Called on every app load, not only when the switch is flipped: push
 * endpoints rotate, and a browser that believes it is subscribed while the
 * server has no row for it receives nothing and reports no error. The upsert
 * keys on `endpoint`, so re-running it is free.
 *
 * `null` rather than an error union, matching `viewerSetNotificationPreference`:
 * malformed input and a refused-at-the-cap insert are both reported the same
 * way as "no account row to key the subscription to" (the `ensureAdminUser`
 * collision an install can be left in) already was — none of the three give
 * the caller anything actionable beyond "this did not take", and inventing a
 * union here would be a distinction with no client-visible use, unlike
 * `bookRequestCreate`'s union, where the caller shows the limit/duplicate
 * back to the user by name.
 *
 * Input is parsed INSIDE the resolver, after auth — `bookRequestCreate`'s own
 * doc comment explains why this schema does not use declarative arg
 * validation.
 */
builder.mutationField('viewerAddPushSubscription', (t) =>
  t.field({
    type: pushSubscriptionModel,
    nullable: true,
    description: 'Registers the calling browser to receive push notifications.',
    args: {
      endpoint: t.arg.string({ required: true }),
      p256dh: t.arg.string({ required: true }),
      auth: t.arg.string({ required: true }),
      label: t.arg.string({ required: true }),
    },
    resolve: async (_root, args, context) => {
      const userId = await resolveViewerUserId(context);
      if (userId === null) return null;

      const parsed = inputSchema.safeParse({
        endpoint: args.endpoint,
        p256dh: args.p256dh,
        auth: args.auth,
        label: args.label,
      });
      if (!parsed.success) return null;

      const result = await upsertPushSubscription(context.prisma, {
        userId,
        endpoint: parsed.data.endpoint,
        p256dh: parsed.data.p256dh,
        auth: parsed.data.auth,
        label: parsed.data.label,
      });
      if (result === null) return null; // at the per-user cap, and this is a new device

      const rows = await listPushSubscriptionRows(context.prisma, userId);
      return rows.find((row) => row.id === result.id) ?? null;
    },
  })
);
