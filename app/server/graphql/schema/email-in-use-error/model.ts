import { builder } from '../builder';
import { model as userError } from '../user-error';

/**
 * Returned by `viewerSetEmail` when `setUserEmail` (`services/email.ts`)
 * reports its `emailKey` unique-constraint collision back as an outcome —
 * see that function's own doc comment for why a second account wanting the
 * same address is an ordinary thing to render, not a fault. Mirrors
 * `usernameAlreadyExistsError`'s shape for the same reason: a plain data
 * shape, not a thrown domain error, since a `P2002` collision on `emailKey`
 * is caught inside `setUserEmail` itself.
 */
export type EmailInUseErrorShape = {
  readonly __typename: 'EmailInUseError';
  readonly message: string;
};

// The message is deliberately UNIFORM — it never says who holds the address
// or whether they have confirmed it, because it is returned to whoever
// probed the address, and that is operator-only information (see
// `user/mutation/clear-email.ts`'s `userClearEmail` — the actual remedy this
// copy points at). Pointing the reader at "your administrator" is new: now
// that `userClearEmail` exists, a squatted address is no longer a dead end.
export const emailInUseError = (): EmailInUseErrorShape => ({
  __typename: 'EmailInUseError',
  message:
    'That email address is already in use by another account. Ask your administrator if you think it should be yours.',
});

export const model = builder
  .objectRef<EmailInUseErrorShape>('EmailInUseError')
  .implement({ interfaces: [userError], fields: () => ({}) });
