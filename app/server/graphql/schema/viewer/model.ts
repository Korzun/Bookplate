import type { Viewer } from '../../context';
import { builder } from '../builder';

export const model = builder.objectRef<Viewer>('Viewer').implement({
  fields: (t) => ({
    username: t.exposeString('username'),
    isAdmin: t.exposeBoolean('isAdmin'),
    mustChangePassword: t.exposeBoolean('mustChangePassword'),
  }),
});
