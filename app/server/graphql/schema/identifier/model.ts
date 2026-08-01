import { builder } from '../builder';

export const model = builder.objectRef<{ scheme: string; value: string }>('Identifier').implement({
  fields: (t) => ({
    scheme: t.exposeString('scheme'),
    value: t.exposeString('value'),
  }),
});
