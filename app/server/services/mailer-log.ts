/**
 * Development-only driver (`MAIL_DRIVER=log`): prints each message to the
 * server log instead of sending it, and always reports success. It exists so
 * the code-bearing flows — verification, password reset, onboarding — can be
 * exercised on a local stack, where the code and link are read from
 * `docker compose logs server`.
 */
import { logger } from '../logger';
import type { Mailer, MailMessage, SendResult } from './mailer';

const log = logger('Mailer');

export function createLogMailer(): Mailer {
  return {
    async send(message: MailMessage): Promise<SendResult> {
      log.info(
        [`Not sent (MAIL_DRIVER=log) — to ${message.to}: ${message.subject}`, message.text].join(
          '\n'
        )
      );
      return { ok: true };
    },
  };
}
