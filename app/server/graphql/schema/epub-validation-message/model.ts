import type { Severity, ValidationMessage } from '../../../services/epub-validator';
import { builder } from '../builder';
import { model as validationSeverity } from '../validation-severity';

/**
 * One epubcheck finding as `EpubValidationError` carries it — NOT the stored
 * `ValidationMessage` row, and deliberately a second type rather than a reuse
 * of the Prisma-backed one.
 *
 * The two shapes genuinely differ. The domain error holds
 * `services/epub-validator.ts`'s `ValidationMessage`
 * (`{ id, severity, message, segments?, location?: { path, line?, column? } }`),
 * while the Prisma `ValidationMessage` row — and so the GraphQL type built on
 * it — holds `{ userId, bookId, seq, code, severity, message, path, line,
 * column }`. There is no `seq` on an in-flight validation failure (nothing has
 * been persisted, so nothing has been ordered), the id is called `id` on one
 * side and `code` on the other, and the location is nested on one and flat on
 * the other. Backing the Prisma-typed object with these values would mean
 * fabricating a `seq` and a `bookId` for rows that do not exist, which is why
 * the spec's `messages: [ValidationMessage!]!` is implemented here as
 * `[EpubValidationMessage!]!` instead.
 *
 * Field-for-field it is `ValidationMessage` minus `seq`: `code` carries the
 * domain error's `id` (epubcheck's message code, e.g. `RSC-005`, the same value the
 * `code` column stores) and the location is flattened to match. `segments` is
 * not exposed: it is a presentation split of `message` that the client can
 * recompute, and no client renders a *rejected* upload's messages that way.
 */
export const model = builder.objectRef<ValidationMessage>('EpubValidationMessage').implement({
  description:
    'An epubcheck finding from a validation that rejected the file, so no ' +
    'stored ValidationMessage row exists for it.',
  fields: (t) => ({
    code: t.exposeString('id'),
    severity: t.field({
      type: validationSeverity,
      resolve: (message): Severity => message.severity,
    }),
    message: t.exposeString('message'),
    path: t.string({ nullable: true, resolve: (message) => message.location?.path ?? null }),
    line: t.int({ nullable: true, resolve: (message) => message.location?.line ?? null }),
    column: t.int({ nullable: true, resolve: (message) => message.location?.column ?? null }),
  }),
});
