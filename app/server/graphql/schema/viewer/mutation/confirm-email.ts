import { markEmailVerified, normalizeEmail } from '../../../../services/email';
import { consumeEmailToken } from '../../../../services/email-token';
import { builder } from '../../builder';
import {
  invalidInputIssue,
  model as invalidInputErrorModel,
} from '../../invalid-input-error/model';
import { resolveViewerUserId } from './resolve-user-id';

const input = builder.inputType('ViewerConfirmEmailInput', {
  fields: (t) => ({
    code: t.string({ required: true }),
  }),
});

type ViewerConfirmEmailPayloadShape = {
  readonly __typename: 'ViewerConfirmEmailPayload';
  readonly email: string;
};

const payload = builder
  .objectRef<ViewerConfirmEmailPayloadShape>('ViewerConfirmEmailPayload')
  .implement({
    fields: (t) => ({
      email: t.exposeString('email'),
    }),
  });

/**
 * No `resolveType`: every member value carries its own `__typename` — see
 * `progress/mutation/delete.ts`'s identical note.
 *
 * No `EmailNotConfiguredError` member — deliberately, see the resolver's own
 * doc comment: a code already in a user's hands must stay redeemable even if
 * the operator has since removed the mail credentials.
 */
const result = builder.unionType('ViewerConfirmEmailResult', {
  types: [payload, invalidInputErrorModel],
});

/**
 * Redeems a verification code. Same `emailSetupAllowed` scope and
 * `skipTypeScopes` reasoning as `viewerSetEmail`.
 *
 * Deliberately has NO `isMailConfigured` check, unlike its two siblings: the
 * code was already sent and is sitting in the user's inbox by the time this
 * runs, so an operator removing mail credentials afterward must not strand
 * them mid-confirmation.
 */
builder.mutationField('viewerConfirmEmail', (t) =>
  t.field({
    type: result,
    description:
      "Confirms the viewer's email address with the code sent to it. Works even " +
      'when mail is currently unconfigured — the code was already delivered.',
    args: { input: t.arg({ type: input, required: true }) },
    skipTypeScopes: true,
    authScopes: { emailSetupAllowed: true },
    resolve: async (_root, args, context) => {
      const userId = await resolveViewerUserId(context);
      if (userId === null) return invalidInputIssue([], 'No such account');

      const consumed = await consumeEmailToken(context.prisma, {
        userId,
        purpose: 'verify',
        code: args.input.code,
      });
      // One message for every failure — wrong, expired, already used. The user
      // takes the same action in all three cases (resend), and distinguishing
      // them tells a guesser which half of the guess was right.
      if (consumed === null) {
        return invalidInputIssue(['code'], 'That code is not valid or has expired');
      }
      const row = await context.prisma.user.findUniqueOrThrow({
        where: { id: userId },
        select: { email: true },
      });
      // The address moved after the code was issued: confirming would mark an
      // address verified that this code never proved.
      if (row.email === null || normalizeEmail(row.email) !== normalizeEmail(consumed.email)) {
        return invalidInputIssue(['code'], 'That code was sent to a different address');
      }
      await markEmailVerified(context.prisma, userId);
      return { __typename: 'ViewerConfirmEmailPayload' as const, email: row.email };
    },
  })
);
