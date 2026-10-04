/**
 * The one channel interface. Everything above it — verification, password
 * reset, and notifications — depends on `Mailer` and never on a transport, so
 * a second channel (SMTP, web push) is an additive driver plus a
 * `createMailer` branch, with no change above this line.
 *
 * `createMailer` returning `null` for an unconfigured install is deliberate and
 * load-bearing: "is mail available?" becomes a single nullable value resolved
 * once at boot, rather than three credential fields re-tested at every call
 * site. Callers branch on the null, and the type system makes them.
 */
import type { AppConfig, MailConfig } from '../types';
import { createCloudflareMailer } from './mailer-cloudflare';

export type MailMessage = {
  to: string;
  subject: string;
  /** Always populated. Some clients never render the html part. */
  text: string;
  html: string;
};

/**
 * `invalid_destination` is a delivery verdict about the recipient, not a fault:
 * for email it arrives inside a `200` as a permanent bounce; a web-push
 * `410 Gone` lands in the same slot. The caller should tell the user that
 * destination is wrong. `misconfigured` is the operator's problem;
 * `throttled` and `transient` are worth retrying.
 *
 * `no_destination` is the odd one out and is NOT a failure to report: it means
 * the recipient has nothing to deliver to on this channel at all — a user who
 * has never subscribed a browser to push. It exists because push is
 * enabled-by-default under the absent-row rule, so without it every
 * notification for such a user would bank a permanently-failed outbox row that
 * the pruner keeps for 30 days, plus a log line each. `NotificationQueue`
 * deletes these rows the way it deletes a row with no driver. The email driver
 * never returns it: an unset or unverified address is a REFUSAL worth
 * recording (`invalid_destination`), not an absence.
 */
export type SendFailure =
  | 'invalid_destination'
  | 'throttled'
  | 'misconfigured'
  | 'transient'
  | 'no_destination';
export type SendResult = { ok: true } | { ok: false; reason: SendFailure };

export type Mailer = { send(message: MailMessage): Promise<SendResult> };

export function createMailer(mail: MailConfig | null | undefined): Mailer | null {
  if (!mail) return null;
  return createCloudflareMailer(mail);
}

/**
 * The predicate every gate, resolver and route uses to ask whether email exists
 * on this install. Takes the config rather than the mailer so callers holding
 * only `context.config` (every GraphQL resolver) can ask without a mailer in
 * scope.
 */
export function isMailConfigured(config: Pick<AppConfig, 'mail'>): boolean {
  return (config.mail ?? null) !== null;
}
