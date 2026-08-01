import { epochToDate } from '../../derive';
import * as book from '../book';
import { builder } from '../builder';

/**
 * Deliberately a prismaObject, not a prismaNode, following `Validation`'s and
 * `Progress`'s precedent: `PendingFix` is only ever reached through a `Book`
 * that is already owner-scoped, so a global ID would add a second,
 * separately-guarded door onto tenant-owned data for no client benefit.
 *
 * `state` is exposed raw — the JSON string exactly as stored — rather than
 * decomposed into a typed shape. `MetadataFix.changes` (see `types.ts`) is an
 * open `Record<string, string | string[]>` with no natural GraphQL
 * representation, and this schema registers no JSON scalar; building a full
 * object graph for `MetadataFix`/`UndoSnapshot` just to carry that map would
 * be scope this task's brief never asked for. A client `JSON.parse`s `state`
 * into exactly the shape the REST client already types as `PendingFixState`
 * (`app/client/src/provider/upload/api.ts`) — the same shape `upsertPendingFix`
 * writes and `getPendingFixes` parses back out (see `book-store.ts`), so this
 * reading and REST's never disagree about what the string means, only about
 * whether it has been decoded yet.
 */
export const model = builder.prismaObject('PendingFix', {
  fields: (t) => ({
    fileName: t.exposeString('fileName'),
    fileSize: t.exposeInt('fileSize'),
    state: t.exposeString('state'),
    createdAt: t.field({
      type: 'DateTime',
      resolve: (pendingFix) => epochToDate(pendingFix.createdAt),
    }),
    updatedAt: t.field({
      type: 'DateTime',
      resolve: (pendingFix) => epochToDate(pendingFix.updatedAt),
    }),
  }),
});

// `t.relation` is only available through `prismaObjectField`/the `fields`
// callback of `prismaNode` itself, not through the plugin-agnostic
// `builder.objectField` — see `series/model.ts`/`validation/model.ts` for the
// same note.
//
// Deliberately a bare relation, with none of `getPendingFixes`'s
// resolved/TTL cleanup applied (see `query/get-all.ts` and `book-store.ts`'s
// `getPendingFixes`, which deletes a row once its proposals are empty, or
// once an undo-only row is older than `PENDING_FIX_TTL_MS`). That cleanup is
// a *side effect of reading the list*, not a property of the row itself, so
// `Book.pendingFix` and `Library.pendingFixes`/REST's pending-fixes list can
// disagree for a stale row: a fix applied 7+ days ago with no proposals left
// is dropped (and deleted) the next time the list is read, but `Book.pendingFix`
// keeps returning it until something reads the list. This is accepted, not
// fixed here — replicating a read-triggered deletion inside a field resolver
// would be worse behaviour than the inconsistency it removes, and duplicating
// the expiry predicate in a second place trades a visible drift for an
// invisible one (two copies that can silently diverge later). The visible
// effect is narrow: a stale badge on one book until the list is next read.
builder.prismaObjectField(book.model, 'pendingFix', (t) =>
  t.relation('pendingFix', { nullable: true })
);
