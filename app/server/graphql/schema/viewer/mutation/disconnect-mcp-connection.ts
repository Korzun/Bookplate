import { deleteMcpConnection } from '../../../../services/mcp-oauth';
import { builder } from '../../builder';

/**
 * Disconnects one of the viewer's AI agents: deletes its OAuth grant, which
 * kills its access and refresh tokens at once, and every upload/download URL
 * it was handed (`mcp/transfer-ticket.ts`). Effective on the agent's very next
 * request. The agent can connect again only by asking its reader to approve it
 * again.
 *
 * `false` means "no such connection of yours" — a wrong id and another
 * reader's are deliberately indistinguishable, the
 * `viewerRemovePushSubscription` shape. Ownership is in the delete's WHERE
 * clause. Refused for the config admin, which owns no library and so has no
 * connections — the `bookRequestCreate` gate.
 */
builder.mutationField('viewerDisconnectMcpConnection', (t) =>
  t.boolean({
    description: 'Disconnects one of the viewer’s AI agents from their library.',
    args: { id: t.arg.id({ required: true }) },
    authScopes: (_parent, _args, context) => context.viewer?.userId != null,
    resolve: (_root, args, context) =>
      deleteMcpConnection(context.prisma, {
        userId: context.viewer?.userId ?? '',
        id: String(args.id),
      }),
  })
);
