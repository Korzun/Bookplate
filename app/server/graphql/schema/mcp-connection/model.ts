import type { McpConnectionRow } from '../../../services/mcp-connection';
import { builder } from '../builder';

/**
 * One assistant a reader has connected over MCP. `id` is the grant id; it is
 * what `viewerRevokeMcpConnection` takes. Not a `Node`: nothing navigates to
 * a connection, it is only ever listed under its own viewer.
 */
export const model = builder.objectRef<McpConnectionRow>('McpConnection').implement({
  description: 'One AI assistant connected to this account over MCP.',
  fields: (t) => ({
    id: t.id({ resolve: (row) => row.id }),
    clientName: t.string({
      description: 'The name the client registered with, or "Unnamed client".',
      resolve: (row) => row.clientName,
    }),
    clientUri: t.string({ nullable: true, resolve: (row) => row.clientUri }),
    logoUri: t.string({ nullable: true, resolve: (row) => row.logoUri }),
    scopes: t.field({
      type: ['String'],
      description: 'The granted scopes: `library:read`, and `library:write` unless read-only.',
      resolve: (row) => [...row.scopes],
    }),
    createdAt: t.field({ type: 'DateTime', resolve: (row) => new Date(row.createdAt) }),
    lastUsedAt: t.field({
      type: 'DateTime',
      nullable: true,
      description: 'When a tool was last called on this connection (minute resolution).',
      resolve: (row) => (row.lastUsedAt === null ? null : new Date(row.lastUsedAt)),
    }),
  }),
});
