import { getMcpClient } from '../../../../services/mcp-connection';
import { builder } from '../../builder';
import { model } from '../client-model';

builder.queryField('mcpClient', (t) =>
  t.field({
    type: model,
    nullable: true,
    description:
      'The registered MCP client behind a consent request, for the /connect page. ' +
      'Null when no client has that id (it may have been swept, or never existed).',
    args: { clientId: t.arg.string({ required: true }) },
    resolve: async (_parent, args, context) => {
      const client = await getMcpClient(context.prisma, args.clientId);
      if (client === null) return null;
      const { redirectUris: _redirectUris, ...shown } = client;
      return shown;
    },
  })
);
