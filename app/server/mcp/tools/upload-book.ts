import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { z } from 'zod';

import { encodeBookGlobalId } from '../../graphql/schema/node-scope';
import { getStagingDir } from '../../services/book-paths';
import { importEpub } from '../../services/import-epub';
import { bytesInputShape, resolveEpubFile } from './bytes-input';
import type { ToolDeps } from './deps';
import { guarded, ok, ToolError } from './execute';
import { bookDetailSchema, describeBookDetail, fetchBookDetail } from './get-book';
import { describeFix, metadataFixSchema, toFixOut } from './shared';

const describeCounts = (counts: Record<string, number>): string =>
  Object.entries(counts)
    .filter(([, n]) => n > 0)
    .map(([sev, n]) => `${n} ${sev.toLowerCase()}`)
    .join(', ');

export function registerUploadBook(server: McpServer, deps: ToolDeps): void {
  server.registerTool(
    'upload_book',
    {
      title: 'Upload a book',
      description:
        'Adds an EPUB to the library — the same import the web uploader runs: repair, validation, ' +
        'fingerprinting, metadata detection. High-confidence metadata fixes are applied; the rest are ' +
        'returned as proposals you can act on with resolve_metadata_fixes. Give the file as `url` or `contentBase64`.',
      inputSchema: bytesInputShape,
      outputSchema: {
        book: z.object(bookDetailSchema),
        applied: z.array(metadataFixSchema).describe('Fixes applied automatically'),
        proposals: z.array(metadataFixSchema).describe('Fixes left for you to accept or dismiss'),
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
        const file = await resolveEpubFile(args, getStagingDir(deps.config.booksDir));
        const owner = { userId: deps.viewer.userId, username: deps.viewer.username };
        const outcome = await importEpub(
          {
            prisma: deps.prisma,
            config: deps.config,
            editionsRoot: deps.editionsRoot,
            thumbnailQueue: deps.thumbnails,
          },
          owner,
          { path: file.path, originalName: file.filename, size: file.size }
        );
        switch (outcome.kind) {
          case 'parse_failed':
          case 'fingerprint_failed':
            throw new ToolError(outcome.message);
          case 'duplicate':
            throw new ToolError('A book with the same fingerprint is already in the library.');
          case 'invalid': {
            const lines = [
              `EPUB failed validation at threshold ${outcome.validation.threshold} (${describeCounts(outcome.validation.counts)})`,
              ...outcome.validation.messages
                .slice(0, 5)
                .map((m) => `  - ${m.severity} ${m.id}: ${m.message}`),
            ];
            throw new ToolError(lines.join('\n'));
          }
          case 'imported':
            break;
        }
        const book = await fetchBookDetail(deps, encodeBookGlobalId(owner.userId, outcome.bookId));
        const applied = outcome.applied.map((f) => toFixOut({ ...f, reason: f.reason ?? null }));
        const proposals = outcome.proposals.map((f) =>
          toFixOut({ ...f, reason: f.reason ?? null })
        );
        const text = [
          `Imported "${book.title}".`,
          describeBookDetail(book),
          ...(applied.length > 0
            ? ['Applied automatically:', ...applied.map((f) => `  - ${describeFix(f)}`)]
            : []),
          ...(proposals.length > 0
            ? [
                'Proposed (use resolve_metadata_fixes):',
                ...proposals.map((f) => `  - ${describeFix(f)}`),
              ]
            : []),
        ].join('\n');
        return ok(text, { book, applied, proposals });
      })
  );
}
