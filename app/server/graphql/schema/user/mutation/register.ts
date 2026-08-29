import * as fs from 'fs';
import * as path from 'path';

import { z } from 'zod';

import { generateLoginPassword, hashLoginPassword } from '../../../../services/password';
import { createUser } from '../../../../services/user';
import { isValidUsername, MIN_USERNAME_LENGTH } from '../../../../utils/username';
import { builder } from '../../builder';
import {
  invalidInputError,
  model as invalidInputErrorModel,
} from '../../invalid-input-error/model';
import {
  model as usernameAlreadyExistsErrorModel,
  usernameAlreadyExistsError,
} from '../../username-already-exists-error/model';
import { model as userModel } from '../model';

/**
 * `username` only — REST's `POST /api/users` took nothing else in its body,
 * before Phase 0 removed that route. No `userId`: unlike every other
 * user-associated mutation in this file, this one creates the row rather
 * than acting on an existing one, so there is nothing yet to name with a
 * `User` global ID.
 */
const input = builder.inputType('UserRegisterInput', {
  fields: (t) => ({
    username: t.string({ required: true }),
  }),
});

/**
 * Split in two, deliberately not one combined schema, because REST checks
 * these in an order this resolver has to reproduce exactly (see the
 * resolver's own doc comment): charset first, then (after the reserved-name
 * check, which is NOT a validation failure) length. `trim()` mirrors REST's
 * `username.trim()` — the trimmed value is what every downstream check,
 * including the reserved-name comparison and `createUser`, actually uses.
 *
 * `superRefine` rather than `.min(1).refine(...)`: REST's own checks
 * (`!username.trim()`, then `!isValidUsername(...)`) are sequential early
 * returns, so an empty string only ever produces "Username is required" —
 * it never also reaches the charset check. Two independent zod checks on the
 * same field would both fire for an empty string (it fails both `.min(1)`
 * and `isValidUsername`), producing two issues where REST reports one; the
 * explicit `return` after the emptiness issue reproduces REST's early exit
 * instead.
 */
const charsetSchema = z.object({
  username: z
    .string()
    .trim()
    .superRefine((value, ctx) => {
      if (value.length < 1) {
        ctx.addIssue({ code: z.ZodIssueCode.custom, message: 'Username is required' });
        return;
      }
      if (!isValidUsername(value)) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          message:
            'Username may only contain letters, numbers, dots, underscores and dashes, and must start with a letter or number',
        });
      }
    }),
});

const lengthSchema = z.object({
  username: z
    .string()
    .min(MIN_USERNAME_LENGTH, `Username must be at least ${MIN_USERNAME_LENGTH} characters`),
});

type UserRegisterPayloadShape = {
  readonly __typename: 'UserRegisterPayload';
  readonly username: string;
  readonly password: string;
};

/**
 * `user` is a fresh `t.prismaField` lookup by the username this resolver just
 * created, not a hand-built DTO — same "field resolvers do the lookup"
 * pattern `BookUpdateMetadataPayload.book` and `ProgressSetPayload.progress`
 * use, and for the identical reason: `createUser` (`services/user.ts`) returns a plain
 * `boolean`, not a row, so there is nothing to carry forward except the
 * username that named it. `findUniqueOrThrow` is safe: the row was created by
 * the very `createUser` call that produced this payload, inside the same
 * request.
 */
const payload = builder.objectRef<UserRegisterPayloadShape>('UserRegisterPayload').implement({
  fields: (t) => ({
    user: t.prismaField({
      type: userModel,
      resolve: (query, parent, _args, context) =>
        context.prisma.user.findUniqueOrThrow({ ...query, where: { username: parent.username } }),
    }),
    password: t.exposeString('password'),
  }),
});

/**
 * No `resolveType`: every member value carries its own `__typename` — see
 * `progress/mutation/delete.ts`'s identical note.
 */
const result = builder.unionType('UserRegisterResult', {
  types: [payload, invalidInputErrorModel, usernameAlreadyExistsErrorModel],
});

/**
 * Mirrored REST's `POST /api/users`, removed in Phase 0 — `router.use(adminAuth)`
 * gated the whole router, so this is admin-only with no `ownerOf` alternative
 * (there is no self-registration in this app).
 *
 * The four REST checks run in this exact order, reproduced here rather than
 * batched, because the third one is NOT a validation failure and REST
 * evaluates it strictly between the other two:
 *
 *  1. charset (400) — `isValidUsername`, `charsetSchema` above.
 *  2. reserved name (409) — `trimmedUsername === adminUsername` (mirroring
 *     REST's `routes/users.ts`, removed in Phase 0). Checked before the length floor, so the
 *     default built-in admin name ("admin", 5 chars — one under
 *     `MIN_USERNAME_LENGTH`) hits THIS branch, not the length one; a
 *     combined schema checking length first would silently reorder REST's
 *     own behaviour. Modelled as `UsernameAlreadyExistsError`, not
 *     `InvalidInputError` — see that type's doc comment for why both 409
 *     branches share it.
 *  3. length (400) — `lengthSchema` above.
 *  4. genuine duplicate (409) — `createUser` returns `false` on a
 *     `P2002` unique-constraint collision (a race: two concurrent
 *     registrations of the same name). Same `UsernameAlreadyExistsError`.
 *
 * `fs.mkdirSync` before `createUser` mirrors REST's own ordering
 * (`routes/users.ts`, removed in Phase 0) and creates the on-disk library
 * folder immediately rather than waiting for the first book — REST did this
 * even though `addBook` (`services/book-lifecycle.ts`) would create the
 * same folder lazily on first write; mirrored literally rather than dropped,
 * since an admin (or an SFTP/rsync workflow) may expect the folder to exist
 * the moment the account does.
 *
 * `createUser` is NOT wrapped in `toResult`: it already converts
 * its one throwable case (`P2002`) into `false` internally
 * (`services/user.ts:15-39`) — nothing it can still throw is one of the
 * seven known store errors, so the `err` branch `toResult` would add could
 * only be discharged by throwing or mislabelling. Same reasoning as
 * `progressDelete`'s note on `clearProgress`.
 */
builder.mutationField('userRegister', (t) =>
  t.field({
    type: result,
    description: 'Creates a new user account with a generated login password.',
    args: { input: t.arg({ type: input, required: true }) },
    authScopes: { admin: true },
    resolve: async (_parent, args, context) => {
      const charsetParsed = charsetSchema.safeParse({ username: args.input.username });
      if (!charsetParsed.success) return invalidInputError(charsetParsed.error);
      const username = charsetParsed.data.username;

      if (username === context.config.username) {
        return usernameAlreadyExistsError(username);
      }

      const lengthParsed = lengthSchema.safeParse({ username });
      if (!lengthParsed.success) return invalidInputError(lengthParsed.error);

      fs.mkdirSync(path.join(context.config.booksDir, username), { recursive: true });

      const password = generateLoginPassword();
      const passwordHash = await hashLoginPassword(password);
      const created = await createUser(context.prisma, username, passwordHash, undefined, true);
      if (!created) return usernameAlreadyExistsError(username);

      return { __typename: 'UserRegisterPayload' as const, username, password };
    },
  })
);
