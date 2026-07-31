import { builder } from '../../builder';
import { model as library } from '../../library';
import { model } from '../index';

builder.objectField(library, 'book', (t) =>
  t.prismaField({
    type: model,
    nullable: true,
    args: { id: t.arg.string({ required: true }) },
    resolve: (query, owner, args, context) =>
      context.prisma.book.findUnique({
        ...query,
        where: { userId_id: { userId: owner.userId, id: args.id } },
      }),
  })
);
