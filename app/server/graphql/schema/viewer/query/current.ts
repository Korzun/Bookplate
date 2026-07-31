import { requireViewer } from '../../../context';
import { builder } from '../../builder';
import { model } from '../index';

builder.queryField('viewer', (t) =>
  t.field({
    type: model,
    resolve: (_parent, _args, context) => requireViewer(context),
  })
);
