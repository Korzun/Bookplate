import SchemaBuilder from '@pothos/core';
import ErrorsPlugin from '@pothos/plugin-errors';
import PrismaPlugin from '@pothos/plugin-prisma';
import RelayPlugin from '@pothos/plugin-relay';
import ScopeAuthPlugin from '@pothos/plugin-scope-auth';
import ValidationPlugin from '@pothos/plugin-validation';
import { DateTimeResolver } from 'graphql-scalars';

import type { Context } from '../context';
import { getDatamodel } from '../generated/pothos-types';
import type PrismaTypes from '../generated/pothos-types';

export const builder = new SchemaBuilder<{
  Context: Context;
  PrismaTypes: PrismaTypes;
  AuthScopes: {
    authenticated: boolean;
    admin: boolean;
    ownerOf: string;
  };
  DefaultInputFieldRequiredness: true;
  Scalars: {
    DateTime: { Input: Date; Output: Date };
  };
}>({
  // ScopeAuthPlugin must come first so its field wrapping runs outermost —
  // authorization has to reject before any other plugin's resolver logic runs.
  plugins: [ScopeAuthPlugin, PrismaPlugin, RelayPlugin, ErrorsPlugin, ValidationPlugin],
  defaultInputFieldRequiredness: true,
  scopeAuth: {
    authScopes: (context: Context) => ({
      authenticated: context.viewer !== null,
      admin: context.viewer?.isAdmin === true,
      ownerOf: (userId: string) =>
        context.viewer?.isAdmin === true || context.viewer?.userId === userId,
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

// Every field requires an authenticated viewer, with no exceptions: login,
// token refresh and public-config all stay on REST, so no unauthenticated
// GraphQL field exists.
builder.queryType({ authScopes: { authenticated: true } });
