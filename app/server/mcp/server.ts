/**
 * Builds the per-request `McpServer`. Stateless transport means a fresh
 * instance per POST, with the viewer baked into every tool's closure — there
 * is no session for a tool to look a viewer up in, and nothing to leak
 * between two readers' requests.
 */
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';

import { APP_VERSION } from '../utils/app-version';
import { registerDeleteBook } from './tools/delete-book';
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
import { registerRegenerateChapters } from './tools/regenerate-chapters';
import { registerReplaceBookFile } from './tools/replace-book-file';
import { registerRequestBook } from './tools/request-book';
import { registerResolveMetadataFixes } from './tools/resolve-metadata-fixes';
import { registerSearchLibrary } from './tools/search-library';
import { registerStageReplacement } from './tools/stage-replacement';
import { registerUpdateBookMetadata } from './tools/update-book-metadata';
import { registerUploadBook } from './tools/upload-book';
import { registerValidateBook } from './tools/validate-book';

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

export function registerWriteTools(server: McpServer, deps: ToolDeps): void {
  registerUpdateBookMetadata(server, deps);
  registerValidateBook(server, deps);
  registerResolveMetadataFixes(server, deps);
  registerRegenerateChapters(server, deps);
  registerDeleteBook(server, deps);
  registerRequestBook(server, deps);
  registerUploadBook(server, deps);
  registerStageReplacement(server, deps);
  registerReplaceBookFile(server, deps);
}

export function buildMcpServer(deps: ToolDeps): McpServer {
  const server = new McpServer(
    { name: 'bookplate', version: APP_VERSION },
    { instructions: INSTRUCTIONS }
  );
  registerReadTools(server, deps);
  registerWriteTools(server, deps);
  return server;
}
