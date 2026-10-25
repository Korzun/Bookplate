import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { z } from 'zod';

import { RATING_FIELDS, RATING_NAMES, type RatingFieldName } from '../../services/rating';
import type { ToolDeps } from './deps';
import { decodeBookId, executeDocument, guarded, NOT_FOUND_BOOK, ok, ToolError } from './execute';
import { bookDetailSchema, describeBookDetail, fetchBookDetail } from './get-book';
import { unwrapPayload, userErrorFields } from './mutation';

const DOCUMENT = `
  mutation RateBook($input: BookRateInput!) {
    bookRate(input: $input) {
      __typename
      ... on BookRatePayload { book { id } }
      ${userErrorFields(['InvalidInputError'])}
    }
  }
`;

type Result = {
  bookRate: { __typename: string; book?: { id: string } } | null;
};

const scale = Object.entries(RATING_NAMES)
  .map(([value, name]) => `${value} ${name}`)
  .join(', ');

const FIELD_HELP: Record<RatingFieldName, string> = {
  overall: 'The reader’s gut verdict on the book as a whole, not an average of the others',
  story: 'How good the plot and pacing are',
  characters: 'How good the characters are',
  writing: 'How good the prose and style are',
  ideas: 'How interesting the ideas and themes are',
};

const ratingField = (field: RatingFieldName) =>
  z
    .number()
    .int()
    .min(0)
    .max(5)
    .nullable()
    .optional()
    .describe(
      `${FIELD_HELP[field]}. 1-5 (${scale}); null or 0 clears it; omit to leave it as it is`
    );

export function registerRateBook(server: McpServer, deps: ToolDeps): void {
  server.registerTool(
    'rate_book',
    {
      title: 'Rate a book',
      description:
        `Sets the reader’s ratings on a book, each on a 1-5 scale (${scale}). Rate ${RATING_FIELDS.join(', ')}: ` +
        'story judges plot and pacing, characters the cast, writing the prose, ideas the themes. ' +
        'The overall rating is the reader’s gut verdict, not an average of the others. ' +
        'Omitted fields are left as they are; null (or 0) clears one. Leave a sub-rating unrated ' +
        'when the reader has no opinion on it rather than guessing.',
      inputSchema: {
        bookId: z.string(),
        overall: ratingField('overall'),
        story: ratingField('story'),
        characters: ratingField('characters'),
        writing: ratingField('writing'),
        ideas: ratingField('ideas'),
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
        // GraphQL contract: null clears. 0 is an MCP-only courtesy mapped here.
        const input: Record<string, unknown> = { id: args.bookId };
        for (const field of RATING_FIELDS) {
          const value = args[field];
          if (value === undefined) continue;
          input[field] = value === 0 ? null : value;
        }
        const data = await executeDocument<Result>(deps.context, DOCUMENT, { input });
        const payload = unwrapPayload<{ __typename: 'BookRatePayload'; book: { id: string } }>(
          data.bookRate,
          'BookRatePayload'
        );
        const book = await fetchBookDetail(deps, payload.book.id);
        return ok(`Rated.\n${describeBookDetail(book)}`, book);
      })
  );
}
