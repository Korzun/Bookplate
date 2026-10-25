import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { z } from 'zod';

import type { ToolDeps } from './deps';
import { executeDocument, guarded, ok } from './execute';
import {
  BOOK_SUMMARY_FIELDS,
  bookSummarySchema,
  describeBook,
  describeRating,
  RATING_FIELDS_GQL,
  ratingSchema,
  summarizeBook,
  type BookSummaryGql,
  type RatingGql,
} from './shared';

const DOCUMENT = `
  query TasteProfile($minOverall: Int!, $first: Int!) {
    viewer {
      library {
        ratingProfile {
          ratedCount
          fields { field count mean distribution }
          favourites(minOverall: $minOverall, first: $first) {
            ${BOOK_SUMMARY_FIELDS} ${RATING_FIELDS_GQL}
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
        favourites: Array<BookSummaryGql & { rating: RatingGql }>;
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
        'A factual summary of your ratings: for each rating field (overall, story, characters, ' +
        'writing, ideas) how many books you rated, the mean, and the 1-5 distribution, plus your ' +
        'favourite books (overall rating at or above minOverall, most recently rated first). ' +
        'Ratings are 1 Bad, 2 Okay, 3 Nice, 4 Great, 5 Awesome. Use it to ground recommendations ' +
        'in what you actually rated highly.',
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
        favourites: z.array(bookSummarySchema.extend({ rating: ratingSchema })),
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
        const favourites = profile.favourites.map((b) => ({
          ...summarizeBook(b),
          rating: b.rating,
        }));
        const lines = profile.fields.map(
          (f) =>
            `${titleCase(f.field)}: ${f.count} rated, mean ${f.mean ?? '—'}, 1/2/3/4/5 = ${f.distribution.join('/')}`
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
