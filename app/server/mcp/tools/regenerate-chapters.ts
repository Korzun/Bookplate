import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { z } from 'zod';

import type { ToolDeps } from './deps';
import { decodeBookId, executeDocument, guarded, NOT_FOUND_BOOK, ok, ToolError } from './execute';
import { bookDetailSchema, describeBookDetail, fetchBookDetail } from './get-book';
import { unwrapPayload, userErrorFields } from './mutation';

const DOCUMENT = `
  mutation RegenChapters($input: BookRegenChaptersInput!) {
    bookRegenChapters(input: $input) {
      __typename
      ... on BookRegenChaptersPayload { book { id } }
      ${userErrorFields(['BookNotValidatedError', 'BookHashCollisionError'])}
    }
  }
`;

type Result = { bookRegenChapters: { __typename: string; book?: { id: string } } | null };

export function registerRegenerateChapters(server: McpServer, deps: ToolDeps): void {
  server.registerTool(
    'regenerate_chapters',
    {
      title: 'Regenerate chapter list',
      description:
        'Re-reads the EPUB to rebuild the book’s chapter list and page count (useful after a replacement or when progress looks wrong).',
      inputSchema: { bookId: z.string() },
      outputSchema: bookDetailSchema,
      annotations: {
        readOnlyHint: false,
        destructiveHint: false,
        idempotentHint: true,
        openWorldHint: false,
      },
    },
    (args) =>
      guarded(deps, { write: true }, async () => {
        if (decodeBookId(deps, args.bookId) === null) throw new ToolError(NOT_FOUND_BOOK);
        const data = await executeDocument<Result>(deps.context, DOCUMENT, {
          input: { id: args.bookId },
        });
        const payload = unwrapPayload<{
          __typename: 'BookRegenChaptersPayload';
          book: { id: string };
        }>(data.bookRegenChapters, 'BookRegenChaptersPayload');
        const book = await fetchBookDetail(deps, payload.book.id);
        return ok(
          `Chapters regenerated (${book.chapterCount}).\n${describeBookDetail(book)}`,
          book
        );
      })
  );
}
