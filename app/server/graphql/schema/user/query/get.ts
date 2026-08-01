import { builder } from '../../builder';
import { model } from '../index';

builder.queryField('user', (t) =>
  t.prismaField({
    type: model,
    nullable: true,
    authScopes: { admin: true },
    // `for: model` makes the relay plugin check the *type* baked into the
    // global ID before the resolver runs. Without it `t.arg.globalID` accepts
    // any type's global ID and simply hands over its local half — so
    // `user(id: <a Book global ID>)` would look up a book's content hash in
    // the users table and resolve to null, indistinguishable from "no such
    // user". With it, the wrong type is a coercion error naming the type it
    // expected.
    args: { id: t.arg.globalID({ required: true, for: model }) },
    resolve: (query, _parent, args, context) =>
      context.prisma.user.findUnique({ ...query, where: { id: String(args.id.id) } }),
  })
);
