import { builder } from '../../builder';
import { model as library } from '../../library';
import { model as summary } from '../../pending-fix-summary';

builder.objectField(library, 'pendingFixes', (t) =>
  t.field({
    type: [summary],
    resolve: async (owner, _args, context) => {
      const fixes = await context.stores.book.getPendingFixes(owner);
      // New objects, never a mutation of the store's rows.
      return fixes.map((fix) => ({ ...fix, userId: owner.userId }));
    },
  })
);
