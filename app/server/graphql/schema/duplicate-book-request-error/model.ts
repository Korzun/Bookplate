import { encodeGlobalID } from '@pothos/plugin-relay';

import { builder } from '../builder';
import { model as userError } from '../user-error';

/**
 * The reader already has an OPEN request for this title and author.
 *
 * `existingRequestId` is the request's GLOBAL id — the exact value
 * `BookRequest.id` carries, so a client can find that request in a list it
 * already holds (keyed on the node's global id) or resolve it with
 * `node(id:)`. It is computed the way the schema computes it for the live row,
 * `encodeGlobalID('BookRequest', JSON.stringify([userId, id]))` (Pothos's
 * compound-id serializer — `node-scope.ts`'s `parseCompoundId` doc comment),
 * the same construction `BookDeletePayload.deletedId` uses. Both halves are
 * already in hand, so this costs no read on the failure path of a create.
 *
 * It used to be the RAW row id, which matched nothing a client held: no field
 * in the schema emits a raw request id, and `node(id:)` cannot resolve one.
 *
 * Only OPEN requests collide — see `createBookRequest`'s doc comment.
 */
export type DuplicateBookRequestErrorShape = {
  readonly __typename: 'DuplicateBookRequestError';
  readonly message: string;
  readonly existingRequestId: string;
};

export const duplicateBookRequestError = (
  userId: string,
  existingId: string
): DuplicateBookRequestErrorShape => ({
  __typename: 'DuplicateBookRequestError',
  message: 'You have already requested this book.',
  existingRequestId: encodeGlobalID('BookRequest', JSON.stringify([userId, existingId])),
});

export const model = builder
  .objectRef<DuplicateBookRequestErrorShape>('DuplicateBookRequestError')
  .implement({
    description: 'An open request for this title and author already exists.',
    interfaces: [userError],
    fields: (t) => ({
      existingRequestId: t.exposeID('existingRequestId', {
        description: 'The id of the request already open — the same value as its `BookRequest.id`.',
      }),
    }),
  });
