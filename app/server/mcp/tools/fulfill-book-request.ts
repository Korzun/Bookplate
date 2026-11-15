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
import { userErrorFields } from './mutation';

const DOCUMENT = `
  mutation FulfillBookRequest($id: ID!, $bookId: ID!) {
    bookRequestFulfill(id: $id, bookId: $bookId) {
      __typename
      ... on BookRequestFulfillPayload { bookRequest { ${BOOK_REQUEST_FIELDS} } }
      ... on BookRequestNotPendingError { status }
      ${userErrorFields(['InvalidInputError'])}
    }
  }
`;

type Result = {
  bookRequestFulfill: {
    __typename: string;
    bookRequest?: BookRequestGql;
    status?: string;
    message?: string;
  } | null;
};

/** Closes a pending request with a library book. Throws `ToolError` when it cannot. */
export async function fulfillRequest(
  deps: ToolDeps,
  requestId: string,
  bookId: string
): Promise<ReturnType<typeof toBookRequest>> {
  const data = await executeDocument<Result>(deps.context, DOCUMENT, { id: requestId, bookId });
  const result = data.bookRequestFulfill;
  if (result === null) throw new ToolError('No pending request with that id');
  switch (result.__typename) {
    case 'BookRequestFulfillPayload':
      return toBookRequest(result.bookRequest!);
    case 'BookRequestNotPendingError':
      throw new ToolError(`That request is already ${(result.status ?? '').toLowerCase()}`);
    default:
      throw new ToolError(result.message ?? 'The request was refused');
  }
}

export function registerFulfillBookRequest(server: McpServer, deps: ToolDeps): void {
  server.registerTool(
    'fulfill_book_request',
    {
      title: 'Fulfill a book request',
      description:
        'Marks one of your pending book requests fulfilled by a book already in your library. upload_book can do this in the same step via requestId. The library admin is notified.',
      inputSchema: {
        requestId: z.string().describe('Request id from list_book_requests'),
        bookId: z.string().describe('Id of the library book that fulfils it'),
      },
      outputSchema: { request: bookRequestSchema },
      annotations: {
        readOnlyHint: false,
        destructiveHint: false,
        idempotentHint: false,
        openWorldHint: false,
      },
    },
    (args) =>
      guarded(deps, { write: true }, async () => {
        const request = await fulfillRequest(deps, args.requestId, args.bookId);
        return ok(`Fulfilled: ${describeBookRequest(request)}`, { request });
      })
  );
}
