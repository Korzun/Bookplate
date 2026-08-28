import type { Severity } from '@korzun/epubcheck-ts';

import { splitSubjects } from '../../../services/epub-validator';
import { builder } from '../builder';
import { model as messageSegment } from '../message-segment';
import { model as validationSeverity } from '../validation-severity';

export const model = builder.prismaObject('ValidationMessage', {
  fields: (t) => ({
    seq: t.exposeInt('seq'),
    code: t.exposeString('code'),
    severity: t.field({
      type: validationSeverity,
      resolve: (message) => message.severity as Severity,
    }),
    message: t.exposeString('message'),
    path: t.exposeString('path', { nullable: true }),
    line: t.exposeInt('line', { nullable: true }),
    column: t.exposeInt('column', { nullable: true }),
    // Rebuilt from `message` via `splitSubjects` on every read, the same
    // function `epub-validator.ts` uses when it first produces a report —
    // not a duplicate parse.
    // Not persisted: the `validationMessage` row stores only the raw
    // `message` string, so this is always derived, never stale relative to
    // it. `subject: s.subject === true` normalizes `splitSubjects`'s
    // sometimes-unset `subject` into an explicit boolean — see
    // `message-segment/model.ts`'s doc comment for why that makes `Boolean!`
    // safe on `MessageSegment.subject`.
    segments: t.field({
      type: [messageSegment],
      resolve: (message) =>
        splitSubjects(message.message).map((s) => ({
          text: s.text,
          subject: s.subject === true,
        })),
    }),
  }),
});
