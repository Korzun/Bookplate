import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { z } from 'zod';

import type { ToolDeps } from './deps';
import { executeDocument, guarded, ok, ToolError } from './execute';
import {
  BOOK_REQUEST_FIELDS,
  bookRequestSchema,
  describeBookRequest,
  toBookRequest,
  type BookRequestGql,
} from './list-book-requests';
import { unwrapPayload, userErrorFields } from './mutation';

const DOCUMENT = `
  mutation UpdateBookRequest($id: ID!, $input: BookRequestUpdateInput!) {
    bookRequestUpdate(id: $id, input: $input) {
      __typename
      ... on BookRequestUpdatePayload { bookRequest { ${BOOK_REQUEST_FIELDS} } }
      ${userErrorFields(['InvalidInputError', 'DuplicateBookRequestError', 'BookRequestNotPendingError'])}
    }
  }
`;

/**
 * The mutation answers null for a malformed id, a missing request, or one
 * that belongs to someone else. `unwrapPayload` would render that as
 * `NOT_FOUND_BOOK`, which names a book, so the tool checks first.
 */
const NOT_FOUND_REQUEST = 'No book request with that id, or it is not yours';

type Result = {
  bookRequestUpdate: { __typename: string; bookRequest?: BookRequestGql } | null;
};

export function registerUpdateBookRequest(server: McpServer, deps: ToolDeps): void {
  server.registerTool(
    'update_book_request',
    {
      title: 'Update a book request',
      description:
        'Corrects the title, author or note of a pending book request you made. Omitted fields are unchanged. Use the id list_book_requests returns.',
      inputSchema: {
        id: z.string(),
        title: z.string().min(1).max(500).optional(),
        author: z.string().min(1).max(500).optional(),
        note: z.string().max(2000).optional(),
      },
      outputSchema: bookRequestSchema.shape,
      // Idempotent: applying the same correction twice leaves the request as
      // the first call did.
      annotations: {
        readOnlyHint: false,
        destructiveHint: false,
        idempotentHint: true,
        openWorldHint: false,
      },
    },
    (args) =>
      guarded(deps, { write: true }, async () => {
        const data = await executeDocument<Result>(deps.context, DOCUMENT, {
          id: args.id,
          input: { title: args.title, author: args.author, note: args.note },
        });
        if (data.bookRequestUpdate === null) throw new ToolError(NOT_FOUND_REQUEST);
        const payload = unwrapPayload<{
          __typename: 'BookRequestUpdatePayload';
          bookRequest: BookRequestGql;
        }>(data.bookRequestUpdate, 'BookRequestUpdatePayload');
        const request = toBookRequest(payload.bookRequest);
        return ok(`Updated: ${describeBookRequest(request)}`, request);
      })
  );
}
