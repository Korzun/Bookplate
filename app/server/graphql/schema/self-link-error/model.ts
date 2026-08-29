import type { SelfLinkError as StoreError } from '../../../services/book-errors';
import { builder } from '../builder';
import { model as userError } from '../user-error';

/**
 * `SelfLinkError` carries no data — `linkDocument` (`services/book-lineage.
 * ts`) throws it when `documentId === bookId`, and the client already knows
 * both. Its only field is the `message` Pothos copies down from `UserError`,
 * so `fields` below is deliberately empty rather than restating it.
 */
export type SelfLinkErrorShape = {
  readonly __typename: 'SelfLinkError';
  readonly message: string;
};

export const selfLinkError = (error: StoreError): SelfLinkErrorShape => ({
  __typename: 'SelfLinkError',
  message: error.message,
});

export const model = builder.objectRef<SelfLinkErrorShape>('SelfLinkError').implement({
  description: 'A book cannot be linked to its own id.',
  interfaces: [userError],
  fields: () => ({}),
});
