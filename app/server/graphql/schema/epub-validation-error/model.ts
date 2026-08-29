import type {
  EpubValidationError as StoreError,
  ValidationMessage,
} from '../../../services/epub-validator';
import { builder } from '../builder';
import { model as epubValidationMessage } from '../epub-validation-message';
import { model as userError } from '../user-error';

/**
 * `EpubValidationError(messages, counts, threshold)` — an upload or replace
 * whose EPUB failed epubcheck at the configured threshold.
 *
 * `messages` is `[EpubValidationMessage!]!`, not the spec's literal
 * `[ValidationMessage!]!`: see `epub-validation-message/model.ts` for why the
 * stored row type cannot honestly back these values.
 *
 * `counts` and `threshold` are carried by the domain error but not exposed —
 * the counts are derivable from `messages`, and the threshold is already
 * readable as `Config`/`Validation.threshold`.
 */
export type EpubValidationErrorShape = {
  readonly __typename: 'EpubValidationError';
  readonly message: string;
  readonly messages: readonly ValidationMessage[];
};

export const epubValidationError = (error: StoreError): EpubValidationErrorShape => ({
  __typename: 'EpubValidationError',
  message: error.message,
  messages: error.messages,
});

export const model = builder.objectRef<EpubValidationErrorShape>('EpubValidationError').implement({
  description: 'The EPUB failed validation at the configured threshold and was rejected.',
  interfaces: [userError],
  fields: (t) => ({
    messages: t.field({
      type: [epubValidationMessage],
      resolve: (error) => error.messages,
    }),
  }),
});
