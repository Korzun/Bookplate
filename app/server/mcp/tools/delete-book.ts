import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { z } from 'zod';

import type { ToolDeps } from './deps';
import { decodeBookId, executeDocument, guarded, NOT_FOUND_BOOK, ok, ToolError } from './execute';
import { fetchBookDetail } from './get-book';
import { unwrapPayload } from './mutation';

const DOCUMENT = `
  mutation DeleteBook($input: BookDeleteInput!) {
    bookDelete(input: $input) {
      __typename
      ... on BookDeletePayload { deletedId }
    }
  }
`;

type Result = { bookDelete: { __typename: string; deletedId?: string } | null };

export function registerDeleteBook(server: McpServer, deps: ToolDeps): void {
  server.registerTool(
    'delete_book',
    {
      title: 'Delete a book',
      description:
        'Permanently deletes a book from the library — its file and its record. This cannot be undone; confirm with the user first.',
      inputSchema: { bookId: z.string() },
      outputSchema: { deletedId: z.string(), title: z.string() },
      annotations: {
        readOnlyHint: false,
        destructiveHint: true,
        idempotentHint: false,
        openWorldHint: false,
      },
    },
    (args) =>
      guarded(deps, { write: true }, async () => {
        if (decodeBookId(deps, args.bookId) === null) throw new ToolError(NOT_FOUND_BOOK);
        // Read the title before it is gone, so the confirmation names the book.
        const before = await fetchBookDetail(deps, args.bookId);
        const data = await executeDocument<Result>(deps.context, DOCUMENT, {
          input: { id: args.bookId },
        });
        const payload = unwrapPayload<{ __typename: 'BookDeletePayload'; deletedId: string }>(
          data.bookDelete,
          'BookDeletePayload'
        );
        return ok(`Deleted "${before.title}".`, {
          deletedId: payload.deletedId,
          title: before.title,
        });
      })
  );
}
