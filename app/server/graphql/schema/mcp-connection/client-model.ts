import type { McpClientDisplay } from '../../../services/mcp-connection';
import { builder } from '../builder';

/**
 * What the consent page (`/connect`) shows about the client asking for
 * access. Display fields only — never the redirect URIs or the secret.
 */
export const model = builder.objectRef<McpClientDisplay>('McpClientInfo').implement({
  description: 'A registered MCP client, as shown on the consent page.',
  fields: (t) => ({
    clientId: t.exposeString('clientId'),
    clientName: t.exposeString('clientName'),
    clientUri: t.string({ nullable: true, resolve: (c) => c.clientUri }),
    logoUri: t.string({ nullable: true, resolve: (c) => c.logoUri }),
  }),
});
