import { builder } from '../builder';

export const model = builder.prismaObject('ValidationMessage', {
  fields: (t) => ({
    seq: t.exposeInt('seq'),
    code: t.exposeString('code'),
    severity: t.exposeString('severity'),
    message: t.exposeString('message'),
    path: t.exposeString('path', { nullable: true }),
    line: t.exposeInt('line', { nullable: true }),
    column: t.exposeInt('column', { nullable: true }),
  }),
});
