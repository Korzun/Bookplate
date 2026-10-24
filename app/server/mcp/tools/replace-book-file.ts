import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { z } from 'zod';

import type { ToolDeps } from './deps';
import { decodeBookId, executeDocument, guarded, NOT_FOUND_BOOK, ok, ToolError } from './execute';
import { bookDetailSchema, describeBookDetail, fetchBookDetail } from './get-book';
import { unwrapPayload, userErrorFields } from './mutation';

const DOCUMENT = `
  mutation ReplaceBook($input: BookReplaceInput!) {
    bookReplace(input: $input) {
      __typename
      ... on BookReplacePayload { book { id } }
      ${userErrorFields(['InvalidInputError', 'EpubValidationError', 'BookHashCollisionError'])}
    }
  }
`;

type Result = { bookReplace: { __typename: string; book?: { id: string } } | null };

export function registerReplaceBookFile(server: McpServer, deps: ToolDeps): void {
  server.registerTool(
    'replace_book_file',
    {
      title: 'Replace a book’s file',
      description:
        'Step 2 of a replacement: swaps the book’s EPUB for the staged candidate, applying its automatic ' +
        'fixes and any proposals whose keys you pass. The book keeps its reading history but gets a NEW id.',
      inputSchema: {
        bookId: z.string(),
        stagedUploadId: z.string().describe('From stage_replacement'),
        acceptedFixKeys: z
          .array(z.string())
          .max(100)
          .default([])
          .describe('Keys of proposed fixes to apply alongside the replacement'),
      },
      outputSchema: bookDetailSchema,
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
        const data = await executeDocument<Result>(deps.context, DOCUMENT, {
          input: {
            id: args.bookId,
            stagedUploadId: args.stagedUploadId,
            acceptedFixKeys: args.acceptedFixKeys,
          },
        });
        const payload = unwrapPayload<{ __typename: 'BookReplacePayload'; book: { id: string } }>(
          data.bookReplace,
          'BookReplacePayload'
        );
        const book = await fetchBookDetail(deps, payload.book.id);
        return ok(`Replaced. New id: ${book.id}\n${describeBookDetail(book)}`, book);
      })
  );
}
