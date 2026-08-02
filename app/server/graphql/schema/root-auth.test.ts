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
 *
 * Book-relay-id task 1 added a second wrinkle: `bookValidate`'s nested
 * `input.id` field ALSO wants a `Book` id under the argument name `id`,
 * which `Query.user(id: ID!)`'s top-level `id` argument already maps (by
 * default, with no `ID_ARG_TYPE_NAMES` entry) to a `User` id — the same bare
 * name `id` needs two different typenames depending on whether it is a
 * top-level argument or an input-object field. `INPUT_FIELD_ID_TYPE_NAMES`
 * below disambiguates by qualifying nested input fields with their
 * declaring input type's own name (`BookValidateInput.id`), which
 * `ID_ARG_TYPE_NAMES`'s flat argument-name keying cannot express.
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

  // Per-argument-name override for which Node type's global id a TOP-LEVEL
  // `ID` arg wants — see the describe-block doc comment. Every top-level `ID`
  // arg in this schema takes a `User` id EXCEPT `scanProgress`'s `libraryId`;
  // add a name here (not a type-based lookup — the schema's own `ID` scalar
  // carries no typename) whenever a future field's arg needs a third kind.
  const ID_ARG_TYPE_NAMES: Record<string, 'User' | 'Library'> = {
    libraryId: 'Library',
  };

  // Per-input-object-field override, keyed by `${InputTypeName}.${fieldName}`
  // rather than by bare field name: `id` alone is ambiguous once more than
  // one input object declares a required `id` field wanting a different Node
  // type (`BookValidateInput.id` wants `Book`; `ID_ARG_TYPE_NAMES`'s flat
  // argument-name keying — correct for top-level args, which this schema
  // never overloads with two different types — cannot express that
  // disambiguation). Add an entry here for every future book-mutation input's
  // `id` field this task's reshape pattern gets applied to.
  const INPUT_FIELD_ID_TYPE_NAMES: Record<string, 'Book'> = {
    'BookValidateInput.id': 'Book',
    'BookDeleteInput.id': 'Book',
    'BookRegenChaptersInput.id': 'Book',
    'BookClearEditionsInput.id': 'Book',
    'BookResolvePendingFixInput.id': 'Book',
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
  // `key` rides along purely to resolve an `ID` arg/field to the right
  // typename via `ID_ARG_TYPE_NAMES`/`INPUT_FIELD_ID_TYPE_NAMES` (via
  // `idFor`) — it plays no other part in building the literal. At the top
  // level it is the bare argument name (`ID_ARG_TYPE_NAMES`'s keying); once
  // recursion enters an input object's fields (below), it becomes
  // `${InputTypeName}.${fieldName}` (`INPUT_FIELD_ID_TYPE_NAMES`'s keying).
  // `idFor` looks the SAME `key` up in both maps (`INPUT_FIELD_ID_TYPE_NAMES
  // [key] ?? ID_ARG_TYPE_NAMES[key]`) — this is not a qualified-then-bare-name
  // fallback: a nested field's key is always the qualified form, so it can
  // only ever hit `INPUT_FIELD_ID_TYPE_NAMES` (whose keys are always
  // qualified) and never `ID_ARG_TYPE_NAMES` (whose keys are always bare).
  // It works today only because no nested `ID` input field happens to share
  // a bare name with an `ID_ARG_TYPE_NAMES` entry (`libraryId` is a top-level
  // arg, never a nested field) — a future nested field named `libraryId`
  // would silently default to `User` rather than resolving to `Library`. Add
  // a qualified `INPUT_FIELD_ID_TYPE_NAMES` entry for it rather than relying
  // on any fallback.
  const placeholderLiteral = (
    type: GraphQLInputType,
    key: string,
    idFor: (key: string) => string
  ): string => {
    if (isNonNullType(type)) return placeholderLiteral(type.ofType, key, idFor);
    if (isListType(type)) return `[${placeholderLiteral(type.ofType, key, idFor)}]`;
    // Mutations take a single `input:` object argument, so probing them means
    // building an object literal, recursively, from the input type's own
    // required fields — omitting one is a validation error before the resolver
    // (and so before the auth scope) runs, exactly as an omitted argument
    // would be. Optional fields are left out: fewer values is fewer ways for
    // this guard to fail for a reason other than the one it tests.
    if (isInputObjectType(type)) {
      const fields = Object.values(type.getFields()).filter((field) => isNonNullType(field.type));
      return `{ ${fields
        .map(
          (field) =>
            `${field.name}: ${placeholderLiteral(field.type, `${type.name}.${field.name}`, idFor)}`
        )
        .join(', ')} }`;
    }
    // Enum literals are bare identifiers (unquoted, unlike String) — any
    // member works as a placeholder, so the first one declared is enough.
    if (isEnumType(type)) return type.getValues()[0].name;
    switch (type.name) {
      case 'ID':
        return JSON.stringify(idFor(key));
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
    // Unlike `Library`, `seedNodeFor('Book')` does insert a real row (Book's
    // id is compound, not a re-encoding of an existing id) — still cheap
    // (one insert), and only paid once per test regardless of whether the
    // field under test actually has a `Book`-typed id anywhere in its args.
    const aliceBookGlobalId = await harness.seedNodeFor('Book');
    // Same `key` looked up in both maps, NOT a qualified-then-bare-name
    // fallback (see `placeholderLiteral`'s `key` doc comment for why that
    // reading is wrong): a top-level arg's bare key only ever matches
    // `ID_ARG_TYPE_NAMES` (e.g. `libraryId` -> Library); a nested input
    // field's qualified key only ever matches `INPUT_FIELD_ID_TYPE_NAMES`
    // (e.g. `BookValidateInput.id` -> Book). Anything neither map has an
    // entry for defaults to the `User` id every other `ID` arg/field in this
    // schema wants.
    const idFor = (key: string): string => {
      const typeName = INPUT_FIELD_ID_TYPE_NAMES[key] ?? ID_ARG_TYPE_NAMES[key];
      if (typeName === 'Book') return aliceBookGlobalId;
      if (typeName === 'Library') return aliceLibraryGlobalId;
      return harness.aliceGlobalId;
    };

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
