/**
 * Cloudflare Email Service (Email Sending, public beta 2026-04-16) over its
 * REST API. Global `fetch`, so this adds no dependency.
 *
 * Every non-success path is CLASSIFIED rather than passed through, because the
 * four outcomes want four different reactions and the HTTP status alone does
 * not separate them: a `200` can still report a permanent bounce, which is a
 * fact about the recipient's address, while a `401` is a fact about the
 * operator's token. Callers act on `SendResult.reason` and never see a status
 * code or a Cloudflare error body.
 */
import { logger } from '../logger';
import type { MailConfig } from '../types';
import type { Mailer, MailMessage, SendResult } from './mailer';

const log = logger('Mailer');

const SEND_URL = (accountId: string): string =>
  `https://api.cloudflare.com/client/v4/accounts/${accountId}/email/sending/send`;

// Bounds the outbound dependency: this fetch is otherwise never aborted, so a
// hung Cloudflare connection would leak its socket and promise well past any
// caller's own deadline. 10s is generous for an API call and far shorter than
// the app-wide 90s request timeout — there's no reason to hold a send that
// long when the caller's resend button is the retry path anyway.
const SEND_TIMEOUT_MS = 10_000;

// RFC 5322 `specials` (§3.2.3 lists "(" ")" "<" ">" "[" "]" ":" ";" "@" "\"
// "," DQUOTE "."), minus "." — handled separately below, only when
// leading/trailing. None of this is a security boundary — the value goes
// into a JSON body and Cloudflare composes the message, so there is no
// header injection to prevent here. This exists purely so a free-text
// display name (the operator's `library_name` add-on option) doesn't
// produce a malformed From header, e.g. `Smith, Bob <lib@example.com>`
// parsing as two mailboxes.
const RFC5322_SPECIALS = /[()<>[\]:;@\\,"]/;

function isNonAscii(name: string): boolean {
  // Not a regex range (e.g. `[^\x00-\x7F]`) because that pulls control
  // characters (0x00-0x1F) into the pattern and trips oxlint's
  // no-control-regex — codePointAt is just as direct here.
  return Array.from(name).some((ch) => (ch.codePointAt(0) ?? 0) > 0x7f);
}

function needsQuoting(name: string): boolean {
  return (
    RFC5322_SPECIALS.test(name) || isNonAscii(name) || name.startsWith('.') || name.endsWith('.')
  );
}

/**
 * Wraps a From display-name in an RFC 5322 quoted-string when it contains a
 * `specials` character, non-ASCII, or a leading/trailing dot — any of which
 * would otherwise produce a malformed From header. A name needing no
 * quoting passes through unchanged so the common case stays noise-free.
 */
function quoteDisplayName(name: string): string {
  if (!needsQuoting(name)) return name;
  const escaped = name.replace(/\\/g, '\\\\').replace(/"/g, '\\"');
  return `"${escaped}"`;
}

type SendResponse = {
  success?: boolean;
  result?: { delivered?: string[]; permanent_bounces?: string[]; queued?: string[] };
  errors?: { code?: number; message?: string }[];
};

export function createCloudflareMailer(mail: MailConfig): Mailer {
  // Per-instance, not per-module: a misconfigured token produces a failure on
  // EVERY send, and one log line per process is enough to diagnose it. Without
  // this latch a notification fan-out (next spec) would write one line per
  // recipient per event.
  let misconfigurationLogged = false;

  return {
    async send(message: MailMessage): Promise<SendResult> {
      let response: Response;
      try {
        response = await fetch(SEND_URL(mail.accountId), {
          method: 'POST',
          headers: {
            Authorization: `Bearer ${mail.apiToken}`,
            'Content-Type': 'application/json',
          },
          body: JSON.stringify({
            to: message.to,
            from: `${quoteDisplayName(mail.fromName)} <${mail.from}>`,
            subject: message.subject,
            text: message.text,
            html: message.html,
          }),
          signal: AbortSignal.timeout(SEND_TIMEOUT_MS),
        });
      } catch (err) {
        // Node's fetch rejects a signal-aborted request with a `DOMException`
        // (name `TimeoutError` for `AbortSignal.timeout()`), which `instanceof
        // Error` — verified against a live non-responding server — so a
        // timeout lands here with everything else and needs no special
        // handling: `transient` is exactly right, since a resend is the retry.
        log.warn(`Send failed (network): ${err instanceof Error ? err.message : String(err)}`);
        return { ok: false, reason: 'transient' };
      }

      if (response.status === 401 || response.status === 403) {
        if (!misconfigurationLogged) {
          misconfigurationLogged = true;
          log.error(
            'Cloudflare rejected the Email Sending credentials (401/403). Check the API token ' +
              'has the "Email Sending: Edit" permission and that the from-address is on a ' +
              'domain verified in this account. Email is effectively disabled until fixed.'
          );
        }
        return { ok: false, reason: 'misconfigured' };
      }
      if (response.status === 429) {
        log.warn('Cloudflare rate-limited the send (429)');
        return { ok: false, reason: 'throttled' };
      }

      let body: SendResponse;
      try {
        body = (await response.json()) as SendResponse;
      } catch {
        body = {};
      }

      if (!response.ok || body.success !== true) {
        // `||`, not `??`: an empty `errors: []` joins to `''`, which is NOT
        // nullish, so `??` never reaches its fallback — observed live as
        // `WARN [Mailer] Send failed (500): ` with nothing after the colon.
        log.warn(
          `Send failed (${response.status}): ${body.errors?.map((e) => e.message).join('; ') || 'no detail'}`
        );
        return { ok: false, reason: 'transient' };
      }
      if (body.result?.permanent_bounces?.length) {
        log.warn('Send bounced permanently — recipient address rejected');
        return { ok: false, reason: 'invalid_destination' };
      }
      return { ok: true };
    },
  };
}
