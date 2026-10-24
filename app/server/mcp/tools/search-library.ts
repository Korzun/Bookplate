import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { z } from 'zod';

import type { ToolDeps } from './deps';
import { executeDocument, guarded, ok } from './execute';
import {
  BOOK_SUMMARY_FIELDS,
  bookSummarySchema,
  clampFirst,
  describeBook,
  describeSeries,
  nextCursorOf,
  nextCursorSchema,
  PAGE_INFO_FIELDS,
  SERIES_SUMMARY_FIELDS,
  seriesSummarySchema,
  summarizeBook,
  summarizeSeries,
  type BookSummaryGql,
  type PageInfoGql,
  type SeriesSummaryGql,
} from './shared';

const DOCUMENT = `
  query SearchLibrary($first: Int, $after: String, $filter: LibraryFilter) {
    viewer {
      library {
        entries(first: $first, after: $after, filter: $filter) {
          ${PAGE_INFO_FIELDS}
          edges {
            node {
              __typename
              ... on Book { ${BOOK_SUMMARY_FIELDS} }
              ... on Series { ${SERIES_SUMMARY_FIELDS} }
            }
          }
        }
      }
    }
  }
`;

type Result = {
  viewer: {
    library: {
      entries: {
        pageInfo: PageInfoGql;
        edges: Array<{
          node:
            | ({ __typename: 'Book' } & BookSummaryGql)
            | ({ __typename: 'Series' } & SeriesSummaryGql);
        }>;
      };
    } | null;
  };
};

export function registerSearchLibrary(server: McpServer, deps: ToolDeps): void {
  server.registerTool(
    'search_library',
    {
      title: 'Search the library',
      description:
        'Lists the books and series in your library, newest-title order, optionally filtered. ' +
        'Books that belong to a series appear as one series entry; use get_series to see its books. ' +
        'Pass `query` for a title/author search; combine with the other filters to narrow.',
      inputSchema: {
        query: z.string().max(200).optional().describe('Free-text search over title and author'),
        author: z.string().max(200).optional(),
        seriesName: z.string().max(200).optional(),
        subjects: z.array(z.string().max(100)).max(20).optional().describe('All must match'),
        status: z.enum(['NOT_STARTED', 'IN_PROGRESS', 'COMPLETED']).optional(),
        entryType: z.enum(['STANDALONE', 'SERIES']).optional(),
        first: z.number().int().min(1).max(50).optional().describe('Page size, default 20'),
        after: z.string().optional().describe('`nextCursor` from a previous page'),
      },
      outputSchema: {
        entries: z.array(z.discriminatedUnion('kind', [bookSummarySchema, seriesSummarySchema])),
        nextCursor: nextCursorSchema,
      },
      annotations: { readOnlyHint: true, idempotentHint: true, openWorldHint: false },
    },
    (args) =>
      guarded(deps, {}, async () => {
        const filter = {
          query: args.query,
          author: args.author,
          seriesName: args.seriesName,
          subjects: args.subjects,
          status: args.status,
          entryType: args.entryType,
        };
        const data = await executeDocument<Result>(deps.context, DOCUMENT, {
          first: clampFirst(args.first, 20, 50),
          after: args.after,
          filter,
        });
        const connection = data.viewer.library?.entries;
        const entries = (connection?.edges ?? []).map(({ node }) =>
          node.__typename === 'Book' ? summarizeBook(node) : summarizeSeries(node)
        );
        const nextCursor = connection ? nextCursorOf(connection.pageInfo) : null;
        const lines = entries.map((e) => (e.kind === 'book' ? describeBook(e) : describeSeries(e)));
        const text =
          entries.length === 0
            ? 'No matching entries.'
            : `${lines.join('\n')}${nextCursor ? '\n(more available — pass after=nextCursor)' : ''}`;
        return ok(text, { entries, nextCursor });
      })
  );
}
