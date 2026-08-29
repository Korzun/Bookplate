import SchemaBuilder from '@pothos/core';
import PrismaPlugin from '@pothos/plugin-prisma';
import RelayPlugin from '@pothos/plugin-relay';
import ScopeAuthPlugin from '@pothos/plugin-scope-auth';
import { GraphQLError } from 'graphql';
import { DateTimeResolver, JSONResolver } from 'graphql-scalars';

import type { Context } from '../context';
import { getDatamodel } from '../generated/pothos-types';
import type PrismaTypes from '../generated/pothos-types';
import { isOwnerOrAdmin } from './node-scope';
import { CONNECTION_LIMITS, rejectOversizeIdBatch } from './pagination';

export const builder = new SchemaBuilder<{
  Context: Context;
  PrismaTypes: PrismaTypes;
  AuthScopes: {
    authenticated: boolean;
    admin: boolean;
    ownerOf: string;
    /**
     * A signed-in viewer, ignoring a pending forced password change. Only
     * `userChangePassword` may use this — everything else must stay on
     * `authenticated`, which refuses a viewer whose password change is
     * outstanding. That single exemption is load-bearing: this mutation is
     * the only path a locked-out viewer has to clear the flag, so putting it
     * on `authenticated` like everything else would strand them.
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
  // outermost wrapper. One documented constraint fixes this ordering; don't
  // reshuffle it without re-reading its README:
  //
  //  1. RelayPlugin before ScopeAuthPlugin. @pothos/plugin-scope-auth's README
  //     ("putting the relay plugin before the scope-auth plugin") — otherwise
  //     `authScopes` functions receive the *raw* base64 global ID while the
  //     resolver receives the parsed one, so an id-taking scope such as
  //     `ownerOf` compares a global ID against a database id and fails closed.
  //
  // ScopeAuthPlugin still sits ahead of Prisma so authorization rejects
  // before any resolver logic runs.
  //
  // Two plugins deliberately NOT here (Task 4, pre-client-polish plan §5 —
  // removed rather than left inert, so nobody "helpfully" re-adds them):
  //
  //  - `@pothos/plugin-errors`: its `extractAndSortErrorTypes` only accepts
  //    error *classes*. Every error type in this schema is a plain data
  //    shape carrying a readonly `owner: Owner` field (see
  //    `user-error/model.ts`), not a class, so no field anywhere could ever
  //    declare an `errors:` option — the plugin can never activate here.
  //  - `@pothos/plugin-validation`: its declarative per-field `validate:`
  //    option runs INSIDE the resolver, after `authScopes` has already
  //    decided access — using it would put input validation on a path that
  //    bypasses the ordering this schema depends on (auth rejects first,
  //    unconditionally, before any field-level logic). zod runs inside
  //    resolver bodies instead (every mutation's own `inputSchema.safeParse`
  //    call), which keeps validation strictly after auth with no plugin seam
  //    that could invert that order by accident.
  //
  // SDL is byte-identical with both plugins removed (`graphql:schema:check`
  // — neither ever contributed anything to it); the schema-build/test/lint
  // suite passing with them gone is the proof nothing consumed them.
  plugins: [RelayPlugin, ScopeAuthPlugin, PrismaPlugin],
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
    // live subscription against another user's `ScanJobRegistry` topic — no data
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
  relay: {
    clientMutationId: 'omit',
    cursorType: 'String',
    // `Query.nodes(ids:)` is a plain root field (no parent's merged Prisma
    // `select` to bypass, unlike `t.relatedConnection` — see
    // `series/model.ts`'s `books` field for that distinction), so a custom
    // `resolve` here IS the field's real resolver on every path
    // (`@pothos/plugin-relay/lib/schema-builder.js`: `resolveNodesFn`, when
    // given, is wired directly as the field's `resolve`, not a fallback).
    // `CONNECTION_LIMITS.nodesBatch`'s doc comment (pagination.ts) records
    // where `100` comes from — this field currently has no client caller to
    // source a bound from.
    nodesQueryOptions: {
      resolve: (_root, args, _context, _info, resolveNodes) => {
        rejectOversizeIdBatch('Query.nodes', args.ids, CONNECTION_LIMITS.nodesBatch);
        return resolveNodes(args.ids);
      },
    },
  },
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
