import { builder } from '../builder';
import { model as userError } from '../user-error';

/**
 * `PATCH /api/my/password`'s 401 (`routes/ui.ts`, removed in `e67b4ad9`): the
 * presented `currentPassword` does not verify against the caller's stored hash.
 * Not a thrown error (`validateUser` returns `false`, it never throws — see
 * `services/password.ts`'s `validateUser`) and not folded into
 * `InvalidInputError`: the input is well-formed (a non-empty string), it is
 * simply the wrong password, which is a distinct domain outcome a client acts
 * on differently (re-prompt for the current password, not re-validate the
 * form). Carries no data beyond `message` — same "nothing to add" reasoning as
 * `SelfLinkError` (`self-link-error/model.ts`): the client already knows which
 * password it sent.
 */
export type IncorrectPasswordErrorShape = {
  readonly __typename: 'IncorrectPasswordError';
  readonly message: string;
};

export const incorrectPasswordError = (): IncorrectPasswordErrorShape => ({
  __typename: 'IncorrectPasswordError',
  message: 'Current password is incorrect',
});

export const model = builder
  .objectRef<IncorrectPasswordErrorShape>('IncorrectPasswordError')
  .implement({
    description: 'The current password provided does not match the account’s stored password.',
    interfaces: [userError],
    fields: () => ({}),
  });
