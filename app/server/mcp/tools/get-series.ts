import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { decodeGlobalID } from '@pothos/plugin-relay';
import { z } from 'zod';

import type { ToolDeps } from './deps';
import { executeDocument, guarded, ok, ToolError } from './execute';
import {
  BOOK_SUMMARY_FIELDS,
  bookSummarySchema,
  describeBook,
  describeOverall,
  seriesOverallRatingSchema,
  summarizeBook,
  type BookSummaryGql,
} from './shared';

const SERIES_FIELDS = `
  id name author publisher subjects bookCount totalPages totalSize progressPercentage overallRating
  books(first: 100) { edges { node { ${BOOK_SUMMARY_FIELDS} } } }
`;

type SeriesGql = {
  id: string;
  name: string;
  author: string;
  publisher: string;
  subjects: string[];
  bookCount: number;
  totalPages: number;
  totalSize: number;
  progressPercentage: number | null;
  overallRating: number | null;
  books: { edges: Array<{ node: BookSummaryGql }> };
};

const BY_NAME = `
  query SeriesByName($name: String!) {
    viewer { library { seriesByName(name: $name) { ${SERIES_FIELDS} } } }
  }
`;
const BY_ID = `
  query SeriesById($id: ID!) {
    node(id: $id) { __typename ... on Series { ${SERIES_FIELDS} } }
  }
`;

const NOT_FOUND_SERIES = 'No series with that id or name in your library';

const isSeriesGlobalId = (id: string): boolean => {
  try {
    return decodeGlobalID(id).typename === 'Series';
  } catch {
    return false;
  }
};

export function registerGetSeries(server: McpServer, deps: ToolDeps): void {
  server.registerTool(
    'get_series',
    {
      title: 'Get a series',
      description:
        'A series and its books in series order. Pass either `seriesId` (from search_library or list_series) or the exact `name`.',
      inputSchema: {
        seriesId: z.string().optional(),
        name: z.string().max(500).optional(),
      },
      outputSchema: {
        id: z.string(),
        name: z.string(),
        author: z.string(),
        publisher: z.string(),
        subjects: z.array(z.string()),
        bookCount: z.number(),
        totalPages: z.number(),
        totalSize: z.number(),
        progressPercentage: z.number().nullable(),
        overallRating: seriesOverallRatingSchema,
        books: z.array(bookSummarySchema),
      },
      annotations: { readOnlyHint: true, idempotentHint: true, openWorldHint: false },
    },
    (args) =>
      guarded(deps, {}, async () => {
        let series: SeriesGql | null = null;
        if (args.seriesId !== undefined) {
          if (!isSeriesGlobalId(args.seriesId)) throw new ToolError(NOT_FOUND_SERIES);
          const data = await executeDocument<{ node: ({ __typename: string } & SeriesGql) | null }>(
            deps.context,
            BY_ID,
            { id: args.seriesId }
          );
          series = data.node !== null && data.node.__typename === 'Series' ? data.node : null;
        } else if (args.name !== undefined) {
          const data = await executeDocument<{
            viewer: { library: { seriesByName: SeriesGql | null } | null };
          }>(deps.context, BY_NAME, { name: args.name });
          series = data.viewer.library?.seriesByName ?? null;
        } else {
          throw new ToolError('Pass seriesId or name');
        }
        if (series === null) throw new ToolError(NOT_FOUND_SERIES);
        const books = series.books.edges.map(({ node }) => summarizeBook(node));
        const out = {
          id: series.id,
          name: series.name,
          author: series.author,
          publisher: series.publisher,
          subjects: series.subjects,
          bookCount: series.bookCount,
          totalPages: series.totalPages,
          totalSize: series.totalSize,
          progressPercentage: series.progressPercentage,
          overallRating: series.overallRating,
          books,
        };
        const text = [
          [
            `Series "${out.name}" by ${out.author || 'unknown'} — ${out.bookCount} book(s)`,
            ...(out.overallRating === null ? [] : [describeOverall(out.overallRating)]),
            `id=${out.id}`,
          ].join(', '),
          ...books.map((b) => `  ${b.seriesIndex}. ${describeBook(b)}`),
        ].join('\n');
        return ok(text, out);
      })
  );
}
