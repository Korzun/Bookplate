import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { z } from 'zod';

import type { ToolDeps } from './deps';
import { decodeBookId, executeDocument, guarded, NOT_FOUND_BOOK, ok, ToolError } from './execute';
import { bookDetailSchema, describeBookDetail, fetchBookDetail } from './get-book';
import { unwrapPayload, userErrorFields } from './mutation';

const DOCUMENT = `
  mutation ResolvePendingFix($input: BookResolvePendingFixInput!) {
    bookResolvePendingFix(input: $input) {
      __typename
      ... on BookResolvePendingFixPayload { book { id } }
      ${userErrorFields(['EpubValidationError', 'BookNotValidatedError', 'BookHashCollisionError'])}
    }
  }
`;

type Result = {
  bookResolvePendingFix: { __typename: string; book?: { id: string } } | null;
};

export function registerResolveMetadataFixes(server: McpServer, deps: ToolDeps): void {
  server.registerTool(
    'resolve_metadata_fixes',
    {
      title: 'Act on metadata recommendations',
      description:
        'Resolves a book’s outstanding metadata recommendations (see get_book or list_pending_fixes). ' +
        'ACCEPT applies them (rewriting the EPUB, so the book gets a new id), DISMISS discards them, ' +
        'UNDO reverts the last ACCEPT or DISMISS, CLEAR drops the recommendation record entirely. ' +
        'ACCEPT and DISMISS take an optional `fixes` list to act on a subset; `key` from the listing is "field:kind:from".',
      inputSchema: {
        bookId: z.string(),
        action: z.enum(['ACCEPT', 'DISMISS', 'UNDO', 'CLEAR']),
        fixes: z
          .array(z.object({ field: z.string(), kind: z.string(), from: z.string() }))
          .max(100)
          .optional()
          .describe('Subset to act on; omit for all'),
      },
      outputSchema: bookDetailSchema,
      annotations: {
        readOnlyHint: false,
        destructiveHint: false,
        idempotentHint: false,
        openWorldHint: false,
      },
    },
    (args) =>
      guarded(deps, { write: true }, async () => {
        if (decodeBookId(deps, args.bookId) === null) throw new ToolError(NOT_FOUND_BOOK);
        const data = await executeDocument<Result>(deps.context, DOCUMENT, {
          input: { id: args.bookId, action: args.action, fixes: args.fixes },
        });
        const payload = unwrapPayload<{
          __typename: 'BookResolvePendingFixPayload';
          book: { id: string };
        }>(data.bookResolvePendingFix, 'BookResolvePendingFixPayload');
        const book = await fetchBookDetail(deps, payload.book.id);
        return ok(`${args.action} done.\n${describeBookDetail(book)}`, book);
      })
  );
}
