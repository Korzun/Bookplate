import { z } from 'zod';

import { updateBookRequest } from '../../../../services/book-request';
import {
  bookRequestNotPendingError,
  model as bookRequestNotPendingErrorModel,
} from '../../book-request-not-pending-error/model';
import { builder } from '../../builder';
import {
  duplicateBookRequestError,
  model as duplicateBookRequestErrorModel,
} from '../../duplicate-book-request-error/model';
import {
  invalidInputError,
  model as invalidInputErrorModel,
} from '../../invalid-input-error/model';
import { decodeCompoundGlobalId, isOwnerOrAdmin } from '../../node-scope';
import { model as bookRequestModel } from '../model';

/**
 * The create rules, each made optional: an edit must not be able to store a
 * row that `bookRequestCreate` would have refused, but a field the caller did
 * not send is left alone rather than validated. `.optional()` wraps the whole
 * chain, so a SUPPLIED "   " still trims to empty and fails `.min(1)`.
 */
const inputSchema = z.object({
  title: z.string().trim().min(1, 'A title is required').max(500).optional(),
  author: z.string().trim().min(1, 'An author is required').max(500).optional(),
  note: z.string().trim().max(2000).optional(),
});

const input = builder.inputType('BookRequestUpdateInput', {
  fields: (t) => ({
    title: t.string({ required: false }),
    author: t.string({ required: false }),
    note: t.string({ required: false }),
  }),
});

type BookRequestUpdatePayloadShape = {
  readonly __typename: 'BookRequestUpdatePayload';
  readonly userId: string;
  readonly requestId: string;
};

/**
 * A fresh `t.prismaField` re-read of the edited row, for the reason
 * `BookRequestCreatePayload.bookRequest` gives: a `prismaObject` field needs a
 * real Prisma row shape, and the service reports an outcome, not a row.
 */
const payload = builder
  .objectRef<BookRequestUpdatePayloadShape>('BookRequestUpdatePayload')
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
const result = builder.unionType('BookRequestUpdateResult', {
  types: [
    payload,
    invalidInputErrorModel,
    duplicateBookRequestErrorModel,
    bookRequestNotPendingErrorModel,
  ],
});

/**
 * A reader corrects a request they filed — a typo in the author, a better
 * note — in place, keeping its id and `createdAt`, instead of withdrawing and
 * re-filing it.
 *
 * Owner-or-admin, decided on the `userId` decoded from the compound global id,
 * exactly as `bookRequestDelete` does and for the same reason: the owner is
 * not an argument, so it cannot be an `ownerOf` scope. A caller who is neither,
 * a malformed id and a missing row all get `null`, so nothing leaks about
 * whether another reader has that id. No field-level `authScopes`: the
 * type-level `{ authenticated: true }` on `Mutation` is the sign-in gate.
 *
 * Only a PENDING request is editable; the service decides that inside its
 * transaction, and a resolved one comes back as `BookRequestNotPendingError`
 * so the client can say why rather than silently doing nothing.
 *
 * No `context.notifications.poke()`: an edit is not news to the admin the way
 * a new request is, and the queue already shows the current text.
 */
builder.mutationField('bookRequestUpdate', (t) =>
  t.field({
    type: result,
    nullable: true,
    description: 'Corrects the title, author or note of a pending request.',
    args: {
      id: t.arg.id({ required: true }),
      input: t.arg({ type: input, required: true }),
    },
    resolve: async (_parent, args, context) => {
      const request = decodeCompoundGlobalId(String(args.id), 'BookRequest');
      if (request === null) return null;
      const [userId, requestId] = request;

      if (!isOwnerOrAdmin(context.viewer, userId)) return null;

      // GraphQL `null` folds to omitted: an explicit null means "unchanged",
      // never "clear it" — title and author cannot be cleared at all.
      const parsed = inputSchema.safeParse({
        title: args.input.title ?? undefined,
        author: args.input.author ?? undefined,
        note: args.input.note ?? undefined,
      });
      if (!parsed.success) return invalidInputError(parsed.error);

      const outcome = await updateBookRequest(context.prisma, {
        userId,
        id: requestId,
        ...parsed.data,
      });

      switch (outcome.kind) {
        case 'updated':
          return { __typename: 'BookRequestUpdatePayload' as const, userId, requestId };
        case 'missing':
          return null;
        case 'notPending':
          return bookRequestNotPendingError(outcome.status);
        case 'duplicate':
          return duplicateBookRequestError(outcome.existingId);
      }
    },
  })
);
