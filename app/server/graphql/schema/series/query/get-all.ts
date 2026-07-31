import { builder } from '../../builder';
import { model as library } from '../../library';
import { model } from '../index';

builder.objectField(library, 'series', (t) =>
  t.prismaField({
    type: [model],
    resolve: (query, owner, _args, context) =>
      context.prisma.series.findMany({
        ...query,
        where: { userId: owner.userId },
        orderBy: { sortKey: 'asc' },
      }),
  })
);
