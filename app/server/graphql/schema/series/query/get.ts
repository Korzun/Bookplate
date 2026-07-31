import { builder } from '../../builder';
import { model as library } from '../../library';
import { model } from '../index';

builder.objectField(library, 'seriesByName', (t) =>
  t.prismaField({
    type: model,
    nullable: true,
    args: { name: t.arg.string({ required: true }) },
    resolve: (query, owner, args, context) =>
      context.prisma.series.findUnique({
        ...query,
        where: { userId_name: { userId: owner.userId, name: args.name } },
      }),
  })
);
