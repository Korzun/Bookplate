import { revokeMcpConnection } from '../../../../services/mcp-connection';
import { builder } from '../../builder';
import { resolveViewerUserId } from '../../viewer/mutation/resolve-user-id';

/**
 * "Disconnect" in Settings. Deleting the grant cascades its codes and tokens
 * away, so the assistant's very next request fails its token lookup — there
 * is no blacklist and nothing to wait out. Same shape as
 * `viewerRemovePushSubscription`.
 */
builder.mutationField('viewerRevokeMcpConnection', (t) =>
  t.boolean({
    description:
      "Disconnects one of the viewer's MCP assistants; its tokens stop working immediately. " +
      'False when no such connection belongs to the viewer.',
    args: { id: t.arg.id({ required: true }) },
    resolve: async (_root, args, context) => {
      const userId = await resolveViewerUserId(context);
      if (userId === null) return false;
      return revokeMcpConnection(context.prisma, { userId, id: String(args.id) });
    },
  })
);
