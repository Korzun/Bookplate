import { redirectUriMatches } from '@modelcontextprotocol/sdk/server/auth/handlers/authorize.js';
import { z } from 'zod';

import { createAuthorizationCode, resolveGrantedScopes, upsertGrant } from '../../../../mcp/tokens';
import { getMcpClient } from '../../../../services/mcp-connection';
import { builder } from '../../builder';
import {
  invalidInputError,
  model as invalidInputErrorModel,
  type InvalidInputErrorShape,
} from '../../invalid-input-error/model';

/**
 * The consent decision. The SDK's authorize handler already validated the
 * client and redirect URI once before sending the browser to `/connect`, but
 * the SPA then hands the parameters back as mutation input, and input is a
 * claim: everything is re-checked here against the client's registration
 * before a code is written — and before a DENY redirect too, so this
 * mutation can never be used to bounce a browser to an unregistered URL.
 */
const inputSchema = z.object({
  clientId: z.string().min(1).max(200),
  redirectUri: z.string().url().max(2000),
  codeChallenge: z.string().min(1).max(128),
  state: z.string().max(2000).nullable(),
  scope: z.string().max(200).nullable(),
  resource: z.string().url().max(2000).nullable(),
  approve: z.boolean(),
  readOnly: z.boolean(),
});

const input = builder.inputType('McpAuthorizeInput', {
  fields: (t) => ({
    clientId: t.string({ required: true }),
    redirectUri: t.string({ required: true }),
    codeChallenge: t.string({ required: true }),
    state: t.string({ required: false }),
    scope: t.string({ required: false }),
    resource: t.string({ required: false }),
    approve: t.boolean({ required: true }),
    readOnly: t.boolean({ required: true }),
  }),
});

type McpAuthorizePayloadShape = {
  readonly __typename: 'McpAuthorizePayload';
  readonly redirectUrl: string;
};

const payload = builder.objectRef<McpAuthorizePayloadShape>('McpAuthorizePayload').implement({
  fields: (t) => ({
    redirectUrl: t.string({
      description:
        'Where the browser must go next: the client’s redirect URI with code+state, or error=access_denied.',
      resolve: (p) => p.redirectUrl,
    }),
  }),
});

const result = builder.unionType('McpAuthorizeResult', {
  types: [payload, invalidInputErrorModel],
});

const ADMIN_MESSAGE = 'The admin account has no library to connect';

/**
 * Unlike a zod failure, each refusal here is one sentence the consent page
 * shows verbatim, so it goes in `message` (what the page renders) as well as
 * in `issues` (the field it concerns, when there is one).
 */
const refuse = (path: string[], message: string): InvalidInputErrorShape => ({
  __typename: 'InvalidInputError',
  message,
  issues: [{ path, message }],
});

builder.mutationField('mcpAuthorize', (t) =>
  t.field({
    type: result,
    description:
      'Records the viewer’s consent decision for an MCP client and returns the URL to send the browser to. ' +
      'Approving creates (or refreshes) the connection and a single-use authorization code; denying returns ' +
      'the client’s redirect URI with error=access_denied. Only readers can connect: the admin account has no library.',
    args: { input: t.arg({ type: input, required: true }) },
    resolve: async (_parent, args, context) => {
      const parsed = inputSchema.safeParse(args.input);
      if (!parsed.success) return invalidInputError(parsed.error);
      const data = parsed.data;

      if (context.mcpUrl === null) return refuse([], 'MCP is not enabled');
      const viewer = context.viewer;
      if (viewer === null || viewer.userId === null) return refuse([], ADMIN_MESSAGE);

      const client = await getMcpClient(context.prisma, data.clientId);
      if (client === null) return refuse(['clientId'], 'Unknown client');
      if (
        !client.redirectUris.some((registered) => redirectUriMatches(data.redirectUri, registered))
      ) {
        return refuse(['redirectUri'], 'Unregistered redirect URI');
      }

      const redirect = new URL(data.redirectUri);
      if (data.state !== null) redirect.searchParams.set('state', data.state);

      if (!data.approve) {
        redirect.searchParams.set('error', 'access_denied');
        redirect.searchParams.set('error_description', 'The user denied the request');
        return { __typename: 'McpAuthorizePayload' as const, redirectUrl: redirect.href };
      }

      let scopes;
      try {
        scopes = resolveGrantedScopes(
          data.scope === null ? undefined : data.scope.split(' ').filter((s) => s !== ''),
          data.readOnly
        );
      } catch {
        return refuse(['scope'], 'No supported scope was requested');
      }

      const grant = await upsertGrant(context.prisma, {
        userId: viewer.userId,
        clientId: client.clientId,
        scopes,
      });
      const code = await createAuthorizationCode(context.prisma, {
        grantId: grant.id,
        redirectUri: data.redirectUri,
        codeChallenge: data.codeChallenge,
        resource: data.resource,
      });
      redirect.searchParams.set('code', code);
      return { __typename: 'McpAuthorizePayload' as const, redirectUrl: redirect.href };
    },
  })
);
