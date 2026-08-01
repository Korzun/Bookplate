import type { Severity } from '@korzun/epubcheck-ts';

import { builder } from '../builder';
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
  }),
});
