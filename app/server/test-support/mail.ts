import type { Mailer, MailMessage, SendResult } from '../services/mailer';
import type { MailConfig } from '../types';

/**
 * A complete, valid `MailConfig` for tests that opt into a configured
 * install. Field values are arbitrary — nothing here ever reaches a real
 * Cloudflare API, since every caller wires a `FakeMailer` (below) in place of
 * `createMailer(mail)`'s real Cloudflare driver.
 */
export const MAIL_CONFIG: MailConfig = {
  accountId: 'acct',
  apiToken: 'tok',
  from: 'lib@example.com',
  fromName: 'Bookplate',
};

/**
 * A `Mailer` that never touches the network: `send` records every message
 * it's given rather than delivering it, so a test can assert on `sent`
 * directly instead of stubbing an HTTP client. `nextResult` lets a test
 * simulate a delivery failure (`{ ok: false, reason: ... }`) for exactly the
 * next call — see `viewer/mutation/set-email.test.ts`'s "succeeds even when
 * the send fails" case, which is the reason this exists rather than always
 * resolving `{ ok: true }`.
 */
export type FakeMailer = Mailer & {
  sent: MailMessage[];
  nextResult?: SendResult;
};

export const createFakeMailer = (): FakeMailer => ({
  sent: [],
  nextResult: undefined,
  async send(message: MailMessage): Promise<SendResult> {
    this.sent.push(message);
    return this.nextResult ?? { ok: true };
  },
});
