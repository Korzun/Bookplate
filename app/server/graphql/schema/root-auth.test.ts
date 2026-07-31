import { execute, parse, type GraphQLObjectType } from 'graphql';

import type { Context } from '../context';
import { createHarness, type Harness } from '../test-util';
import { schema } from './index';

vi.mock('../../logger');

let harness: Harness;

beforeEach(async () => {
  harness = await createHarness();
});

afterEach(async () => {
  await harness.cleanup();
});

/**
 * Structural guard for the plan's "every field gated, no exceptions" rule.
 *
 * Today that rule is upheld by a single `builder.queryType({ authScopes })`
 * call, because `Query` is the only root type that exists. Pothos auto-creates
 * `Mutation` and `Subscription` on first use *without options*, so a mutation
 * added later without its own `builder.mutationType({ authScopes: ... })` would
 * simply be unauthenticated. This walks whatever root types the built schema
 * actually has and fails the moment one gains an ungated field — which a
 * comment could not do.
 *
 * Fields are executed without validation and without a selection set on
 * purpose: it makes the check independent of each field's arguments and return
 * type, and the auth scope runs before any of that matters.
 */
describe('root type authorization', () => {
  const roots: [string, GraphQLObjectType][] = (
    [
      ['query', schema.getQueryType()],
      ['mutation', schema.getMutationType()],
      ['subscription', schema.getSubscriptionType()],
    ] as const
  ).flatMap(([operation, type]) =>
    type ? [[operation, type] as [string, GraphQLObjectType]] : []
  );

  it('has at least one root type to check', () => {
    expect(roots.length).toBeGreaterThan(0);
  });

  it.each(
    roots.flatMap(([operation, type]) =>
      Object.keys(type.getFields()).map((field) => ({ operation, field }))
    )
  )('refuses $operation.$field for a null viewer', async ({ operation, field }) => {
    const context: Context = {
      viewer: null,
      prisma: harness.prisma,
      stores: harness.stores,
      config: harness.config,
    };

    const result = await execute({
      schema,
      document: parse(`${operation} { ${field} }`),
      contextValue: context,
    });

    expect(result.errors?.[0]?.extensions?.code).toBe('UNAUTHENTICATED');
  });
});
