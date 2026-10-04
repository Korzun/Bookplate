/**
 * The ONLY file that knows a notification can be an email.
 *
 * `ChannelDriver` is deliberately shaped around a RECIPIENT rather than an
 * address: web push resolves a user to N subscription endpoints and has no
 * notion of a verified address at all, so "is this recipient addressable on
 * this channel?" has to be the driver's question. That is also why the
 * unverified-address refusal lives here and not in the queue — it comes back as
 * `invalid_destination`, which the queue already treats as terminal, so the
 * queue needs no branch for it.
 */
import {
  bookRequestedMessage,
  requestDeclinedMessage,
  requestFulfilledMessage,
  type NoticeArgs,
} from './mail-template';
import type { Mailer, MailMessage, SendResult } from './mailer';
import type { ChannelDriver, NotificationEvent } from './notification';

const TEMPLATES: Record<NotificationEvent, (args: NoticeArgs) => MailMessage> = {
  'book_request.created': bookRequestedMessage,
  'book_request.fulfilled': requestFulfilledMessage,
  'book_request.declined': requestDeclinedMessage,
};

export function createEmailChannelDriver(deps: {
  mailer: Mailer;
  libraryName: string;
  publicUrl: string | null;
}): ChannelDriver {
  return {
    async deliver(args): Promise<SendResult> {
      const { email, emailVerifiedAt } = args.recipient;
      // Spec 1's rule: nothing is ever emailed to an unverified address except
      // its own verification code. Permanent rather than retryable — no amount
      // of retrying makes an unconfirmed address sendable.
      if (email === null || emailVerifiedAt === null) {
        return { ok: false, reason: 'invalid_destination' };
      }

      const message = TEMPLATES[args.event]({
        to: email,
        libraryName: deps.libraryName,
        publicUrl: deps.publicUrl,
        payload: args.payload,
      });
      return deps.mailer.send(message);
    },
  };
}
