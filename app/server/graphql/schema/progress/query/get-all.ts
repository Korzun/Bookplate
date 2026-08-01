import {
  clampProgressTake,
  decodeProgressCursor,
  encodeProgressCursor,
} from '../../../../utils/progress-pagination';
import { builder } from '../../builder';
import { model as library } from '../../library';
import { rejectBackwardPagination } from '../../pagination';
import { model } from '../index';

/**
 * A connection, not the plain list this started as.
 *
 * WHY PAGINATED: REST already is. `GET /api/my/progress` (`routes/ui.ts`) and
 * `GET /api/users/:username/progress` (`routes/users.ts`) both go through
 * `UserStore.getUserProgressPage` with a keyset cursor and a take clamped to
 * 1..100. A progress list grows with every book a user opens on any device and
 * is never pruned, so it is genuinely unbounded — an unpaginated field would
 * mean the capability REST has today vanishes when the REST routes are
 * deleted, and it would do so silently, by serving ever-larger responses
 * rather than by failing.
 *
 * WHY A CONNECTION RATHER THAN A CLAMP: a bare `first:` clamp caps the damage
 * but throws away the ability to read past the first page at all. The spec
 * exempts "series lists, subjects, authors, users, devices and validation
 * messages" from connections because they are small and unpaginated *today* —
 * progress is in neither category. `Library.entries` is the existing
 * connection precedent and this follows its shape exactly: delegate the
 * keyset to the store, pass the store's own `nextCursor` through untouched as
 * `endCursor`, and reject backward pagination loudly.
 *
 * CURSOR PARITY IS BY CONSTRUCTION, not by two formulas agreeing:
 * `decodeProgressCursor` is the very function REST's handlers call, and
 * `endCursor` is the string `getUserProgressPage` minted, forwarded
 * unmodified. Only the per-edge cursors are encoded here, through
 * `encodeProgressCursor`, which lives beside the decoder it must round-trip
 * with.
 *
 * TWO QUERIES, DELIBERATELY: the store returns its `Progress` DTO
 * (`device_id`, no `userId`), while this field's `Progress` type is a
 * `prismaObject` pinned to the real row — and `currentChapter` needs the
 * `userId` the DTO drops. So the store decides the window and the cursor, and
 * a second query fetches the rows it named. Same division of labour as
 * `Library.entries`, which asks `listBooksPage` for the page and then reads
 * the `Book`/`Series` rows itself.
 */
builder.objectField(library, 'progress', (t) =>
  t.connection({
    type: model,
    resolve: async (owner, args, context) => {
      rejectBackwardPagination('Library.progress', args);
      const cursor = decodeProgressCursor(args.after);
      // Same clamp and same default (50) REST applies via `parseProgressTake`,
      // now sharing that function's bounds rather than restating them.
      const take = clampProgressTake(args.first);

      const page = await context.stores.user.getUserProgressPage(owner.userId, cursor, take);
      const documents = page.items.map((item) => item.document);

      const rows =
        documents.length > 0
          ? await context.prisma.progress.findMany({
              where: { userId: owner.userId, document: { in: documents } },
            })
          : [];
      const byDocument = new Map(rows.map((row) => [row.document, row]));

      // `page.items` is already in the store's `timestamp desc, document asc`
      // order; this only re-associates rows with it, skipping any row that
      // vanished between the two reads rather than resolving `undefined`.
      const edges = page.items.flatMap((item) => {
        const row = byDocument.get(item.document);
        return row
          ? [
              {
                cursor: encodeProgressCursor({
                  timestamp: row.timestamp,
                  document: row.document,
                }),
                node: row,
              },
            ]
          : [];
      });

      return {
        edges,
        pageInfo: {
          hasNextPage: page.nextCursor !== null,
          // Forward-only pagination: having resumed from a cursor is exactly
          // what "there is content before this page" means here.
          hasPreviousPage: cursor !== null,
          startCursor: edges[0]?.cursor ?? null,
          // The store's own cursor, forwarded rather than recomputed.
          endCursor: page.nextCursor,
        },
      };
    },
  })
);
