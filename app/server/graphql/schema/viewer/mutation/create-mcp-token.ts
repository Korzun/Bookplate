import { z } from 'zod';

import {
  createMcpToken,
  MAX_MCP_TOKENS_PER_USER,
  MCP_TOKEN_LABEL_MAX_LENGTH,
  type McpTokenRow,
} from '../../../../services/mcp-token';
import { builder } from '../../builder';
import {
  invalidInputError,
  model as invalidInputErrorModel,
} from '../../invalid-input-error/model';
import {
  mcpTokenLimitExceededError,
  model as mcpTokenLimitExceededErrorModel,
} from '../../mcp-token-limit-exceeded-error/model';
import { model as mcpTokenModel } from '../../mcp-token/model';

const inputSchema = z.object({
  label: z
    .string()
    .trim()
    .min(1, 'A name is required')
    .max(
      MCP_TOKEN_LABEL_MAX_LENGTH,
      `Keep the name under ${MCP_TOKEN_LABEL_MAX_LENGTH} characters`
    ),
});

const input = builder.inputType('ViewerCreateMcpTokenInput', {
  fields: (t) => ({
    label: t.string({ required: true }),
  }),
});

type PayloadShape = {
  readonly __typename: 'ViewerCreateMcpTokenPayload';
  readonly row: McpTokenRow;
  readonly token: string;
};

const payload = builder.objectRef<PayloadShape>('ViewerCreateMcpTokenPayload').implement({
  fields: (t) => ({
    mcpToken: t.field({ type: mcpTokenModel, resolve: (p) => p.row }),
    token: t.string({
      description:
        'The token itself. Returned only here, once — the server keeps a hash and cannot show it again.',
      resolve: (p) => p.token,
    }),
  }),
});

/** No `resolveType`: every member value carries its own `__typename`. */
const result = builder.unionType('ViewerCreateMcpTokenResult', {
  types: [payload, invalidInputErrorModel, mcpTokenLimitExceededErrorModel],
});

/**
 * Creates an agent access token for the viewer's own library.
 *
 * Refused (by `authScopes`) for the config admin: its token carries no `sub`,
 * it owns no library, and every MCP tool acts on "my library" — the same gate
 * and the same reasoning as `bookRequestCreate`.
 */
builder.mutationField('viewerCreateMcpToken', (t) =>
  t.field({
    type: result,
    description:
      'Creates an access token an AI agent can use to reach the viewer’s library over MCP.',
    args: { input: t.arg({ type: input, required: true }) },
    authScopes: (_parent, _args, context) => context.viewer?.userId != null,
    resolve: async (_parent, args, context) => {
      // Non-null by the `authScopes` above; this is the type narrowing.
      const userId = context.viewer?.userId ?? '';

      const parsed = inputSchema.safeParse({ label: args.input.label });
      if (!parsed.success) return invalidInputError(parsed.error);

      const created = await createMcpToken(context.prisma, { userId, label: parsed.data.label });
      if (created === null) return mcpTokenLimitExceededError(MAX_MCP_TOKENS_PER_USER);

      return {
        __typename: 'ViewerCreateMcpTokenPayload' as const,
        row: created.row,
        token: created.token,
      };
    },
  })
);
