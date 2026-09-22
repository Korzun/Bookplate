/**
 * The one channel interface. Everything above it — verification, password
 * reset, and (next spec) notifications — depends on `Mailer` and never on a
 * transport, so a second channel (SMTP, web push) is an additive driver plus a
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
 * for email it arrives inside a `200` as a permanent bounce, and the caller
 * should tell the user their address is wrong. The name is channel-neutral
 * deliberately — this union is the contract EVERY channel implements (spec 1),
 * and a web-push `410 Gone` lands in exactly this slot. The other three are
 * faults, distinguished because each wants different handling —
 * `misconfigured` is the operator's problem, `throttled` and `transient` are
 * worth retrying.
 */
export type SendFailure = 'invalid_destination' | 'throttled' | 'misconfigured' | 'transient';
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
