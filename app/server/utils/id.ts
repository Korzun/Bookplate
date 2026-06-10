import { customAlphabet } from 'nanoid';

/** Generates a 21-character alphanumeric ID, used as the surrogate primary key for users. */
export const generateUserId = customAlphabet(
  'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789',
  21
);
