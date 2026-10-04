import type { NotificationChannel } from '../../../services/notification';
import { builder } from '../builder';

const values = {
  EMAIL: { value: 'email' },
  PUSH: { value: 'push' },
} as const satisfies Record<string, { value: NotificationChannel }>;

/**
 * Mirrors `NotificationChannel` in `services/notification.ts` — see
 * `notification-event/model.ts`'s own doc comment for the shared
 * union ↔ enum ↔ `_Complete` exhaustiveness trick both files use: `satisfies`
 * above rejects a member whose value is not a channel, `_Complete` below
 * rejects a channel with no member.
 */
type Declared = (typeof values)[keyof typeof values]['value'];
type Assert<T extends never> = T;
export type _Complete = Assert<Exclude<NotificationChannel, Declared>>;

export const model = builder.enumType('NotificationChannel', { values });
