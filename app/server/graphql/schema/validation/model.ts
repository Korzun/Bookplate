import type { ValidationThreshold } from '@korzun/epubcheck-ts';

import { epochToDate } from '../../derive';
import { builder } from '../builder';
import { model as validationThreshold } from '../validation-threshold';

/**
 * Deliberately a prismaObject, not a prismaNode. A Validation is only ever
 * reached through its Book, so giving it a global ID would add a second,
 * separately-guarded door to tenant-owned data for no client benefit —
 * Houdini normalizes it under its parent.
 */
export const model = builder.prismaObject('Validation', {
  fields: (t) => ({
    valid: t.exposeBoolean('valid'),
    threshold: t.field({
      type: validationThreshold,
      resolve: (validation) => validation.threshold as ValidationThreshold,
    }),
    validatedAt: t.field({
      type: 'DateTime',
      resolve: (validation) => epochToDate(validation.validatedAt),
    }),
    /**
     * A connection — validation output for a broken EPUB is the one list in
     * this schema with realistic hundreds-of-rows growth (cleanup spec,
     * §"5. Connections for growable lists"). Same backward-pagination
     * asymmetry as `Series.books`: unlike `Library.entries`/`Library.progress`
     * (forward-only store cursor, see `rejectBackwardPagination`'s doc
     * comment in `pagination.ts`), `t.relatedConnection` wraps a genuine
     * Prisma relation, so `last`/`before` genuinely work here.
     */
    messages: t.relatedConnection('messages', {
      cursor: 'userId_bookId_seq',
      query: { orderBy: { seq: 'asc' } },
    }),
  }),
});
