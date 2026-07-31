import { builder } from '../../builder';
import { model as viewer } from '../../viewer';
import { model as library } from '../index';

builder.objectField(viewer, 'library', (t) =>
  t.field({
    type: library,
    nullable: true,
    // Null for the config-based admin, which has no user row and owns no library.
    resolve: (v, _args, context) => (v.userId === null ? null : context.loadOwner(v.userId)),
  })
);
