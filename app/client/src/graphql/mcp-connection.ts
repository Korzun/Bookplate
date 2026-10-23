import { graphql } from '~/gql';

/**
 * One AI agent the reader has connected over MCP (an OAuth grant), as the
 * settings list shows it. Agents connect themselves — the reader approves them
 * on `page/oauth-consent` — so the client never creates one, only lists and
 * disconnects.
 */
export const McpConnectionFragment = graphql(`
  fragment McpConnectionFragment on McpConnection {
    id
    clientName
    createdAt
    lastUsedAt
  }
`);

export const ViewerDisconnectMcpConnectionDocument = graphql(`
  mutation ViewerDisconnectMcpConnection($id: ID!) {
    viewerDisconnectMcpConnection(id: $id)
  }
`);
