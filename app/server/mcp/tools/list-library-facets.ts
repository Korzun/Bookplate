import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { z } from 'zod';

import type { ToolDeps } from './deps';
import { executeDocument, guarded, ok } from './execute';

const DOCUMENT = `query LibraryFacets { viewer { library { authors subjects } } }`;

export function registerListLibraryFacets(server: McpServer, deps: ToolDeps): void {
  server.registerTool(
    'list_library_facets',
    {
      title: 'List authors and subjects',
      description:
        'Every author and subject present in your library — the values search_library’s `author` and `subjects` filters accept.',
      inputSchema: {},
      outputSchema: { authors: z.array(z.string()), subjects: z.array(z.string()) },
      annotations: { readOnlyHint: true, idempotentHint: true, openWorldHint: false },
    },
    () =>
      guarded(deps, {}, async () => {
        const data = await executeDocument<{
          viewer: { library: { authors: string[]; subjects: string[] } | null };
        }>(deps.context, DOCUMENT);
        const authors = data.viewer.library?.authors ?? [];
        const subjects = data.viewer.library?.subjects ?? [];
        return ok(
          `Authors: ${authors.join(', ') || '—'}\nSubjects: ${subjects.join(', ') || '—'}`,
          {
            authors,
            subjects,
          }
        );
      })
  );
}
