/**
 * Builds the per-request `McpServer`. Stateless transport means a fresh
 * instance per POST, with the viewer baked into every tool's closure — there
 * is no session for a tool to look a viewer up in, and nothing to leak
 * between two readers' requests.
 */
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';

import { APP_VERSION } from '../utils/app-version';
import type { ToolDeps } from './tools/deps';
import { registerGetBook } from './tools/get-book';
import { registerGetBookCover } from './tools/get-book-cover';
import { registerGetSeries } from './tools/get-series';
import { registerGetValidationReport } from './tools/get-validation-report';
import { registerListBookRequests } from './tools/list-book-requests';
import { registerListLibraryFacets } from './tools/list-library-facets';
import { registerListPendingFixes } from './tools/list-pending-fixes';
import { registerListReadingProgress } from './tools/list-reading-progress';
import { registerListSeries } from './tools/list-series';
import { registerSearchLibrary } from './tools/search-library';

export type { ToolDeps } from './tools/deps';

const INSTRUCTIONS =
  'Bookplate is a personal EPUB library. Ids returned by one tool are the ids every other tool takes; ' +
  'a book id changes when its file is rewritten (metadata edits, replacements), so re-read a book after ' +
  'editing it rather than reusing the old id. Read tools never change anything; write tools need a ' +
  'connection that was approved with write access.';

export function registerReadTools(server: McpServer, deps: ToolDeps): void {
  registerSearchLibrary(server, deps);
  registerGetBook(server, deps);
  registerGetSeries(server, deps);
  registerListSeries(server, deps);
  registerListLibraryFacets(server, deps);
  registerListPendingFixes(server, deps);
  registerGetValidationReport(server, deps);
  registerListReadingProgress(server, deps);
  registerGetBookCover(server, deps);
  registerListBookRequests(server, deps);
}

export function buildMcpServer(deps: ToolDeps): McpServer {
  const server = new McpServer(
    { name: 'bookplate', version: APP_VERSION },
    { instructions: INSTRUCTIONS }
  );
  registerReadTools(server, deps);
  return server;
}
