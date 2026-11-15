import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { z } from 'zod';

import { MAX_LINK_UPLOAD_BYTES } from '../../services/upload-slots';
import type { ToolDeps } from './deps';
import { guarded, ok } from './execute';

export function registerCreateUploadLink(server: McpServer, deps: ToolDeps): void {
  server.registerTool(
    'create_upload_link',
    {
      title: 'Create an upload link',
      description:
        'Gets a one-time link for uploading an EPUB (up to 50 MB) from a machine with a shell, so the file never has to pass through the conversation. PUT the file to uploadUrl (the curl field is a ready command), then call upload_book or stage_replacement with uploadId. The link works once and expires in 15 minutes.',
      inputSchema: {
        filename: z.string().max(255).optional(),
      },
      outputSchema: {
        uploadId: z.string(),
        uploadUrl: z.string(),
        expiresAt: z.string(),
        maxBytes: z.number(),
        curl: z.string(),
      },
      annotations: {
        readOnlyHint: false,
        destructiveHint: false,
        idempotentHint: false,
        openWorldHint: false,
      },
    },
    (args) =>
      guarded(deps, { write: true }, async () => {
        const slot = deps.uploadSlots.create(deps.viewer.userId, args.filename);
        const uploadUrl = new URL('/mcp/uploads/' + slot.token, deps.baseUrl).href;
        const curl = `curl --fail -T "<path-to-file.epub>" "${uploadUrl}"`;
        return ok(`${curl}\nThen call upload_book with uploadId "${slot.uploadId}".`, {
          uploadId: slot.uploadId,
          uploadUrl,
          expiresAt: new Date(slot.expiresAt).toISOString(),
          maxBytes: MAX_LINK_UPLOAD_BYTES,
          curl,
        });
      })
  );
}
