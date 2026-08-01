import type { MetadataFix } from '../../../types';
import { builder } from '../builder';

/**
 * Mirrors `MetadataFix` in `types.ts` field for field. `changes` is a
 * genuinely heterogeneous per-field patch payload
 * (`Record<string, string | string[]>`) with no natural GraphQL
 * representation short of a union that would fight codegen — see the
 * cleanup spec, §"2. Typed PendingFixState" — so it stays a `JSON` scalar
 * leaf; everything around it is typed.
 */
export const model = builder.objectRef<MetadataFix>('MetadataFix').implement({
  fields: (t) => ({
    field: t.exposeString('field'),
    kind: t.exposeString('kind'),
    from: t.exposeString('from'),
    to: t.exposeString('to', { nullable: true }),
    reason: t.exposeString('reason', { nullable: true }),
    fromChips: t.field({
      type: ['String'],
      nullable: true,
      resolve: (fix) => fix.fromChips ?? null,
    }),
    toChips: t.field({
      type: ['String'],
      nullable: true,
      resolve: (fix) => fix.toChips ?? null,
    }),
    changes: t.field({ type: 'JSON', resolve: (fix) => fix.changes }),
  }),
});
