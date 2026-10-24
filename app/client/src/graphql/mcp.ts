import { graphql } from '~/gql';

/**
 * One AI assistant connected over MCP, as `component/mcp-connections` lists
 * it. `id` is the grant id `ViewerRevokeMcpConnectionDocument` takes.
 */
export const McpConnectionFragment = graphql(`
  fragment McpConnectionFragment on McpConnection {
    id
    clientName
    clientUri
    logoUri
    scopes
    createdAt
    lastUsedAt
  }
`);

/**
 * Everything the "AI assistants" settings card reads, colocated on `Viewer`
 * and composed into `page/settings`'s `UserPageDocument` — the route's one
 * document — rather than fetched by the card itself.
 */
export const McpConnectionsFragment = graphql(`
  fragment McpConnectionsFragment on Viewer {
    mcpEnabled
    mcpUrl
    mcpConnections {
      ...McpConnectionFragment
    }
  }
`);

export const ViewerRevokeMcpConnectionDocument = graphql(`
  mutation ViewerRevokeMcpConnection($id: ID!) {
    viewerRevokeMcpConnection(id: $id)
  }
`);

/** What the consent page (`page/connect`) shows about the asking client. */
export const McpClientDocument = graphql(`
  query McpClient($clientId: String!) {
    mcpClient(clientId: $clientId) {
      clientId
      clientName
      clientUri
    }
  }
`);

export const McpAuthorizeDocument = graphql(`
  mutation McpAuthorize($input: McpAuthorizeInput!) {
    mcpAuthorize(input: $input) {
      __typename
      ... on McpAuthorizePayload {
        redirectUrl
      }
      ... on InvalidInputError {
        message
      }
    }
  }
`);
