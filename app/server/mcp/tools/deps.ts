import type { PrismaClient } from '@prisma/client';

import type { Context, Viewer } from '../../graphql/context';
import type { ReplaceStaging } from '../../services/replace-staging';
import type { ThumbnailQueue } from '../../services/thumbnail-queue';
import type { AppConfig } from '../../types';

/**
 * Everything a tool handler may touch, built once per MCP request by
 * `mcp/handler.ts`. `context` is a real GraphQL `Context` for `viewer`, so a
 * tool that runs a document gets the schema's own authorization; the rest is
 * for the two binary seams (upload, replace) and the cover tool, which read
 * services directly because no GraphQL field can carry bytes.
 */
export type ToolDeps = {
  context: Context;
  viewer: Viewer & { userId: string };
  scopes: string[];
  prisma: PrismaClient;
  config: AppConfig;
  replaceStaging: ReplaceStaging;
  thumbnails: ThumbnailQueue;
  editionsRoot: string;
  /** `isSetupComplete(viewer)` — false makes every tool answer the setup message. */
  setupComplete: boolean;
};
