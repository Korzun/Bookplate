import { issueEmailToken } from '../../../../services/email-token';
import { verificationMessage } from '../../../../services/mail-template';
import { isMailConfigured } from '../../../../services/mailer';
import { builder } from '../../builder';
import {
  emailNotConfiguredError,
  model as emailNotConfiguredErrorModel,
} from '../../email-not-configured-error/model';
import {
  invalidInputIssue,
  model as invalidInputErrorModel,
} from '../../invalid-input-error/model';
import { resolveViewerUserId } from './resolve-user-id';

type ViewerResendEmailVerificationPayloadShape = {
  readonly __typename: 'ViewerResendEmailVerificationPayload';
  readonly delivered: boolean;
};

const payload = builder
  .objectRef<ViewerResendEmailVerificationPayloadShape>('ViewerResendEmailVerificationPayload')
  .implement({
    fields: (t) => ({
      delivered: t.exposeBoolean('delivered'),
    }),
  });

/**
 * No `resolveType`: every member value carries its own `__typename` — see
 * `progress/mutation/delete.ts`'s identical note.
 */
const result = builder.unionType('ViewerResendEmailVerificationResult', {
  types: [payload, invalidInputErrorModel, emailNotConfiguredErrorModel],
});

/**
 * No input — resends a fresh code to the address already on file. Same
 * `emailSetupAllowed` scope and `skipTypeScopes` reasoning as
 * `viewerSetEmail` (see that mutation's doc comment).
 */
builder.mutationField('viewerResendEmailVerification', (t) =>
  t.field({
    type: result,
    description:
      "Sends a fresh verification code to the viewer's own email address. " +
      '`InvalidInputError` covers every reason it cannot: no address on file, ' +
      'the address is already confirmed, or a resend cooldown/cap is in effect.',
    skipTypeScopes: true,
    authScopes: { emailSetupAllowed: true },
    resolve: async (_root, _args, context) => {
      if (!isMailConfigured(context.config)) return emailNotConfiguredError();
      // Minor (whole-branch review): see `viewerSetEmail`'s identical note —
      // `isMailConfigured(context.config)` and `context.mailer` are two
      // independently supplied deps, so asserting `context.mailer!` let a
      // wiring mistake surface as a bare `TypeError` instead of a clear one.
      const mailer = context.mailer;
      if (mailer === null) {
        throw new Error(
          'Mailer misconfigured: isMailConfigured() reported true but context.mailer is null'
        );
      }
      const userId = await resolveViewerUserId(context);
      if (userId === null) return invalidInputIssue([], 'No such account');

      const row = await context.prisma.user.findUniqueOrThrow({
        where: { id: userId },
        select: { email: true, emailVerifiedAt: true },
      });
      if (row.email === null) {
        return invalidInputIssue([], 'Add an email address first');
      }
      if (row.emailVerifiedAt !== null) {
        return invalidInputIssue([], 'That address is already confirmed');
      }

      const issued = await issueEmailToken(context.prisma, {
        userId,
        purpose: 'verify',
        email: row.email,
      });
      if (!issued.ok) {
        const seconds = Math.ceil(issued.retryAfterMs / 1000);
        return invalidInputIssue([], `Too many attempts — try again in ${seconds} seconds`);
      }
      const sendResult = await mailer.send(
        verificationMessage({
          to: row.email,
          code: issued.code,
          libraryName: context.config.libraryName,
          publicUrl: context.config.publicUrl ?? null,
        })
      );
      return {
        __typename: 'ViewerResendEmailVerificationPayload' as const,
        delivered: sendResult.ok,
      };
    },
  })
);
