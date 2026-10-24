import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { z } from 'zod';

import { getStagingDir } from '../../services/book-paths';
import { bytesInputShape, resolveEpubFile } from './bytes-input';
import type { ToolDeps } from './deps';
import { decodeBookId, executeDocument, guarded, NOT_FOUND_BOOK, ok, ToolError } from './execute';
import { unwrapPayload, userErrorFields } from './mutation';
import {
  describeFix,
  FIX_FIELDS,
  metadataFixSchema,
  toFixOut,
  type MetadataFixGql,
} from './shared';

const DOCUMENT = `
  mutation AnalyzeReplace($input: BookAnalyzeReplaceInput!) {
    bookAnalyzeReplace(input: $input) {
      __typename
      ... on BookAnalyzeReplacePayload {
        valid
        messages { severity code message path }
        autoFixes { ${FIX_FIELDS} }
        proposals { ${FIX_FIELDS} }
      }
      ${userErrorFields(['InvalidInputError'])}
    }
  }
`;

type Payload = {
  __typename: 'BookAnalyzeReplacePayload';
  valid: boolean;
  messages: Array<{ severity: string; code: string; message: string; path: string | null }>;
  autoFixes: MetadataFixGql[];
  proposals: MetadataFixGql[];
};

export function registerStageReplacement(server: McpServer, deps: ToolDeps): void {
  server.registerTool(
    'stage_replacement',
    {
      title: 'Stage a replacement file',
      description:
        'Step 1 of replacing a book’s EPUB with a new file: stores the candidate for 30 minutes and ' +
        'analyzes it (validity, epubcheck findings, metadata fixes it would apply or propose) without ' +
        'changing anything. Then call replace_book_file with the returned stagedUploadId.',
      inputSchema: { bookId: z.string(), ...bytesInputShape },
      outputSchema: {
        stagedUploadId: z.string(),
        valid: z.boolean(),
        messages: z.array(
          z.object({
            severity: z.string(),
            code: z.string(),
            message: z.string(),
            path: z.string().nullable(),
          })
        ),
        autoFixes: z.array(metadataFixSchema),
        proposals: z
          .array(metadataFixSchema)
          .describe('Pass chosen keys as acceptedFixKeys to replace_book_file'),
      },
      annotations: {
        readOnlyHint: false,
        destructiveHint: false,
        idempotentHint: false,
        openWorldHint: true,
      },
    },
    (args) =>
      guarded(deps, { write: true }, async () => {
        if (decodeBookId(deps, args.bookId) === null) throw new ToolError(NOT_FOUND_BOOK);
        const file = await resolveEpubFile(args, getStagingDir(deps.config.booksDir));
        const stagedUploadId = deps.replaceStaging.stageFile(
          file.path,
          deps.viewer.userId,
          file.filename
        );
        const data = await executeDocument<{ bookAnalyzeReplace: Payload | null }>(
          deps.context,
          DOCUMENT,
          { input: { id: args.bookId, stagedUploadId } }
        );
        const payload = unwrapPayload<Payload>(
          data.bookAnalyzeReplace,
          'BookAnalyzeReplacePayload'
        );
        const autoFixes = payload.autoFixes.map(toFixOut);
        const proposals = payload.proposals.map(toFixOut);
        const messages = payload.messages.slice(0, 20);
        const text = [
          `Staged as ${stagedUploadId}: ${payload.valid ? 'valid' : 'INVALID — replace_book_file will refuse it'}`,
          ...messages.map((m) => `  ${m.severity} ${m.code}: ${m.message}`),
          ...(autoFixes.length > 0
            ? ['Will apply automatically:', ...autoFixes.map((f) => `  - ${describeFix(f)}`)]
            : []),
          ...(proposals.length > 0
            ? [
                'Proposed (pass keys as acceptedFixKeys):',
                ...proposals.map((f) => `  - ${describeFix(f)}`),
              ]
            : []),
        ].join('\n');
        return ok(text, { stagedUploadId, valid: payload.valid, messages, autoFixes, proposals });
      })
  );
}
