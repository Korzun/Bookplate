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
builder.prismaObjectField(book.model, 'pendingFix', (t) =>
  t.relation('pendingFix', { nullable: true })
);
