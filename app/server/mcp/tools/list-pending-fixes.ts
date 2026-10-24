import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { z } from 'zod';

import type { ToolDeps } from './deps';
import { executeDocument, guarded, ok } from './execute';
import {
  describeFix,
  FIX_FIELDS,
  metadataFixSchema,
  toFixOut,
  type MetadataFixGql,
} from './shared';

const DOCUMENT = `
  query PendingFixes {
    viewer {
      library {
        pendingFixes {
          fileName
          book { id title author }
          state { proposals { ${FIX_FIELDS} } }
        }
      }
    }
  }
`;

type Result = {
  viewer: {
    library: {
      pendingFixes: Array<{
        fileName: string;
        book: { id: string; title: string; author: string };
        state: { proposals: MetadataFixGql[] };
      }>;
    } | null;
  };
};

export function registerListPendingFixes(server: McpServer, deps: ToolDeps): void {
  server.registerTool(
    'list_pending_fixes',
    {
      title: 'List metadata recommendations',
      description:
        'Every book with outstanding metadata recommendations from import, and the proposals on each. ' +
        'Act on them with resolve_metadata_fixes.',
      inputSchema: {},
      outputSchema: {
        books: z.array(
          z.object({
            bookId: z.string(),
            title: z.string(),
            author: z.string(),
            fileName: z.string(),
            proposals: z.array(metadataFixSchema),
          })
        ),
      },
      annotations: { readOnlyHint: true, idempotentHint: true, openWorldHint: false },
    },
    () =>
      guarded(deps, {}, async () => {
        const data = await executeDocument<Result>(deps.context, DOCUMENT);
        const books = (data.viewer.library?.pendingFixes ?? [])
          .map((row) => ({
            bookId: row.book.id,
            title: row.book.title,
            author: row.book.author,
            fileName: row.fileName,
            proposals: row.state.proposals.map(toFixOut),
          }))
          .filter((row) => row.proposals.length > 0);
        const text =
          books.length === 0
            ? 'No outstanding recommendations.'
            : books
                .map((b) =>
                  [
                    `"${b.title}" (id=${b.bookId})`,
                    ...b.proposals.map((p) => `  - ${describeFix(p)}`),
                  ].join('\n')
                )
                .join('\n');
        return ok(text, { books });
      })
  );
}
