import type { NotificationChannel } from '../../../services/notification';
import { builder } from '../builder';

const values = {
  EMAIL: { value: 'email' },
  PUSH: { value: 'push' },
} as const satisfies Record<string, { value: NotificationChannel }>;

type Declared = (typeof values)[keyof typeof values]['value'];
type Assert<T extends never> = T;
export type _Complete = Assert<Exclude<NotificationChannel, Declared>>;

export const model = builder.enumType('NotificationChannel', { values });
