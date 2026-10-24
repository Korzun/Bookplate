import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { z } from 'zod';

import type { ToolDeps } from './deps';
import { decodeBookId, executeDocument, guarded, NOT_FOUND_BOOK, ok, ToolError } from './execute';
import { bookDetailSchema, describeBookDetail, fetchBookDetail } from './get-book';
import { unwrapPayload, userErrorFields } from './mutation';

const DOCUMENT = `
  mutation UpdateBookMetadata($input: BookUpdateMetadataInput!) {
    bookUpdateMetadata(input: $input) {
      __typename
      ... on BookUpdateMetadataPayload { book { id } }
      ${userErrorFields(['InvalidInputError', 'EpubValidationError', 'BookNotValidatedError', 'BookHashCollisionError'])}
    }
  }
`;

type Result = {
  bookUpdateMetadata: { __typename: string; book?: { id: string } } | null;
};

export function registerUpdateBookMetadata(server: McpServer, deps: ToolDeps): void {
  server.registerTool(
    'update_book_metadata',
    {
      title: 'Update book metadata',
      description:
        'Changes any of a book’s metadata fields; omitted fields are left as they are. The EPUB file is ' +
        'rewritten, so the book gets a NEW id — the returned detail carries it. Fails for a book whose ' +
        'last validation was not valid (run validate_book first).',
      inputSchema: {
        bookId: z.string(),
        title: z.string().max(1000).optional(),
        titleSort: z.string().max(1000).optional(),
        author: z.string().max(1000).optional(),
        authorSort: z.string().max(1000).optional(),
        description: z.string().max(20000).optional(),
        publisher: z.string().max(500).optional(),
        publishDate: z
          .string()
          .max(50)
          .optional()
          .describe('ISO date or year, e.g. 1965 or 1965-08-01'),
        series: z
          .string()
          .max(500)
          .optional()
          .describe('Empty string removes the book from its series'),
        seriesIndex: z.number().optional(),
        subjects: z
          .array(z.string().max(200))
          .max(50)
          .optional()
          .describe('Replaces the whole list'),
        identifiers: z
          .array(z.object({ scheme: z.string().max(50), value: z.string().max(500) }))
          .max(20)
          .optional()
          .describe('Replaces the whole list, e.g. [{ scheme: "isbn", value: "978…" }]'),
      },
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
        const { bookId, ...fields } = args;
        const data = await executeDocument<Result>(deps.context, DOCUMENT, {
          input: { id: bookId, ...fields },
        });
        const payload = unwrapPayload<{
          __typename: 'BookUpdateMetadataPayload';
          book: { id: string };
        }>(data.bookUpdateMetadata, 'BookUpdateMetadataPayload');
        const book = await fetchBookDetail(deps, payload.book.id);
        return ok(
          `Updated. ${book.id !== bookId ? `New id: ${book.id}\n` : ''}${describeBookDetail(book)}`,
          book
        );
      })
  );
}
