import type { ValidationThreshold } from '@korzun/epubcheck-ts';
import { encodeGlobalID } from '@pothos/plugin-relay';

import { epochToDate } from '../../derive';
import { builder } from '../builder';
import { CONNECTION_LIMITS, rejectOversizePage } from '../pagination';
import { model as validationSeverityCount } from '../validation-severity-count';
import { model as validationThreshold } from '../validation-threshold';

/**
 * Deliberately a prismaObject, not a prismaNode. A Validation is only ever
 * reached through its Book, so giving it a global ID would add a second,
 * separately-guarded door to tenant-owned data for no client benefit —
 * Houdini normalizes it under its parent.
 */
export const model = builder.prismaObject('Validation', {
  fields: (t) => ({
    /**
     * Byte-identical to the owning `Book`'s global id — same construction
     * `BookDeletePayload.deletedId` uses (`book/mutation/delete.ts`) and
     * `PendingFix.id`'s identical field (`pending-fix/model.ts`) — a
     * `Validation` is 1:1 with its book (`@@id([userId, bookId])`), so
     * reusing the book's own id lets a normalizing cache place
     * `bookValidate`'s payload without a second, separately-guarded identity.
     *
     * `validation.userId`/`.bookId` read straight off this row, never off
     * `context.viewer` — see `PendingFix.id`'s doc comment for why that
     * matters under admin traversal.
     */
    id: t.field({
      type: 'ID',
      resolve: (validation) =>
        encodeGlobalID('Book', JSON.stringify([validation.userId, validation.bookId])),
    }),
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
     * Per-severity message tallies. Resolved through
     * `context.loadValidationCounts` (`validation-counts-loader.ts`), a
     * request-scoped batching loader — NOT a per-parent COUNT, which would be
     * an N+1 across a page of up to 100 books (`Library.entries`,
     * `CONNECTION_LIMITS.libraryEntries.maxSize`). Same precedent as
     * `Series.progressPercentage`.
     *
     * Exists because `messages` is a connection capped at 100: a client tally
     * is wrong-by-construction for any book with more than 100 messages, and
     * costs extra round trips and query budget besides. `ValidationDetailModal`
     * has rendered this summary since long before GraphQL.
     *
     * `validation.userId`/`.bookId` read straight off this row, never off
     * `context.viewer` — see `id`'s doc comment above for why that matters
     * under admin traversal.
     */
    counts: t.field({
      type: [validationSeverityCount],
      resolve: (validation, _args, context) =>
        context.loadValidationCounts(validation.userId, validation.bookId),
    }),
    /**
     * A connection — validation output for a broken EPUB is the one list in
     * this schema with realistic hundreds-of-rows growth (cleanup spec,
     * §"5. Connections for growable lists"). Same backward-pagination
     * asymmetry as `Series.books`: unlike `Library.entries`/`Library.progress`
     * (forward-only service cursor, so they do not offer `last`/`before` at all
     * — see the `entriesConnection` doc comment in `library/model.ts`),
     * `t.relatedConnection` wraps a genuine Prisma relation, so
     * `last`/`before` genuinely work here.
     *
     * `maxSize`/`defaultSize` are 100/20 — NOT raised to accommodate the
     * "hundreds of rows" case above; a client reading hundreds of messages
     * pages through them 100 at a time instead. (Corrected after review,
     * I-1: this shipped as 500/50 initially, an undetected 5x/2.5x widening
     * of `@pothos/plugin-prisma`'s own pre-existing 100/20 default for an
     * unconfigured `t.relatedConnection` — see `CONNECTION_LIMITS`'s doc
     * comment in `pagination.ts` for the measured amplification and the
     * full correction.)
     */
    messages: t.relatedConnection('messages', {
      cursor: 'userId_bookId_seq',
      // Same mechanism split as `Series.books` (`series/model.ts`'s doc
      // comment on its own `books` field has the full reasoning + the
      // empirical proof): native `maxSize`/`defaultSize` bound the actual
      // Prisma query as defense-in-depth (clamps, doesn't reject); the
      // reject that satisfies "reject, never clamp" has to live in `query`,
      // the one hook `@pothos/plugin-prisma` always calls before this
      // connection's rows are fetched, on every path — a `resolve` override
      // here would be fallback-only and silently never fire for the normal
      // `book.validation.messages` read path.
      maxSize: CONNECTION_LIMITS.validationMessages.maxSize,
      defaultSize: CONNECTION_LIMITS.validationMessages.defaultSize,
      query: (args) => {
        rejectOversizePage(
          'Validation.messages',
          args,
          CONNECTION_LIMITS.validationMessages.maxSize
        );
        return { orderBy: { seq: 'asc' } };
      },
    }),
  }),
});
