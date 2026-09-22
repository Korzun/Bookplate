import type { NotificationChannel } from '../../../services/notification';
import { builder } from '../builder';

const values = {
  EMAIL: { value: 'email' },
} as const satisfies Record<string, { value: NotificationChannel }>;

/** Web push adds a member here and nothing else. See `notification-event/model.ts`. */
type Declared = (typeof values)[keyof typeof values]['value'];
type Assert<T extends never> = T;
export type _Complete = Assert<Exclude<NotificationChannel, Declared>>;

export const model = builder.enumType('NotificationChannel', { values });
