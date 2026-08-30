import { decodeGlobalID } from '@pothos/plugin-relay';

import { declineBookRequest } from '../../../../services/book-request';
import {
  bookRequestNotPendingError,
  model as bookRequestNotPendingErrorModel,
} from '../../book-request-not-pending-error/model';
import { builder } from '../../builder';
import { parseCompoundId } from '../../node-scope';
import { model as bookRequestModel } from '../model';

/**
 * Same fix `fulfill.ts` needs for the same reason — see that file's doc
 * comment on this helper. `t.arg.id()` hands the resolver the raw base64
 * global id, not the pre-decoded local id `parseCompoundId` expects, so this
 * unwraps the `TypeName:` wrapper first.
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

type BookRequestDeclinePayloadShape = {
  readonly __typename: 'BookRequestDeclinePayload';
  readonly userId: string;
  readonly requestId: string;
};

const payload = builder
  .objectRef<BookRequestDeclinePayloadShape>('BookRequestDeclinePayload')
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

const result = builder.unionType('BookRequestDeclineResult', {
  types: [payload, bookRequestNotPendingErrorModel],
});

/**
 * Turns a request down, with an optional reason the reader sees.
 *
 * A malformed id is `null`, not `InvalidInputError` — unlike `fulfill`, this
 * mutation has no second identifier for a client to get wrong, so "no such
 * request" is the whole of the answer.
 */
builder.mutationField('bookRequestDecline', (t) =>
  t.field({
    type: result,
    nullable: true,
    description: 'Turns down a request, optionally with a reason.',
    args: {
      id: t.arg.id({ required: true }),
      reason: t.arg.string({ required: false }),
    },
    authScopes: { admin: true },
    resolve: async (_parent, args, context) => {
      const request = decodeCompoundGlobalId(String(args.id), 'BookRequest');
      if (request === null) return null;
      const [userId, requestId] = request;

      const outcome = await declineBookRequest(context.prisma, {
        userId,
        id: requestId,
        reason: args.reason ?? '',
      });

      switch (outcome.kind) {
        case 'resolved':
          return { __typename: 'BookRequestDeclinePayload' as const, userId, requestId };
        case 'missing':
          return null;
        case 'notPending':
          return bookRequestNotPendingError(outcome.status);
      }
    },
  })
);
