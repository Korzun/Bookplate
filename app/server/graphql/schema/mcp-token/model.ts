import type { McpTokenRow } from '../../../services/mcp-token';
import { epochToDate } from '../../derive';
import { builder } from '../builder';

/**
 * One agent access token for `/mcp`.
 *
 * An `objectRef` over the storage layer's `McpTokenRow`, NOT a `prismaObject`,
 * for the same reason `PushSubscription` is one: the Prisma row carries
 * `tokenHash`, and a `prismaObject` would make exposing it a one-line mistake.
 * The plaintext token exists only in `ViewerCreateMcpTokenPayload.token`, once.
 */
export const model = builder.objectRef<McpTokenRow>('McpToken').implement({
  description: 'An access token an AI agent uses to reach this library over MCP.',
  fields: (t) => ({
    id: t.id({ resolve: (row) => row.id }),
    label: t.string({ resolve: (row) => row.label }),
    createdAt: t.field({ type: 'DateTime', resolve: (row) => epochToDate(row.createdAt) }),
    lastUsedAt: t.field({
      type: 'DateTime',
      nullable: true,
      description:
        'Roughly when an agent last used this token (updated at most once a minute). Null means never.',
      resolve: (row) => (row.lastUsedAt === null ? null : epochToDate(row.lastUsedAt)),
    }),
  }),
});
