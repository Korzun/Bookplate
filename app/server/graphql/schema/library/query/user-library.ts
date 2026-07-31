import { builder } from '../../builder';
import { model as user } from '../../user';
import { model as library } from '../index';

builder.objectField(user, 'library', (t) =>
  t.field({
    type: library,
    authScopes: (parent) => ({ ownerOf: parent.id }),
    resolve: (parent) => ({ userId: parent.id, username: parent.username }),
  })
);
