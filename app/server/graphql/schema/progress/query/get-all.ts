import { builder } from '../../builder';
import { model as library } from '../../library';
import { model } from '../index';

builder.objectField(library, 'progress', (t) =>
  t.prismaField({
    type: [model],
    resolve: (query, owner, _args, context) =>
      context.prisma.progress.findMany({
        ...query,
        where: { userId: owner.userId },
        orderBy: { timestamp: 'desc' },
      }),
  })
);
