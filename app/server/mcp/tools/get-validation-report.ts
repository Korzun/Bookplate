import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { z } from 'zod';

import type { ToolDeps } from './deps';
import { decodeBookId, executeDocument, guarded, NOT_FOUND_BOOK, ok, ToolError } from './execute';
import {
  clampFirst,
  describeValidation,
  nextCursorOf,
  nextCursorSchema,
  PAGE_INFO_FIELDS,
  toValidationSummary,
  VALIDATION_SUMMARY_FIELDS,
  type PageInfoGql,
  type ValidationSummaryGql,
} from './shared';

const DOCUMENT = `
  query ValidationReport($id: ID!, $first: Int, $after: String) {
    viewer {
      library {
        book(id: $id) {
          title
          validation {
            ${VALIDATION_SUMMARY_FIELDS}
            messages(first: $first, after: $after) {
              ${PAGE_INFO_FIELDS}
              edges { node { seq code severity message path line column } }
            }
          }
        }
      }
    }
  }
`;

type MessageGql = {
  seq: number;
  code: string;
  severity: string;
  message: string;
  path: string | null;
  line: number | null;
  column: number | null;
};

type Result = {
  viewer: {
    library: {
      book: {
        title: string;
        validation:
          | (ValidationSummaryGql & {
              messages: { pageInfo: PageInfoGql; edges: Array<{ node: MessageGql }> };
            })
          | null;
      } | null;
    } | null;
  };
};

const messageSchema = z.object({
  seq: z.number(),
  code: z.string(),
  severity: z.string(),
  message: z.string(),
  path: z.string().nullable(),
  line: z.number().nullable(),
  column: z.number().nullable(),
});

export function registerGetValidationReport(server: McpServer, deps: ToolDeps): void {
  server.registerTool(
    'get_validation_report',
    {
      title: 'Get a validation report',
      description:
        'The stored EPUB validation report for a book: outcome, threshold, counts by severity, and the messages (paged). ' +
        'Run validate_book first if the book was never validated.',
      inputSchema: {
        bookId: z.string(),
        first: z
          .number()
          .int()
          .min(1)
          .max(100)
          .optional()
          .describe('Messages per page, default 20'),
        after: z.string().optional(),
      },
      outputSchema: {
        valid: z.boolean().nullable(),
        threshold: z.string().nullable(),
        validatedAt: z.string().nullable(),
        counts: z.record(z.string(), z.number()),
        messages: z.array(messageSchema),
        nextCursor: nextCursorSchema,
      },
      annotations: { readOnlyHint: true, idempotentHint: true, openWorldHint: false },
    },
    (args) =>
      guarded(deps, {}, async () => {
        if (decodeBookId(deps, args.bookId) === null) throw new ToolError(NOT_FOUND_BOOK);
        const data = await executeDocument<Result>(deps.context, DOCUMENT, {
          id: args.bookId,
          first: clampFirst(args.first, 20, 100),
          after: args.after,
        });
        const book = data.viewer.library?.book ?? null;
        if (book === null) throw new ToolError(NOT_FOUND_BOOK);
        if (book.validation === null) {
          return ok(`"${book.title}" has never been validated. Run validate_book first.`, {
            valid: null,
            threshold: null,
            validatedAt: null,
            counts: {},
            messages: [],
            nextCursor: null,
          });
        }
        const summary = toValidationSummary(book.validation);
        const messages = book.validation.messages.edges.map((e) => e.node);
        const nextCursor = nextCursorOf(book.validation.messages.pageInfo);
        const lines = messages.map(
          (m) =>
            `${m.severity} ${m.code}: ${m.message}${m.path ? ` (${m.path}${m.line !== null ? `:${m.line}` : ''})` : ''}`
        );
        const text = [`"${book.title}": ${describeValidation(summary)}`, ...lines].join('\n');
        return ok(text, { ...summary, messages, nextCursor });
      })
  );
}
