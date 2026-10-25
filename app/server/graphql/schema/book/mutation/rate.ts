import { z } from 'zod';

import { RATING_COLUMNS, RATING_FIELDS } from '../../../../services/rating';
import type { Owner } from '../../../../types';
import { builder } from '../../builder';
import {
  invalidInputError,
  model as invalidInputErrorModel,
} from '../../invalid-input-error/model';
import { parseCompoundId } from '../../node-scope';
import { model as book } from '../model';

/**
 * The `Book` global ID IS the owner/book pair (see `bookClearEditions`'s
 * input). Each rating is nullable and optional: omitted leaves the column
 * alone, an explicit `null` clears it.
 */
const input = builder.inputType('BookRateInput', {
  fields: (t) => ({
    id: t.globalID({ required: true, for: book }),
    overall: t.int({ required: false }),
    story: t.int({ required: false }),
    characters: t.int({ required: false }),
    writing: t.int({ required: false }),
    ideas: t.int({ required: false }),
  }),
});

/**
 * Values are integers 1 to 5. `.nullable().optional()` keeps `undefined`
 * (omitted: unchanged) distinct from `null` (clear). GraphQL's `Int` already
 * rejects non-integers; the range is this schema's backstop.
 */
const value = z.number().int().min(1, 'Must be 1–5').max(5, 'Must be 1–5');
const inputSchema = z.object(
  Object.fromEntries(RATING_FIELDS.map((field) => [field, value.nullable().optional()]))
);

type BookRatePayloadShape = {
  readonly __typename: 'BookRatePayload';
  readonly owner: Owner;
  readonly bookId: string;
};

/**
 * `book` is a fresh lookup, not a service-returned DTO — same reasoning as
 * `BookClearEditionsPayload.book`. Rating never changes the book id.
 */
const payload = builder.objectRef<BookRatePayloadShape>('BookRatePayload').implement({
  fields: (t) => ({
    book: t.prismaField({
      type: book,
      resolve: (query, parent, _args, context) =>
        context.prisma.book.findUniqueOrThrow({
          ...query,
          where: { userId_id: { userId: parent.owner.userId, id: parent.bookId } },
        }),
    }),
  }),
});

/**
 * No `resolveType`: each member value carries its own `__typename`.
 */
const result = builder.unionType('BookRateResult', {
  types: [payload, invalidInputErrorModel],
});

/**
 * OWNER-ONLY, deliberately NOT `ownerOf` (owner-or-admin) like the other book
 * mutations. A rating is the reader's own opinion, like reading progress, so
 * this follows `progressSet` (`progress/mutation/set.ts`): the scope is a
 * boolean requiring the viewer to be the owner named by the book id. The
 * config admin's `viewer.userId` is null, so it can never pass; a malformed id
 * is refused too. See the ratings spec's anti-goals.
 *
 * Omitted versus null is distinguished (`undefined` vs `null`). An input with
 * no rating field at all performs no update and does not stamp `ratedAt`.
 * Every other successful call, including one that only clears, writes
 * `ratedAt` in the same `book.update` as the rating columns. Resolves to
 * `null` when the book does not exist for the owner.
 */
builder.mutationField('bookRate', (t) =>
  t.field({
    type: result,
    nullable: true,
    description:
      'Sets any of a book’s five ratings. An omitted field is left as it is; an explicit ' +
      'null clears it. Values are integers 1 (bad) to 5 (awesome). Never rewrites the ' +
      'EPUB, never changes the id, and is not gated on validation. Resolves to null when ' +
      'the book does not exist for the resolved owner.',
    args: { input: t.arg({ type: input, required: true }) },
    authScopes: (_parent, args, context) => {
      const parsedId = parseCompoundId(args.input.id.id);
      return parsedId !== null && context.viewer !== null && context.viewer.userId === parsedId[0];
    },
    resolve: async (_parent, args, context) => {
      const parsed = inputSchema.safeParse({
        overall: args.input.overall,
        story: args.input.story,
        characters: args.input.characters,
        writing: args.input.writing,
        ideas: args.input.ideas,
      });
      if (!parsed.success) return invalidInputError(parsed.error);

      const id = parseCompoundId(args.input.id.id);
      if (id === null) return null;
      const [userId, bookId] = id;
      const owner = await context.loadOwner(userId);
      if (owner === null) return null;

      const row = await context.prisma.book.findUnique({
        where: { userId_id: { userId, id: bookId } },
        select: { id: true },
      });
      if (row === null) return null;

      const data: Record<string, number | null> = {};
      for (const field of RATING_FIELDS) {
        const next = parsed.data[field];
        if (next !== undefined) data[RATING_COLUMNS[field]] = next;
      }
      if (Object.keys(data).length > 0) {
        await context.prisma.book.update({
          where: { userId_id: { userId, id: bookId } },
          data: { ...data, ratedAt: Date.now() },
        });
      }

      return { __typename: 'BookRatePayload' as const, owner, bookId };
    },
  })
);
