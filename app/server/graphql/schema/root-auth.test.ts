import {
  execute,
  getNamedType,
  isEnumType,
  isInputObjectType,
  isLeafType,
  isListType,
  isNonNullType,
  parse,
  subscribe,
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
 * real encoded global ID, so `ID` args use that instead — EXCEPT that a
 * global ID also encodes a Node TYPE NAME (`"User:…"`, `"Library:…"`, …),
 * which Relay's decoder checks against the `for:` type the field declared
 * (`internalDecodeGlobalID`) — a schema-level `ID` scalar carries no trace of
 * that expected typename, so this generic walker cannot infer it from `type`
 * alone. Every `ID` arg before task 9 happened to want a `User` id
 * (`aliceGlobalId` alone was sufficient); `scanProgress(libraryId: ID!)`
 * wants a `Library` one instead, and got `"ID: User:… is not of type:
 * Library"` here until `ID_ARG_TYPE_NAMES` below was added — a real failure
 * this guard caught, not a hypothetical one.
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

  // Per-argument-name override for which Node type's global id an `ID` arg
  // wants — see the describe-block doc comment. Every top-level `ID` arg in
  // this schema takes a `User` id EXCEPT `scanProgress`'s `libraryId`; add a
  // name here (not a type-based lookup — the schema's own `ID` scalar carries
  // no typename) whenever a future field's arg needs a third kind.
  const ID_ARG_TYPE_NAMES: Record<string, 'User' | 'Library'> = {
    libraryId: 'Library',
  };

  // Produces a syntactically valid GraphQL literal for a required argument's
  // type, so a field like `user(id: ID!)` can still be probed without
  // omitting the argument entirely (see the describe-block doc comment for
  // why that matters, and for why `ID` needs a real global ID rather than an
  // arbitrary string). Only covers the scalar/list shapes root fields
  // actually use today — throws rather than guessing for anything else, so a
  // future required arg of an unhandled kind fails loudly instead of being
  // silently skipped by this guard.
  //
  // `argName` rides along purely to resolve an `ID` arg to the right
  // typename via `ID_ARG_TYPE_NAMES` (via `idFor`) — it plays no other part
  // in building the literal.
  const placeholderLiteral = (
    type: GraphQLInputType,
    argName: string,
    idFor: (name: string) => string
  ): string => {
    if (isNonNullType(type)) return placeholderLiteral(type.ofType, argName, idFor);
    if (isListType(type)) return `[${placeholderLiteral(type.ofType, argName, idFor)}]`;
    // Mutations take a single `input:` object argument, so probing them means
    // building an object literal, recursively, from the input type's own
    // required fields — omitting one is a validation error before the resolver
    // (and so before the auth scope) runs, exactly as an omitted argument
    // would be. Optional fields are left out: fewer values is fewer ways for
    // this guard to fail for a reason other than the one it tests.
    if (isInputObjectType(type)) {
      const fields = Object.values(type.getFields()).filter((field) => isNonNullType(field.type));
      return `{ ${fields
        .map((field) => `${field.name}: ${placeholderLiteral(field.type, field.name, idFor)}`)
        .join(', ')} }`;
    }
    // Enum literals are bare identifiers (unquoted, unlike String) — any
    // member works as a placeholder, so the first one declared is enough.
    if (isEnumType(type)) return type.getValues()[0].name;
    switch (type.name) {
      case 'ID':
        return JSON.stringify(idFor(argName));
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

  const selectionFor = (
    field: GraphQLField<unknown, unknown>,
    idFor: (name: string) => string
  ): string => {
    const requiredArgs = field.args.filter((arg) => isNonNullType(arg.type));
    const args = requiredArgs.length
      ? `(${requiredArgs.map((arg) => `${arg.name}: ${placeholderLiteral(arg.type, arg.name, idFor)}`).join(', ')})`
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

    // `seedNodeFor('Library')` inserts nothing (Library is 1:1 with the
    // already-created `User` row — see that function's own doc comment) and
    // just re-encodes alice's userId under the `Library` typename, so this is
    // as cheap as the plain `aliceGlobalId` it sits beside.
    const aliceLibraryGlobalId = await harness.seedNodeFor('Library');
    const idFor = (argName: string): string =>
      ID_ARG_TYPE_NAMES[argName] === 'Library' ? aliceLibraryGlobalId : harness.aliceGlobalId;

    const document = parse(`${operation} { ${selectionFor(field, idFor)} }`);

    // Subscription fields need `graphql`'s own `subscribe()`, not `execute()`
    // — verified by running this walk against `scanProgress` before adding
    // this branch, which failed (`expected undefined to be 'UNAUTHENTICATED'`):
    // `builder.ts` sets `scopeAuth.authorizeOnSubscribe: true` (required for
    // `Subscription.scanProgress`'s `ownerOf` check to run once, at
    // subscribe-time, rather than once per emitted event — see that field's
    // own doc comment), and `@pothos/plugin-scope-auth`'s `wrapResolve`
    // (`createResolveSteps`) deliberately SKIPS both the type- and
    // field-level scope steps whenever `authorizedOnSubscribe` is true — by
    // design, the check now lives entirely in `wrapSubscribe`. `execute()`
    // always calls a subscription field's `resolve`, never its `subscribe`
    // (graphql-js `execute.js`'s `executeOperation`, `SUBSCRIPTION` case is a
    // `// TODO: deprecate subscribe and move all logic here` stopgap that
    // still only runs `executeFields`/`resolve`), so it can never observe an
    // auth failure gated this way. `subscribe()` calls `createSourceEventStream`,
    // which DOES invoke the field's own `subscribe` — and per graphql-js's
    // own contract, a `GraphQLError` thrown from there (which is exactly what
    // `unauthorizedError` produces) comes back as a plain `{ errors: [...] }`
    // `ExecutionResult`, not an `AsyncIterable`, so this assertion still works
    // unchanged against `result.errors`.
    const result =
      operation === 'subscription'
        ? await subscribe({ schema, document, contextValue: context })
        : await execute({ schema, document, contextValue: context });

    const errors = 'errors' in result ? result.errors : undefined;
    expect(errors?.[0]?.extensions?.code).toBe('UNAUTHENTICATED');
  });
});
