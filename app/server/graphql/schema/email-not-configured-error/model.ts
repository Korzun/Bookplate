import { builder } from '../builder';
import { model as userError } from '../user-error';

/**
 * A distinct type rather than an `InvalidInputError`: nothing the user typed is
 * wrong, and a client should render this as the administrator's task rather than
 * as a field error. It is reachable mainly when an operator removes the mail
 * credentials while a client that already loaded the page is still open.
 */
export type EmailNotConfiguredErrorShape = {
  readonly __typename: 'EmailNotConfiguredError';
  readonly message: string;
};

export const emailNotConfiguredError = (): EmailNotConfiguredErrorShape => ({
  __typename: 'EmailNotConfiguredError',
  message: 'Email is not configured on this server. Ask the administrator to set it up.',
});

export const model = builder
  .objectRef<EmailNotConfiguredErrorShape>('EmailNotConfiguredError')
  .implement({ interfaces: [userError], fields: () => ({}) });
