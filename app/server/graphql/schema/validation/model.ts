import { epochToDate } from '../../derive';
import * as book from '../book';
import { builder } from '../builder';

/**
 * Deliberately a prismaObject, not a prismaNode. A Validation is only ever
 * reached through its Book, so giving it a global ID would add a second,
 * separately-guarded door to tenant-owned data for no client benefit —
 * Houdini normalizes it under its parent.
 */
export const model = builder.prismaObject('Validation', {
  fields: (t) => ({
    valid: t.exposeBoolean('valid'),
    threshold: t.exposeString('threshold'),
    validatedAt: t.field({
      type: 'DateTime',
      resolve: (validation) => epochToDate(validation.validatedAt),
    }),
    messages: t.relation('messages', { query: { orderBy: { seq: 'asc' } } }),
  }),
});

// `t.relation` is only available through `prismaObjectField`/the `fields`
// callback of `prismaNode` itself, not through the plugin-agnostic
// `builder.objectField` — see `series/model.ts` for the same note.
builder.prismaObjectField(book.model, 'validation', (t) =>
  t.relation('validation', { nullable: true })
);
