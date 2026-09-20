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

export const emailInUseError = (): EmailInUseErrorShape => ({
  __typename: 'EmailInUseError',
  message: 'That email address is already in use by another account.',
});

export const model = builder
  .objectRef<EmailInUseErrorShape>('EmailInUseError')
  .implement({ interfaces: [userError], fields: () => ({}) });
