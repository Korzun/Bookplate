import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { z } from 'zod';

import type { ToolDeps } from './deps';
import { executeDocument, guarded, ok } from './execute';
import {
  describeSeries,
  SERIES_SUMMARY_FIELDS,
  seriesSummarySchema,
  summarizeSeries,
  type SeriesSummaryGql,
} from './shared';

const DOCUMENT = `query ListSeries { viewer { library { series { ${SERIES_SUMMARY_FIELDS} } } } }`;

export function registerListSeries(server: McpServer, deps: ToolDeps): void {
  server.registerTool(
    'list_series',
    {
      title: 'List series',
      description: 'Every series in your library with its author and book count.',
      inputSchema: {},
      outputSchema: { series: z.array(seriesSummarySchema) },
      annotations: { readOnlyHint: true, idempotentHint: true, openWorldHint: false },
    },
    () =>
      guarded(deps, {}, async () => {
        const data = await executeDocument<{
          viewer: { library: { series: SeriesSummaryGql[] } | null };
        }>(deps.context, DOCUMENT);
        const series = (data.viewer.library?.series ?? []).map(summarizeSeries);
        const text = series.length === 0 ? 'No series yet.' : series.map(describeSeries).join('\n');
        return ok(text, { series });
      })
  );
}
