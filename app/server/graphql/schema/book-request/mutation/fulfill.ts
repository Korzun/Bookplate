import { decodeGlobalID } from '@pothos/plugin-relay';

import { fulfillBookRequest } from '../../../../services/book-request';
import {
  bookRequestNotPendingError,
  model as bookRequestNotPendingErrorModel,
} from '../../book-request-not-pending-error/model';
import { builder } from '../../builder';
import {
  invalidInputIssue,
  model as invalidInputErrorModel,
} from '../../invalid-input-error/model';
import { parseCompoundId } from '../../node-scope';
import { model as bookRequestModel } from '../model';

/**
 * `t.arg.id()` (below) hands the resolver the RAW base64 global id, unlike
 * `prismaNode`'s own `findUnique` — the mechanism `parseCompoundId`'s doc
 * comment describes — which only ever runs after the relay plugin's Node
 * interface machinery has already stripped the `TypeName:` wrapper. A plain
 * arg gets no such treatment, so this mirrors `progress/mutation/delete.ts`'s
 * `decodeProgressId`: `decodeGlobalID` first (base64 + typename), then
 * `parseCompoundId` on what's left. Every failure mode — bad base64, wrong
 * typename, a local part that isn't the `[userId, id]` pair — collapses to
 * `null`, same convention `decodeProgressId` uses, so a malformed or
 * wrong-type id is indistinguishable from a well-formed one naming nothing.
 */
const decodeCompoundGlobalId = (
  raw: string,
  typename: string
): readonly [userId: string, id: string] | null => {
  let decoded: { typename: string; id: string };
  try {
    decoded = decodeGlobalID(raw);
  } catch {
    return null;
  }
  if (decoded.typename !== typename) return null;
  return parseCompoundId(decoded.id);
};

type BookRequestFulfillPayloadShape = {
  readonly __typename: 'BookRequestFulfillPayload';
  readonly userId: string;
  readonly requestId: string;
};

const payload = builder
  .objectRef<BookRequestFulfillPayloadShape>('BookRequestFulfillPayload')
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

const result = builder.unionType('BookRequestFulfillResult', {
  types: [payload, invalidInputErrorModel, bookRequestNotPendingErrorModel],
});

/**
 * Links a book to a request and closes it — the mutation the upload queue fires
 * on its own when an item bound to a request finishes, and the one the admin's
 * "link an existing book" picker calls by hand. Two entry points, one mutation.
 *
 * BOTH `id` ARGS ARE GLOBAL IDS. A `BookRequest` global id decodes to
 * `[userId, id]` and a `Book` global id to `[userId, id]` too, through
 * `parseCompoundId` — the same helper `ownerScopedFindUnique` uses. `bookId` is
 * a global id rather than a raw content hash both because every mutation here
 * takes global ids and because the client half is forbidden from handling a raw
 * book id at all (`provider/upload`'s documented constraint).
 *
 * A NULL RESULT MEANS "no such request", and says nothing more. A book that is
 * not in the request owner's library is `InvalidInputError`, not a distinct
 * member: a more specific answer would confirm which library does have it.
 *
 * No `toResult`: `fulfillBookRequest` throws nothing — every outcome is a value
 * it decided inside its own transaction.
 */
builder.mutationField('bookRequestFulfill', (t) =>
  t.field({
    type: result,
    nullable: true,
    description: 'Marks a request fulfilled by a book in that reader library.',
    args: {
      id: t.arg.id({ required: true }),
      bookId: t.arg.id({ required: true }),
    },
    authScopes: { admin: true },
    resolve: async (_parent, args, context) => {
      const request = decodeCompoundGlobalId(String(args.id), 'BookRequest');
      const book = decodeCompoundGlobalId(String(args.bookId), 'Book');
      if (request === null || book === null) {
        return invalidInputIssue(['id'], 'Malformed identifier');
      }

      const [userId, requestId] = request;
      const [bookUserId, bookId] = book;

      const outcome = await fulfillBookRequest(context.prisma, {
        userId,
        id: requestId,
        bookUserId,
        bookId,
      });

      switch (outcome.kind) {
        case 'resolved':
          return { __typename: 'BookRequestFulfillPayload' as const, userId, requestId };
        case 'missing':
          return null;
        case 'notPending':
          return bookRequestNotPendingError(outcome.status);
        case 'noSuchBook':
          return invalidInputIssue(['bookId'], 'That book is not in this reader library');
      }
    },
  })
);
