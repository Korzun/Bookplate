import { builder } from '../builder';
import { model as userError } from '../user-error';

/**
 * The reader already has `MAX_OPEN_BOOK_REQUESTS` requests open.
 *
 * NOT built from a thrown domain-error class: `createBookRequest` decides this
 * with an explicit count inside its own transaction and RETURNS it, so there is
 * no error instance to carry a message. See that function's doc comment for why
 * the outcome is a value rather than a throw.
 */
export type BookRequestLimitExceededErrorShape = {
  readonly __typename: 'BookRequestLimitExceededError';
  readonly message: string;
  readonly limit: number;
};

export const bookRequestLimitExceededError = (
  limit: number
): BookRequestLimitExceededErrorShape => ({
  __typename: 'BookRequestLimitExceededError',
  message: `You can have ${limit} open requests at a time. Resolve or withdraw one first.`,
  limit,
});

export const model = builder
  .objectRef<BookRequestLimitExceededErrorShape>('BookRequestLimitExceededError')
  .implement({
    description: 'The reader already has the maximum number of open requests.',
    interfaces: [userError],
    fields: (t) => ({
      limit: t.exposeInt('limit'),
    }),
  });
