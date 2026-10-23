import { graphql } from '~/gql';

/**
 * One agent (MCP) access token, as the settings list shows it. The token
 * itself is never selectable here — the server keeps only a hash, and returns
 * the plaintext once, from `ViewerCreateMcpTokenDocument` below.
 */
export const McpTokenFragment = graphql(`
  fragment McpTokenFragment on McpToken {
    id
    label
    createdAt
    lastUsedAt
  }
`);

export const ViewerCreateMcpTokenDocument = graphql(`
  mutation ViewerCreateMcpToken($input: ViewerCreateMcpTokenInput!) {
    viewerCreateMcpToken(input: $input) {
      __typename
      ... on ViewerCreateMcpTokenPayload {
        token
        mcpToken {
          ...McpTokenFragment
        }
      }
      ... on UserError {
        message
      }
      ... on InvalidInputError {
        issues {
          path
          message
        }
      }
    }
  }
`);

export const ViewerRevokeMcpTokenDocument = graphql(`
  mutation ViewerRevokeMcpToken($id: ID!) {
    viewerRevokeMcpToken(id: $id)
  }
`);
