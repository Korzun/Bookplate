import type { NotificationEvent } from '../../../services/notification';
import { builder } from '../builder';

const values = {
  BOOK_REQUEST_CREATED: { value: 'book_request.created' },
  BOOK_REQUEST_FULFILLED: { value: 'book_request.fulfilled' },
  BOOK_REQUEST_DECLINED: { value: 'book_request.declined' },
} as const satisfies Record<string, { value: NotificationEvent }>;

/**
 * Mirrors `NotificationEvent` in `services/notification.ts`. The `satisfies`
 * above rejects a member whose value is not an event; `_Complete` below
 * rejects an event with no member — the stored strings are dotted, so
 * `Record<Uppercase<...>>` (the trick `BookRequestStatus` uses) cannot express
 * the mapping and exhaustiveness has to be asserted separately.
 */
type Declared = (typeof values)[keyof typeof values]['value'];
type Assert<T extends never> = T;
export type _Complete = Assert<Exclude<NotificationEvent, Declared>>;

export const model = builder.enumType('NotificationEvent', { values });
