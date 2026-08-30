import type { BookRequestStatus } from '../../../services/book-request';
import { model as bookRequestStatus } from '../book-request-status/model';
import { builder } from '../builder';
import { model as userError } from '../user-error';

/**
 * The request has already been resolved. Returned instead of silently
 * overwriting, so a double resolve — two admins, or one admin and a stale tab —
 * is a typed answer the client can render rather than a lost decision.
 */
export type BookRequestNotPendingErrorShape = {
  readonly __typename: 'BookRequestNotPendingError';
  readonly message: string;
  readonly status: BookRequestStatus;
};

export const bookRequestNotPendingError = (
  status: BookRequestStatus
): BookRequestNotPendingErrorShape => ({
  __typename: 'BookRequestNotPendingError',
  message: `This request has already been ${status}.`,
  status,
});

export const model = builder
  .objectRef<BookRequestNotPendingErrorShape>('BookRequestNotPendingError')
  .implement({
    description: 'The request was already resolved; nothing was changed.',
    interfaces: [userError],
    fields: (t) => ({
      status: t.field({ type: bookRequestStatus, resolve: (error) => error.status }),
    }),
  });
