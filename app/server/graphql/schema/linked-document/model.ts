import { epochToDate } from '../../derive';
import { builder } from '../builder';
import { model as lineageType } from '../lineage-type';

type LineageTypeValue = 'edit' | 'merge';

/**
 * One id transition a book has been through — either an organic re-import
 * (`type: 'edit'`, written by `reimportBook` when re-parsing an edited EPUB
 * changes its content hash) or a manual KOReader document merge (`type:
 * 'merge'`, written by `linkDocument`). Mirrors one entry of REST's `GET
 * /api/books/:id/lineage` response (`routes/ui.ts`), minus the `currentId`
 * that response also carries at the top level — every entry's `newId` chains
 * to the next, and the last one's `newId` is the book's own (current) id, so
 * nothing here is lost by dropping it.
 */
export const model = builder
  .objectRef<{ oldId: string; newId: string; timestamp: number; type: string }>('LinkedDocument')
  .implement({
    fields: (t) => ({
      oldId: t.exposeString('oldId'),
      newId: t.exposeString('newId'),
      type: t.field({
        type: lineageType,
        resolve: (entry) => entry.type as LineageTypeValue,
      }),
      timestamp: t.field({ type: 'DateTime', resolve: (entry) => epochToDate(entry.timestamp) }),
    }),
  });
