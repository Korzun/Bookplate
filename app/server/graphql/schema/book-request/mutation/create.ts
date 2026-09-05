import { z } from 'zod';

import { createBookRequest } from '../../../../services/book-request';
import {
  bookRequestLimitExceededError,
  model as bookRequestLimitExceededErrorModel,
} from '../../book-request-limit-exceeded-error/model';
import { builder } from '../../builder';
import {
  duplicateBookRequestError,
  model as duplicateBookRequestErrorModel,
} from '../../duplicate-book-request-error/model';
import {
  invalidInputError,
  model as invalidInputErrorModel,
} from '../../invalid-input-error/model';
import { model as bookRequestModel } from '../model';

/**
 * Title and author are both REQUIRED — the settled decision, and the reason
 * `.min(1)` runs against the TRIMMED value: "   " is an empty title, not a
 * three-character one. `note` is optional and defaults to the empty string,
 * which is also the column's default.
 */
const inputSchema = z.object({
  title: z.string().trim().min(1, 'A title is required').max(500),
  author: z.string().trim().min(1, 'An author is required').max(500),
  note: z.string().trim().max(2000),
});

const input = builder.inputType('BookRequestCreateInput', {
  fields: (t) => ({
    title: t.string({ required: true }),
    author: t.string({ required: true }),
    note: t.string({ required: false }),
  }),
});

type BookRequestCreatePayloadShape = {
  readonly __typename: 'BookRequestCreatePayload';
  readonly userId: string;
  readonly requestId: string;
};

/**
 * A fresh `t.prismaField` lookup by the id the service reported, never the
 * created row handed straight to a `prismaObject` field — the same pattern
 * `DeviceCreatePayload.device` and `UserRegisterPayload.user` use, and required
 * for the same reason: a `prismaObject` field expects a real Prisma row shape,
 * not an arbitrary object with matching field names.
 */
const payload = builder
  .objectRef<BookRequestCreatePayloadShape>('BookRequestCreatePayload')
  .implement({
    fields: (t) => ({
      bookRequest: t.prismaField({
        type: bookRequestModel,
        resolve: (query, parent, _args, context) =>
          context.prisma.bookRequest.findUniqueOrThrow({
            ...query,
            where: { userId_id: { userId: parent.userId, id: parent.requestId } },
          }),
      }),
    }),
  });

/** No `resolveType`: every member value carries its own `__typename`. */
const result = builder.unionType('BookRequestCreateResult', {
  types: [
    payload,
    invalidInputErrorModel,
    bookRequestLimitExceededErrorModel,
    duplicateBookRequestErrorModel,
  ],
});

/**
 * A reader asks for a book that is not in Bookplate.
 *
 * The type-level `{ authenticated: true }` `builder.mutationType` already
 * declares (`schema/builder.ts`) is ANDed with the field-level `authScopes`
 * below, which refuses the config-based admin: `root-auth.test.ts` walks
 * every root field and fails on an ungated one, so both halves of the gate
 * are enforced, not assumed.
 *
 * The field-level `authScopes` is a separate matter from "signed in": the
 * CONFIG-BASED ADMIN is authenticated but has no row in `users`, so it cannot
 * own a library row and cannot be a requester. That is an authorization fact,
 * so it belongs in the scope layer rather than a resolver-body check —
 * `Viewer.user` is null for the same viewer, and the reader card never
 * renders for an admin.
 *
 * Input is parsed INSIDE the resolver, after auth, and `InvalidInputError` is
 * an ordinary union member — see `invalid-input-error/model.ts` for why this
 * schema does not use declarative arg validation.
 *
 * No `toResult`: `createBookRequest` throws nothing. Both of its failure
 * outcomes are values it decided itself, so they map straight onto union
 * members here.
 */
builder.mutationField('bookRequestCreate', (t) =>
  t.field({
    type: result,
    description: 'Asks the library admin for a book that is not in Bookplate.',
    args: { input: t.arg({ type: input, required: true }) },
    authScopes: (_parent, _args, context) => context.viewer?.userId != null,
    resolve: async (_parent, args, context) => {
      // Non-null by the `authScopes` above; this is the type narrowing, not a
      // second guard.
      const userId = context.viewer?.userId ?? '';

      const parsed = inputSchema.safeParse({
        title: args.input.title,
        author: args.input.author,
        note: args.input.note ?? '',
      });
      if (!parsed.success) return invalidInputError(parsed.error);

      const outcome = await createBookRequest(context.prisma, {
        userId,
        title: parsed.data.title,
        author: parsed.data.author,
        note: parsed.data.note,
      });

      switch (outcome.kind) {
        case 'created':
          return { __typename: 'BookRequestCreatePayload' as const, userId, requestId: outcome.id };
        case 'limit':
          return bookRequestLimitExceededError(outcome.limit);
        case 'duplicate':
          return duplicateBookRequestError(outcome.existingId);
      }
    },
  })
);
