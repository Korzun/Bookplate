import SchemaBuilder from '@pothos/core';
import ErrorsPlugin from '@pothos/plugin-errors';
import PrismaPlugin from '@pothos/plugin-prisma';
import RelayPlugin from '@pothos/plugin-relay';
import ScopeAuthPlugin from '@pothos/plugin-scope-auth';
import ValidationPlugin from '@pothos/plugin-validation';
import { GraphQLError } from 'graphql';
import { DateTimeResolver, JSONResolver } from 'graphql-scalars';

import type { Context } from '../context';
import { getDatamodel } from '../generated/pothos-types';
import type PrismaTypes from '../generated/pothos-types';
import { isOwnerOrAdmin } from './node-scope';

export const builder = new SchemaBuilder<{
  Context: Context;
  PrismaTypes: PrismaTypes;
  AuthScopes: {
    authenticated: boolean;
    admin: boolean;
    ownerOf: string;
    /**
     * A signed-in viewer, ignoring a pending forced password change. Only the
     * change-password mutation may use this — everything else must stay on
     * `authenticated`, which refuses a viewer whose password change is
     * outstanding. Mirrors REST's `/api/my/password` exemption from
     * `passwordChangeGate` (middleware/auth.ts).
     */
    passwordChangeAllowed: boolean;
  };
  DefaultInputFieldRequiredness: true;
  // Pothos v4 defaults output fields to nullable unless told otherwise. Both
  // the type param and the runtime option below are required — the type
  // param governs typechecking, the option governs schema construction — so
  // don't drop either one as "redundant".
  DefaultFieldNullability: false;
  Scalars: {
    DateTime: { Input: Date; Output: Date };
    // The single heterogeneous leaf in the schema: `MetadataFix.changes`
    // (`Record<string, string | string[]>`, see `types.ts`) has no natural
    // GraphQL representation short of a union that would fight codegen — see
    // the cleanup spec, §"2. Typed PendingFixState". Every field around it is
    // typed; this scalar exists for that one leaf.
    JSON: { Input: unknown; Output: unknown };
  };
}>({
  // Pothos wraps resolvers in plugin order — the first plugin listed is the
  // outermost wrapper. Two documented constraints fix this ordering; don't
  // reshuffle it without re-reading both READMEs:
  //
  //  1. RelayPlugin before ScopeAuthPlugin. @pothos/plugin-scope-auth's README
  //     ("putting the relay plugin before the scope-auth plugin") — otherwise
  //     `authScopes` functions receive the *raw* base64 global ID while the
  //     resolver receives the parsed one, so an id-taking scope such as
  //     `ownerOf` compares a global ID against a database id and fails closed.
  //  2. ErrorsPlugin before PrismaPlugin. @pothos/plugin-errors' README: "To
  //     use this in combination with the prisma plugin, ensure that the errors
  //     plugin is listed BEFORE the prisma plugin" — required for `errors` to
  //     work on prisma field-builder methods.
  //
  // ScopeAuthPlugin still sits ahead of Errors/Prisma/Validation so authorization
  // rejects before any resolver logic runs and an auth failure is never swallowed
  // into an errors-plugin union member.
  plugins: [RelayPlugin, ScopeAuthPlugin, ErrorsPlugin, PrismaPlugin, ValidationPlugin],
  defaultInputFieldRequiredness: true,
  defaultFieldNullability: false,
  scopeAuth: {
    // Load-bearing for `Subscription.scanProgress`, the only subscription
    // field in the schema. `@pothos/plugin-scope-auth`'s own README, §"Using
    // with subscriptions": "when this is not set, auth checks are run when
    // [an] event is resolved rather than when the subscription is created" —
    // VERIFIED by reading `wrapSubscribe` in the plugin's source
    // (`@pothos/plugin-scope-auth/lib/index.js`): it only inserts scope-check
    // steps ahead of the field's own `subscribe` function when
    // `authorizeOnSubscribe` is true; without it, `wrapSubscribe` returns the
    // raw `subscribe` unwrapped, and only `wrapResolve` (run once per emitted
    // event, not once at subscription time) would ever see the auth scope.
    // Left unset, a cross-tenant `scanProgress` call would still establish a
    // live subscription against another user's `ScanJobStore` topic — no data
    // would leak (each event's `resolve` step would still deny it), but the
    // subscribe-time rejection this schema's mutations/queries all give a
    // caller immediately would not happen for this field. Setting it true
    // makes `scanProgress`'s `ownerOf` scope run — and its `subscribe`
    // function never invoked — before the client's subscription even opens,
    // matching root-auth.test.ts's "refuses $operation.$name for a null
    // viewer" walk, which asserts on the immediate result, not a later event.
    authorizeOnSubscribe: true,
    authScopes: (context: Context) => ({
      // A viewer with a forced password change pending is treated as not
      // authenticated for every field but the change-password mutation, which
      // uses `passwordChangeAllowed`. REST enforces the same rule through
      // `passwordChangeGate`; GraphQL is mounted outside that router, so the
      // control has to live here or it does not exist.
      authenticated: context.viewer !== null && !context.viewer.mustChangePassword,
      passwordChangeAllowed: context.viewer !== null,
      admin: context.viewer?.isAdmin === true,
      ownerOf: (userId: string) => isOwnerOrAdmin(context.viewer, userId),
    }),
    // Give auth failures a machine-readable code and an HTTP status, so a
    // client can tell "token expired, refresh it" from "you may not do this"
    // without string-matching Pothos's English. Yoga honours
    // `extensions.http.status` (graphql-yoga/cjs/error.js), matching the REST
    // client's existing 401-triggers-refresh behaviour.
    unauthorizedError: (_parent, context: Context) =>
      context.viewer === null
        ? new GraphQLError('Not authenticated', {
            extensions: { code: 'UNAUTHENTICATED', http: { status: 401 } },
          })
        : new GraphQLError('Not authorized', {
            extensions: { code: 'FORBIDDEN', http: { status: 403 } },
          }),
  },
  // `prisma.client` is a context function (not a client instance), so the
  // plugin can't introspect a live client for its DMMF at schema-build time.
  // The generated getDatamodel() supplies the same DMMF explicitly — see
  // @pothos/plugin-prisma's README and prisma-node.spike.test.ts.
  prisma: { client: (context: Context) => context.prisma, dmmf: getDatamodel() },
  relay: { clientMutationId: 'omit', cursorType: 'String' },
});

