import { builder } from '../../builder';
import { model as library } from '../../library';

builder.objectField(library, 'seriesNextIndex', (t) =>
  t.float({
    args: { name: t.arg.string({ required: true }) },
    resolve: (owner, args, context) => context.stores.book.getSeriesNextIndex(owner, args.name),
  })
);
