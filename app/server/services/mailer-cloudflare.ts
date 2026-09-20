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
            from: `${mail.fromName} <${mail.from}>`,
            subject: message.subject,
            text: message.text,
            html: message.html,
          }),
        });
      } catch (err) {
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
        log.warn(
          `Send failed (${response.status}): ${body.errors?.map((e) => e.message).join('; ') ?? 'no detail'}`
        );
        return { ok: false, reason: 'transient' };
      }
      if (body.result?.permanent_bounces?.length) {
        log.warn('Send bounced permanently — recipient address rejected');
        return { ok: false, reason: 'bad_address' };
      }
      return { ok: true };
    },
  };
}
