import { deleteMcpToken } from '../../../../services/mcp-token';
import { builder } from '../../builder';

/**
 * Revokes one of the viewer's own agent tokens. Effective immediately: every
 * `/mcp` request re-authenticates, and upload/download URLs minted under the
 * token stop working too (`mcp/transfer-ticket.ts`).
 *
 * `false` means "no such token of yours" — a wrong id and another reader's id
 * are deliberately indistinguishable, the `viewerRemovePushSubscription`
 * shape. Ownership is in the delete's WHERE clause, not a read-then-check.
 */
builder.mutationField('viewerRevokeMcpToken', (t) =>
  t.boolean({
    description: 'Revokes one of the viewer’s agent access tokens.',
    args: { id: t.arg.id({ required: true }) },
    authScopes: (_parent, _args, context) => context.viewer?.userId != null,
    resolve: (_root, args, context) =>
      deleteMcpToken(context.prisma, {
        userId: context.viewer?.userId ?? '',
        id: String(args.id),
      }),
  })
);
