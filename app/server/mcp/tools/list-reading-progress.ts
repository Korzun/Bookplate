import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { z } from 'zod';

import type { ToolDeps } from './deps';
import { executeDocument, guarded, ok } from './execute';
import {
  clampFirst,
  nextCursorOf,
  nextCursorSchema,
  PAGE_INFO_FIELDS,
  type PageInfoGql,
} from './shared';

const DOCUMENT = `
  query ReadingProgress($first: Int, $after: String) {
    viewer {
      library {
        progress(first: $first, after: $after) {
          ${PAGE_INFO_FIELDS}
          edges {
            node {
              document percentage currentChapter device timestamp
              book { id title author }
            }
          }
        }
      }
    }
  }
`;

type ProgressGql = {
  document: string;
  percentage: number;
  currentChapter: number | null;
  device: string;
  timestamp: string;
  book: { id: string; title: string; author: string } | null;
};

type Result = {
  viewer: {
    library: { progress: { pageInfo: PageInfoGql; edges: Array<{ node: ProgressGql }> } } | null;
  };
};

export function registerListReadingProgress(server: McpServer, deps: ToolDeps): void {
  server.registerTool(
    'list_reading_progress',
    {
      title: 'List reading progress',
      description:
        'The reading positions synced from your e-reader, newest first. A position may name a document that is not in the library (book = null).',
      inputSchema: {
        first: z.number().int().min(1).max(50).optional().describe('Default 20'),
        after: z.string().optional(),
      },
      outputSchema: {
        progress: z.array(
          z.object({
            document: z.string(),
            percentage: z.number(),
            currentChapter: z.number().nullable(),
            device: z.string(),
            timestamp: z.string(),
            bookId: z.string().nullable(),
            title: z.string().nullable(),
            author: z.string().nullable(),
          })
        ),
        nextCursor: nextCursorSchema,
      },
      annotations: { readOnlyHint: true, idempotentHint: true, openWorldHint: false },
    },
    (args) =>
      guarded(deps, {}, async () => {
        const data = await executeDocument<Result>(deps.context, DOCUMENT, {
          first: clampFirst(args.first, 20, 50),
          after: args.after,
        });
        const connection = data.viewer.library?.progress;
        const progress = (connection?.edges ?? []).map(({ node }) => ({
          document: node.document,
          percentage: node.percentage,
          currentChapter: node.currentChapter,
          device: node.device,
          timestamp: node.timestamp,
          bookId: node.book?.id ?? null,
          title: node.book?.title ?? null,
          author: node.book?.author ?? null,
        }));
        const nextCursor = connection ? nextCursorOf(connection.pageInfo) : null;
        const text =
          progress.length === 0
            ? 'No reading progress synced yet.'
            : progress
                .map(
                  (p) =>
                    `${p.title ?? `(unknown document ${p.document})`}: ${Math.round(p.percentage * 100)}% on ${p.device} at ${p.timestamp}`
                )
                .join('\n');
        return ok(text, { progress, nextCursor });
      })
  );
}
