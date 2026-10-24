import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { z } from 'zod';

import type { ToolDeps } from './deps';
import { decodeBookId, executeDocument, guarded, NOT_FOUND_BOOK, ok, ToolError } from './execute';
import { unwrapPayload } from './mutation';
import {
  describeValidation,
  toValidationSummary,
  VALIDATION_SUMMARY_FIELDS,
  validationSummarySchema,
  type ValidationSummaryGql,
} from './shared';

const DOCUMENT = `
  mutation ValidateBook($input: BookValidateInput!) {
    bookValidate(input: $input) {
      __typename
      ... on BookValidatePayload {
        book { id title }
        validation { ${VALIDATION_SUMMARY_FIELDS} }
      }
    }
  }
`;

type Payload = {
  __typename: 'BookValidatePayload';
  book: { id: string; title: string };
  validation: ValidationSummaryGql;
};

export function registerValidateBook(server: McpServer, deps: ToolDeps): void {
  server.registerTool(
    'validate_book',
    {
      title: 'Validate a book',
      description:
        'Runs the EPUB checker on a book and stores the report. Use get_validation_report for the full message list.',
      inputSchema: { bookId: z.string() },
      outputSchema: {
        bookId: z.string(),
        title: z.string(),
        validation: validationSummarySchema,
      },
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
        const data = await executeDocument<{ bookValidate: Payload | null }>(
          deps.context,
          DOCUMENT,
          {
            input: { id: args.bookId },
          }
        );
        const payload = unwrapPayload<Payload>(data.bookValidate, 'BookValidatePayload');
        const validation = toValidationSummary(payload.validation);
        return ok(`"${payload.book.title}": ${describeValidation(validation)}`, {
          bookId: payload.book.id,
          title: payload.book.title,
          validation,
        });
      })
  );
}
