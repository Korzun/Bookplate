import type { PendingFixDto } from '../../../../services/book-store';
import { builder } from '../../builder';
import { model as library } from '../../library';

/**
 * `Library.pendingFixes` cannot reuse the `PendingFix` prismaObject from
 * `../model`: that type's `Shape` is pinned to the real `PendingFix` Prisma
 * row (`userId`, `state`, `createdAt`, `updatedAt` included), but
 * `context.stores.book.getPendingFixes` deliberately returns a different,
 * already-shaped DTO — the one both REST (`GET /api/books/pending-fixes`,
 * `routes/ui.ts`) and the client (`app/client/src/provider/upload/api.ts`'s
 * `PendingFixDto`) already agree on. Reusing the raw-row type here would mean
 * either lying to TypeScript about the resolver's return shape or
 * reimplementing `getPendingFixes`'s TTL/malformed-row cleanup with a direct
 * Prisma query — both worse than a second, small, DTO-shaped type.
 *
 * `state` is reconstructed here (rather than left off) so a client can
 * `JSON.parse` this `state` exactly like `PendingFix.state` (see
 * `../model.ts`) and land on the identical `PendingFixState` shape either
 * way — the two readings agree on content, they just can't share a
 * GraphQL type given the DTO's structural difference from the raw row.
 */
const summary = builder.objectRef<PendingFixDto>('PendingFixSummary').implement({
  fields: (t) => ({
    bookId: t.exposeString('bookId'),
    fileName: t.exposeString('fileName'),
    fileSize: t.exposeInt('fileSize'),
    state: t.string({
      resolve: (pendingFix) =>
        JSON.stringify({
          autoFixes: pendingFix.autoFixes,
          appliedFixes: pendingFix.appliedFixes,
          proposals: pendingFix.proposals,
          undo: pendingFix.undo,
        }),
    }),
  }),
});

builder.objectField(library, 'pendingFixes', (t) =>
  t.field({
    type: [summary],
    resolve: (owner, _args, context) => context.stores.book.getPendingFixes(owner),
  })
);
