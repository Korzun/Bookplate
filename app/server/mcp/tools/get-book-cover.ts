import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { z } from 'zod';

import { getCover, getThumbnail } from '../../services/book-assets';
import type { ToolDeps } from './deps';
import { decodeBookId, guarded, NOT_FOUND_BOOK, ToolError } from './execute';

/**
 * The one read tool that bypasses GraphQL: no field can carry image bytes,
 * and the REST cover route needs the SPA's JWT. Reads the same stored
 * thumbnail/cover rows that route serves, scoped by the decoded id's owner.
 */
export function registerGetBookCover(server: McpServer, deps: ToolDeps): void {
  server.registerTool(
    'get_book_cover',
    {
      title: 'Get a book cover',
      description:
        'The cover image for a book, as an image. `width` picks a stored thumbnail size when available; otherwise the full cover is returned.',
      inputSchema: {
        bookId: z.string(),
        width: z.number().int().min(1).max(4000).optional(),
      },
      annotations: { readOnlyHint: true, idempotentHint: true, openWorldHint: false },
    },
    (args) =>
      guarded(deps, {}, async () => {
        const bookId = decodeBookId(deps, args.bookId);
        if (bookId === null) throw new ToolError(NOT_FOUND_BOOK);
        const userId = deps.viewer.userId;
        const image =
          (args.width !== undefined
            ? await getThumbnail(deps.prisma, userId, bookId, args.width)
            : null) ?? (await getCover(deps.prisma, userId, bookId));
        if (image === null) throw new ToolError('This book has no cover');
        return {
          content: [
            { type: 'image', data: image.data.toString('base64'), mimeType: image.mime },
            { type: 'text', text: `Cover for book ${args.bookId} (${image.mime})` },
          ],
        };
      })
  );
}
