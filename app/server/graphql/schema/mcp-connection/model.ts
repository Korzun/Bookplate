import type { McpConnectionRow } from '../../../services/mcp-oauth';
import { epochToDate } from '../../derive';
import { builder } from '../builder';

/**
 * One AI agent the reader connected to their library over MCP — an OAuth
 * grant (`oauth_grants`), seen from the settings page.
 *
 * An `objectRef` over `McpConnectionRow`, NOT a `prismaObject`, for the reason
 * `PushSubscription` is one: the grant row carries token hashes, and a
 * `prismaObject` would make exposing them a one-line mistake.
 */
export const model = builder.objectRef<McpConnectionRow>('McpConnection').implement({
  description: 'An AI agent connected to this library over MCP.',
  fields: (t) => ({
    id: t.id({ resolve: (row) => row.id }),
    clientName: t.string({
      description:
        'The name the agent registered under (for example "Claude"), or its redirect host if it gave none. Self-declared by the agent.',
      resolve: (row) => row.clientName,
    }),
    createdAt: t.field({ type: 'DateTime', resolve: (row) => epochToDate(row.createdAt) }),
    lastUsedAt: t.field({
      type: 'DateTime',
      nullable: true,
      description:
        'Roughly when the agent last used its access (updated at most once a minute). Null means never.',
      resolve: (row) => (row.lastUsedAt === null ? null : epochToDate(row.lastUsedAt)),
    }),
  }),
});
