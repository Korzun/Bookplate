import type { BookRequestStatus } from '../../../services/book-request';
import { builder } from '../builder';

/**
 * Mirrors `BookRequestStatus` in `services/book-request.ts`. Member names are
 * SCREAMING_CASE per GraphQL convention; `value:` maps to the stored lowercase,
 * exactly as `CoverFit` does. The value union is `satisfies`-checked against
 * the imported type so the two cannot silently drift apart.
 */
export const model = builder.enumType('BookRequestStatus', {
  values: {
    PENDING: { value: 'pending' },
    FULFILLED: { value: 'fulfilled' },
    DECLINED: { value: 'declined' },
  } as const satisfies Record<Uppercase<BookRequestStatus>, { value: BookRequestStatus }>,
});
