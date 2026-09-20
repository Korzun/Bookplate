import { setUserEmail } from '../../../../services/email';
import { invalidateEmailTokens, issueEmailToken } from '../../../../services/email-token';
import { verificationMessage } from '../../../../services/mail-template';
import { isMailConfigured } from '../../../../services/mailer';
import { builder } from '../../builder';
import { emailInUseError, model as emailInUseErrorModel } from '../../email-in-use-error/model';
import {
  emailNotConfiguredError,
  model as emailNotConfiguredErrorModel,
} from '../../email-not-configured-error/model';
import {
  invalidInputIssue,
  model as invalidInputErrorModel,
} from '../../invalid-input-error/model';
import { resolveViewerUserId } from './resolve-user-id';

/**
 * `email` only — this is how a viewer both sets their address for the first
 * time (clearing `mustSetEmail`, once the client re-fetches the viewer) and
 * changes it later; both are the same write (`setUserEmail`).
 */
const input = builder.inputType('ViewerSetEmailInput', {
  fields: (t) => ({
    email: t.string({ required: true }),
  }),
});

type ViewerSetEmailPayloadShape = {
  readonly __typename: 'ViewerSetEmailPayload';
  readonly email: string;
  readonly delivered: boolean;
};

const payload = builder.objectRef<ViewerSetEmailPayloadShape>('ViewerSetEmailPayload').implement({
  fields: (t) => ({
    email: t.exposeString('email'),
    /**
     * Whether the verification email actually went out. False means the address
     * was saved but the message did not send (bad credentials, a bounce, a
     * throttle) — the client shows a "resend" affordance rather than an error,
     * because nothing the user did was wrong.
     */
    delivered: t.exposeBoolean('delivered'),
  }),
});

/**
 * No `resolveType`: every member value carries its own `__typename` — see
 * `progress/mutation/delete.ts`'s identical note.
 */
const result = builder.unionType('ViewerSetEmailResult', {
  types: [payload, invalidInputErrorModel, emailInUseErrorModel, emailNotConfiguredErrorModel],
});

/**
 * Stores an address and sends a verification code — the client-facing "add or
 * change my email" mutation.
 *
 * Uses `emailSetupAllowed`, not `authenticated`: this is one of the only three
 * mutations a viewer with a pending `mustSetEmail` gate can reach (see
 * `builder.ts`'s doc comment on the scope, and `resolve-user-id.ts` for why the
 * config admin — whose token carries no `sub` — needs its own row lookup to
 * key `EmailToken`). `skipTypeScopes: true` is required for the same reason
 * `userChangePassword` needs it: `Mutation`'s type-level scope is
 * `authenticated`, which is FALSE for exactly the viewer this mutation exists
 * for (one owing either a password change or an email address), and Pothos
 * ANDs type-level with field-level scopes by default.
 *
 * A password-change-pending viewer is refused: `emailSetupAllowed` is
 * `viewer !== null && !viewer.mustChangePassword`, so this mutation stays
 * unreachable until that flag clears. Password-change precedence over
 * email-setup is enforced at the scope, not re-checked here.
 */
builder.mutationField('viewerSetEmail', (t) =>
  t.field({
    type: result,
    description:
      "Sets the viewer's email address and sends a verification code to it. " +
      'Succeeds (with `delivered: false`) even if the send itself fails, because ' +
      'the address is already saved by then.',
    args: { input: t.arg({ type: input, required: true }) },
    skipTypeScopes: true,
    authScopes: { emailSetupAllowed: true },
    resolve: async (_root, args, context) => {
      if (!isMailConfigured(context.config)) return emailNotConfiguredError();
      // Minor (whole-branch review): `isMailConfigured(context.config)` and
      // `context.mailer` are two INDEPENDENTLY supplied deps (`index.ts`
      // builds both from `config.mail`, but nothing enforces they can't
      // drift) — asserting `context.mailer!` below let a wiring mistake
      // surface as a bare `TypeError` instead of a clear one. `routes/
      // password.ts`'s `requireMail` already checks both; this does the same.
      const mailer = context.mailer;
      if (mailer === null) {
        throw new Error(
          'Mailer misconfigured: isMailConfigured() reported true but context.mailer is null'
        );
      }
      const userId = await resolveViewerUserId(context);
      if (userId === null) return invalidInputIssue([], 'No such account');

      const outcome = await setUserEmail(context.prisma, userId, args.input.email);
      if (!outcome.ok) {
        return outcome.reason === 'in_use'
          ? emailInUseError()
          : invalidInputIssue(['email'], 'Enter a valid email address');
      }

      // `reset` ONLY, not `verify` (I1, whole-branch review). A reset code sent
      // to an address the account no longer has must not remain spendable —
      // but the `verify` row is where `sentAt`/`createdAt`/`sendCount` live,
      // and deleting it here let `issueEmailToken` below recreate it with
      // `sendCount: 1`, bypassing both the 60s cooldown and the
      // 5-per-rolling-hour cap on every call to this mutation (there is no
      // rate limiter on `/graphql`). `issueEmailToken`'s upsert already
      // invalidates whatever `verify` code was outstanding by overwriting its
      // `tokenHash` and `email` in place — see that function's doc comment —
      // so narrowing this call does not leave an old code valid for the new
      // address. The accepted cost: the cap becomes five sends per hour PER
      // USER across every address change, not five per address. That is the
      // spec's intent — the cap exists to bound mail volume this install can
      // generate, not to be reset by editing a field.
      await invalidateEmailTokens(context.prisma, userId, 'reset');

      const trimmedEmail = args.input.email.trim();
      const issued = await issueEmailToken(context.prisma, {
        userId,
        purpose: 'verify',
        email: trimmedEmail,
      });
      // The address is already saved. A send failure is reported through
      // `delivered: false` rather than as an error result, because failing the
      // mutation would tell the client nothing was stored — and the resend
      // button is how the user retries.
      const delivered =
        issued.ok &&
        (
          await mailer.send(
            verificationMessage({
              to: trimmedEmail,
              code: issued.code,
              libraryName: context.config.libraryName,
              publicUrl: context.config.publicUrl ?? null,
            })
          )
        ).ok;

      return { __typename: 'ViewerSetEmailPayload' as const, email: trimmedEmail, delivered };
    },
  })
);
