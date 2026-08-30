import { builder } from '../builder';
import { model as userError } from '../user-error';

/**
 * The reader already has an OPEN request for this title and author.
 *
 * `existingRequestId` is the RAW row id, not a global id, and is deliberately
 * plain `ID`: it exists so the client can scroll to or highlight the request
 * the reader already has, and the list it would look in is keyed on the node's
 * global id. Resolving it to a node here would mean a second read on the
 * failure path of a create.
 *
 * Only OPEN requests collide — see `createBookRequest`'s doc comment.
 */
export type DuplicateBookRequestErrorShape = {
  readonly __typename: 'DuplicateBookRequestError';
  readonly message: string;
  readonly existingRequestId: string;
};

export const duplicateBookRequestError = (existingId: string): DuplicateBookRequestErrorShape => ({
  __typename: 'DuplicateBookRequestError',
  message: 'You have already requested this book.',
  existingRequestId: existingId,
});

export const model = builder
  .objectRef<DuplicateBookRequestErrorShape>('DuplicateBookRequestError')
  .implement({
    description: 'An open request for this title and author already exists.',
    interfaces: [userError],
    fields: (t) => ({
      existingRequestId: t.exposeID('existingRequestId'),
    }),
  });
