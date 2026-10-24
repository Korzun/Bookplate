import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { z } from 'zod';

import type { ToolDeps } from './deps';
import { executeDocument, guarded, ok } from './execute';
import {
  BOOK_REQUEST_FIELDS,
  bookRequestSchema,
  describeBookRequest,
  toBookRequest,
  type BookRequestGql,
} from './list-book-requests';
import { unwrapPayload, userErrorFields } from './mutation';

const DOCUMENT = `
  mutation RequestBook($input: BookRequestCreateInput!) {
    bookRequestCreate(input: $input) {
      __typename
      ... on BookRequestCreatePayload { bookRequest { ${BOOK_REQUEST_FIELDS} } }
      ${userErrorFields(['InvalidInputError', 'DuplicateBookRequestError', 'BookRequestLimitExceededError'])}
    }
  }
`;

type Result = {
  bookRequestCreate: { __typename: string; bookRequest?: BookRequestGql };
};

export function registerRequestBook(server: McpServer, deps: ToolDeps): void {
  server.registerTool(
    'request_book',
    {
      title: 'Request a book',
      description:
        'Asks the library admin to add a book that is not in the library. Check search_library first; a duplicate of an open request is refused.',
      inputSchema: {
        title: z.string().min(1).max(500),
        author: z.string().min(1).max(500),
        note: z.string().max(2000).optional(),
      },
      outputSchema: bookRequestSchema.shape,
      annotations: {
        readOnlyHint: false,
        destructiveHint: false,
        idempotentHint: false,
        openWorldHint: false,
      },
    },
    (args) =>
      guarded(deps, { write: true }, async () => {
        const data = await executeDocument<Result>(deps.context, DOCUMENT, {
          input: { title: args.title, author: args.author, note: args.note },
        });
        const payload = unwrapPayload<{
          __typename: 'BookRequestCreatePayload';
          bookRequest: BookRequestGql;
        }>(data.bookRequestCreate, 'BookRequestCreatePayload');
        const request = toBookRequest(payload.bookRequest);
        return ok(`Requested: ${describeBookRequest(request)}`, request);
      })
  );
}
