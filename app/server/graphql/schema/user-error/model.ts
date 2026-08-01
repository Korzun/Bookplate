import { builder } from '../builder';

/**
 * The base shape every typed mutation failure carries.
 *
 * `__typename` is part of the *value*, not just the schema. graphql-js's
 * `defaultTypeResolver` — which both this interface and every mutation result
 * union fall back to, since neither declares a `resolveType` — reads
 * `value.__typename` first (graphql/execution/execute.js). Putting the type
 * name on the value therefore makes every result union resolve for free, with
 * no per-union `resolveType` to write and no `isTypeOf` to keep in sync as
 * tasks 2-10 add nine more mutations. Each concrete shape narrows it to its
 * own literal, so TypeScript rejects a value tagged with the wrong type name.
 *
 * `message` is deliberately the only field: a client can always render it, and
 * only special-cases the error types it actually acts on (spec, §"Error
 * model"). Pothos copies interface fields onto every implementing object type
 * automatically (`build-cache.js`'s `getObjectFields` merges them), so no
 * error type restates `message`.
 */
export type UserErrorShape = {
  readonly __typename: string;
  readonly message: string;
};

export const model = builder.interfaceRef<UserErrorShape>('UserError').implement({
  description:
    'A failure a client is expected to render and act on, as opposed to an ' +
    'unexpected server fault, which arrives in the response `errors` array.',
  fields: (t) => ({
    message: t.exposeString('message'),
  }),
});
