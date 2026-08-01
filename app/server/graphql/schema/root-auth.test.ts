import {
  execute,
  getNamedType,
  isInputObjectType,
  isLeafType,
  isListType,
  isNonNullType,
  parse,
  type GraphQLField,
  type GraphQLInputType,
  type GraphQLObjectType,
} from 'graphql';

import { createChapterSpineMapLoader } from '../chapter-spine-map-loader';
import type { Context } from '../context';
import { createOwnerLoader } from '../owner';
import { createPendingFixLoader } from '../pending-fix-loader';
import { createProgressLoader } from '../progress-loader';
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
 * Fields are executed with the minimum GraphQL needs to reach the resolver —
 * a `{ __typename }` subselection when the return type is not a leaf, and a
 * placeholder value for any required argument — never more, so the check
 * stays independent of each field's actual return shape.
 *
 * Required *arguments* need real care, not just any placeholder: GraphQL
 * rejects a query missing a required argument during validation, before the
 * resolver (and so before the auth scope) ever runs, which would make a field
 * such as `user(id: ID!)` falsely read as "gated" for the wrong reason.
 * Relay's `ID`-typed args go a step further — decoding the global ID string
 * happens in RelayPlugin's own resolve wrapper, which (per builder.ts's
 * plugin-order comment) sits OUTSIDE ScopeAuthPlugin's wrapper, so even a
 * syntactically-arbitrary string such as `"placeholder"` throws
 * "Invalid global ID" before the auth scope runs. `harness.aliceGlobalId` is a
 * real encoded global ID, so `ID` args use that instead.
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

  // Produces a syntactically valid GraphQL literal for a required argument's
  // type, so a field like `user(id: ID!)` can still be probed without
  // omitting the argument entirely (see the describe-block doc comment for
  // why that matters, and for why `ID` needs a real global ID rather than an
  // arbitrary string). Only covers the scalar/list shapes root fields
  // actually use today — throws rather than guessing for anything else, so a
  // future required arg of an unhandled kind fails loudly instead of being
  // silently skipped by this guard.
  const placeholderLiteral = (type: GraphQLInputType, aliceGlobalId: string): string => {
    if (isNonNullType(type)) return placeholderLiteral(type.ofType, aliceGlobalId);
    if (isListType(type)) return `[${placeholderLiteral(type.ofType, aliceGlobalId)}]`;
    // Mutations take a single `input:` object argument, so probing them means
    // building an object literal, recursively, from the input type's own
    // required fields — omitting one is a validation error before the resolver
    // (and so before the auth scope) runs, exactly as an omitted argument
    // would be. Optional fields are left out: fewer values is fewer ways for
    // this guard to fail for a reason other than the one it tests.
    if (isInputObjectType(type)) {
      const fields = Object.values(type.getFields()).filter((field) => isNonNullType(field.type));
      return `{ ${fields
        .map((field) => `${field.name}: ${placeholderLiteral(field.type, aliceGlobalId)}`)
        .join(', ')} }`;
    }
    switch (type.name) {
      case 'ID':
        return JSON.stringify(aliceGlobalId);
      case 'String':
        return '"placeholder"';
      case 'Int':
      case 'Float':
        return '0';
      case 'Boolean':
        return 'false';
      default:
        throw new Error(
          `root-auth.test.ts's placeholderLiteral has no literal for input type "${type.name}" — add one so this structural guard can still probe fields that take it.`
        );
    }
  };

  const selectionFor = (field: GraphQLField<unknown, unknown>, aliceGlobalId: string): string => {
    const requiredArgs = field.args.filter((arg) => isNonNullType(arg.type));
    const args = requiredArgs.length
      ? `(${requiredArgs.map((arg) => `${arg.name}: ${placeholderLiteral(arg.type, aliceGlobalId)}`).join(', ')})`
      : '';
    // `node`/`nodes` return the `Node` interface, which — like any composite
    // type — is invalid GraphQL without a subselection.
    const subselection = isLeafType(getNamedType(field.type)) ? '' : ' { __typename }';
    return `${field.name}${args}${subselection}`;
  };

  it.each(
    roots.flatMap(([operation, type]) =>
      Object.values(type.getFields()).map((field) => ({ operation, name: field.name, field }))
    )
  )('refuses $operation.$name for a null viewer', async ({ operation, field }) => {
    const context: Context = {
      viewer: null,
      prisma: harness.prisma,
      stores: harness.stores,
      config: harness.config,
      loadOwner: createOwnerLoader(harness.prisma),
      loadProgress: createProgressLoader(harness.prisma),
      loadPendingFix: createPendingFixLoader(harness.prisma),
      loadChapterSpineMap: createChapterSpineMapLoader(harness.prisma),
    };

    const result = await execute({
      schema,
      document: parse(`${operation} { ${selectionFor(field, harness.aliceGlobalId)} }`),
      contextValue: context,
    });

    expect(result.errors?.[0]?.extensions?.code).toBe('UNAUTHENTICATED');
  });
});
