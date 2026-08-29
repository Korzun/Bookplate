import { builder } from '../builder';
import { model as userError } from '../user-error';

/**
 * REST's `POST /api/users` (`routes/users.ts`, removed in Phase 0) had two
 * 409 branches, collapsed into one honest member here — both produced the
 * identical body (`{ error: 'Username
 * already exists' }`) and neither is a thrown domain error, so this is not built from
 * an `instanceof`-checked class the way `BookHashCollisionError` etc. are
 * (see `to-result.ts`'s doc comment on why only the seven declared classes go
 * through that path):
 *
 *  - the trimmed username equals `config.username`, the reserved built-in
 *    admin name (mirroring REST's `routes/users.ts`) — checked BEFORE the length
 *    check, so a name that is both reserved and too short (the default
 *    `admin`/5 chars, under `MIN_USERNAME_LENGTH`/6) gets this, not
 *    `InvalidInputError`; `user/mutation/register.ts` reproduces that exact
 *    ordering;
 *  - `createUser` returns `false` on a genuine `P2002` unique-
 *    constraint collision (`services/user.ts`) — a race, not a
 *    validation failure, so it is not folded into `InvalidInputError` either
 *    (that type is reserved for the resolver's own zod parse — see that
 *    type's doc comment).
 */
export type UsernameAlreadyExistsErrorShape = {
  readonly __typename: 'UsernameAlreadyExistsError';
  readonly message: string;
  readonly username: string;
};

export const usernameAlreadyExistsError = (username: string): UsernameAlreadyExistsErrorShape => ({
  __typename: 'UsernameAlreadyExistsError',
  message: 'Username already exists',
  username,
});

export const model = builder
  .objectRef<UsernameAlreadyExistsErrorShape>('UsernameAlreadyExistsError')
  .implement({
    description:
      'A user with this username already exists, or the name is reserved for ' +
      'the built-in admin account.',
    interfaces: [userError],
    fields: (t) => ({
      username: t.exposeString('username'),
    }),
  });