builder.addScalarType('DateTime', DateTimeResolver);
builder.addScalarType('JSON', JSONResolver);

// Every field requires an authenticated viewer, with no exceptions: login,
// token refresh and public-config all stay on REST, so no unauthenticated
// GraphQL field exists.
builder.queryType({ authScopes: { authenticated: true } });

// Same rule for writes, and it has to be declared here rather than left to
// Pothos: `builder.mutationField` auto-creates `Mutation` *without options* on
// first use, so a mutation added without this line would simply be
// unauthenticated. `root-auth.test.ts` walks whatever root types the built
// schema has and fails if one gains an ungated field.
//
// Pothos ANDs type-level and field-level scopes, so a field needing a
// different rule adds its own on top (`ownerOf` on progressDelete) — with one
// coming exception: `userChangePassword` exists precisely for a viewer whose
// pending password change makes `authenticated` false, so it must opt out with
// `skipTypeScopes` and use `passwordChangeAllowed` instead.
//
// GraphQL forbids an object type with no fields, so this cannot land alone;
// `progress/mutation/delete.ts` is the field that carries it.
builder.mutationType({ authScopes: { authenticated: true } });

// Same rule again for `Subscription` — same "Pothos would otherwise
// auto-create it unauthenticated on first use" reasoning as `mutationType`
// above. Unlike `mutationType`, this doesn't need a companion field landing
// in the same commit to avoid the "object type with no fields" problem:
// `scanProgress` (`schema/library/subscription/scan-progress.ts`) is added in
// this same task, so `Subscription` never exists fieldless at any point in
// the built schema. `root-auth.test.ts`'s walk picks this root type up the
// same generic way it already does `query`/`mutation`
// (`schema.getSubscriptionType()`), with no test-file change needed.
builder.subscriptionType({ authScopes: { authenticated: true } });
