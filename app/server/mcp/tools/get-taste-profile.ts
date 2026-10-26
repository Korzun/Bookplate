import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { z } from 'zod';

import type { ToolDeps } from './deps';
import { executeDocument, guarded, ok } from './execute';
import {
  BOOK_SUMMARY_FIELDS,
  bookSummarySchema,
  describeBook,
  describeRating,
  summarizeBook,
  type BookSummaryGql,
} from './shared';

const DOCUMENT = `
  query TasteProfile($minOverall: Int!, $first: Int!) {
    viewer {
      library {
        ratingProfile {
          ratedCount
          fields { field count mean distribution }
          favourites(minOverall: $minOverall, first: $first) {
            ${BOOK_SUMMARY_FIELDS}
          }
        }
      }
    }
  }
`;

type FieldGql = { field: string; count: number; mean: number | null; distribution: number[] };

type Result = {
  viewer: {
    library: {
      ratingProfile: {
        ratedCount: number;
        fields: FieldGql[];
        favourites: BookSummaryGql[];
      };
    } | null;
  };
};

const titleCase = (s: string): string => s.charAt(0) + s.slice(1).toLowerCase();

export function registerGetTasteProfile(server: McpServer, deps: ToolDeps): void {
  server.registerTool(
    'get_taste_profile',
    {
      title: 'Get your taste profile',
      description:
        'Read before recommending. The means and the distribution show which sources of ' +
        'enjoyment the reader scores highest; the favourites show, book by book, what carried ' +
        "the reader's best reads. Combine with search_library and get_book for subjects and " +
        'descriptions.',
      inputSchema: {
        minOverall: z
          .number()
          .int()
          .min(1)
          .max(5)
          .default(5)
          .describe('Lowest overall rating that counts as a favourite (default 5)'),
        first: z
          .number()
          .int()
          .min(1)
          .max(100)
          .default(25)
          .describe('How many favourites to list (default 25)'),
      },
      outputSchema: {
        ratedCount: z.number().describe('Books with an overall rating'),
        fields: z.array(
          z.object({
            field: z.string(),
            count: z.number(),
            mean: z.number().nullable(),
            distribution: z.array(z.number()).describe('Counts of ratings 1..5'),
          })
        ),
        favourites: z.array(bookSummarySchema),
      },
      annotations: { readOnlyHint: true, idempotentHint: true, openWorldHint: false },
    },
    (args) =>
      guarded(deps, {}, async () => {
        const data = await executeDocument<Result>(deps.context, DOCUMENT, {
          minOverall: args.minOverall,
          first: args.first,
        });
        const profile = data.viewer.library?.ratingProfile ?? {
          ratedCount: 0,
          fields: [],
          favourites: [],
        };
        const favourites = profile.favourites.map(summarizeBook);
        // The text rounds the mean to one decimal; structuredContent keeps the exact value.
        const lines = profile.fields.map(
          (f) =>
            `${titleCase(f.field)}: ${f.count} rated, mean ${f.mean === null ? '—' : f.mean.toFixed(1)}, 1/2/3/4/5 = ${f.distribution.join('/')}`
        );
        lines.push('', `Favourites (overall ≥ ${args.minOverall}):`);
        if (favourites.length === 0) lines.push('  none');
        for (const b of favourites) {
          lines.push(describeBook(b), `    ${describeRating(b.rating)}`);
        }
        return ok(lines.join('\n'), {
          ratedCount: profile.ratedCount,
          fields: profile.fields,
          favourites,
        });
      })
  );
}
