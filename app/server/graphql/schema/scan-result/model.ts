import type { Owner } from '../../../types';
// `../book/model`, not `../book` — same import-cycle rule every other file
// under an entity directory follows (see `book-hash-collision-error/model.ts`'s
// identical note): `book/index.ts` also side-effect-imports `book/mutation/*`,
// so importing the index rather than the defining module risks dragging that
// registration graph in for no reason.
import { model as book } from '../book/model';
import { builder } from '../builder';

/**
 * `scan()`'s (`services/book-lifecycle.ts`) own return shape
 * (`services/scan-events.ts`'s `ScanResult`) only ever carries
 * filenames/ids-as-strings — never real `Book`s. `imported: [Book!]!` (the
 * SDL the spec's own snippet declares, §"Scan progress") needs an owner and a
 * set of ids to look them up by, so this shape carries both instead of
 * `ScanResult`'s raw `{ imported, removed }` pair directly. `importedBookIds`
 * comes from `ScanJob.importedBookIds` (`scan-events.ts`'s `reduceScanJob`,
 * accumulated from `'imported'`-outcome progress events, NOT from
 * `ScanResult.imported`, which holds filenames — see that type's doc comment
 * for why a filename can't back this lookup once a rename may have
 * happened).
 */
export type ScanResultShape = {
  readonly owner: Owner;
  readonly importedBookIds: string[];
  readonly importedFilenames: string[];
  readonly removed: string[];
};

export const model = builder.objectRef<ScanResultShape>('ScanResult').implement({
  description: 'The outcome of a completed scan.',
  fields: (t) => ({
    imported: t.prismaField({
      type: [book],
      description: 'The books newly added to the library by this scan.',
      // `orderBy: addedAt` — deterministic (task 8 review, M-4): `findMany`
      // with an `id: { in: [...] }` filter has no defined order on its own,
      // and `addedAt` is set once, at insert time, so books sort in the
      // order this scan actually imported them.
      resolve: (query, parent, _args, context) =>
        parent.importedBookIds.length === 0
          ? []
          : context.prisma.book.findMany({
              ...query,
              where: { userId: parent.owner.userId, id: { in: parent.importedBookIds } },
              orderBy: { addedAt: 'asc' },
            }),
    }),
    importedFilenames: t.field({
      type: ['String'],
      description:
        'The filenames this scan imported, as they were named on disk ' +
        'before the scan renamed each one to its canonical `<id>.epub` ' +
        'form. A name here may therefore no longer exist on disk, which is ' +
        "why this list is not necessarily 1:1 with `imported`'s ids.",
      resolve: (parent) => parent.importedFilenames,
    }),
    removed: t.field({
      type: ['String'],
      description: 'The `<id>.epub` names of DB rows pruned because their file was missing.',
      resolve: (parent) => parent.removed,
    }),
  }),
});
