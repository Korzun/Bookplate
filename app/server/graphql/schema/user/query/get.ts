import { builder } from '../../builder';
import { model } from '../index';

builder.queryField('user', (t) =>
  t.prismaField({
    type: model,
    nullable: true,
    authScopes: { admin: true },
    args: { id: t.arg.globalID({ required: true }) },
    resolve: (query, _parent, args, context) =>
      context.prisma.user.findUnique({ ...query, where: { id: String(args.id.id) } }),
  })
);
