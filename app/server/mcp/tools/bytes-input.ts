/**
 * The two ways an assistant can hand this server an EPUB: inline base64 (for
 * a file the assistant already holds, bounded by `/mcp`'s 8 MB body limit)
 * or a public https URL this server downloads through `fetchEpub`'s guard.
 * Exactly one must be given.
 */
import { z } from 'zod';

import { fetchEpub, FetchEpubError, type FetchEpubOptions } from '../fetch-epub';
import { ToolError } from './execute';

/** Decoded size cap for inline content — what fits in an 8 MB JSON body. */
export const MAX_INLINE_BYTES = 6 * 1024 * 1024;

export const bytesInputShape = {
  url: z
    .string()
    .max(2000)
    .optional()
    .describe('Public https URL of an .epub to download (this server fetches it)'),
  contentBase64: z
    .string()
    .max(Math.ceil((MAX_INLINE_BYTES * 4) / 3) + 4)
    .optional()
    .describe('The EPUB bytes, base64-encoded; up to about 6 MB decoded'),
  filename: z
    .string()
    .max(255)
    .optional()
    .describe('Original file name; used for the title when the EPUB has none'),
};

export type BytesInput = {
  url?: string | undefined;
  contentBase64?: string | undefined;
  filename?: string | undefined;
};

const FETCH_MESSAGES: Record<FetchEpubError['code'], string> = {
  invalid_url: 'That is not a valid https URL',
  private_host: 'That host is not reachable from here',
  too_many_redirects: 'That URL redirected too many times',
  too_large: 'That file is larger than the 200 MB upload limit',
  not_epub: 'That URL did not return an EPUB file',
  http_error: 'That URL could not be downloaded',
  timeout: 'Downloading that URL took too long',
};

export async function resolveBytes(
  input: BytesInput,
  fetchOptions?: FetchEpubOptions
): Promise<{ bytes: Buffer; filename: string }> {
  const hasUrl = input.url !== undefined && input.url !== '';
  const hasInline = input.contentBase64 !== undefined && input.contentBase64 !== '';
  if (hasUrl === hasInline) throw new ToolError('Pass exactly one of url or contentBase64');

  if (hasUrl) {
    try {
      const fetched = await fetchEpub(input.url!, fetchOptions);
      return { bytes: fetched.bytes, filename: input.filename ?? fetched.filename };
    } catch (err) {
      if (err instanceof FetchEpubError) {
        throw new ToolError(`${FETCH_MESSAGES[err.code]} (${err.message})`);
      }
      throw err;
    }
  }

  const bytes = Buffer.from(input.contentBase64!, 'base64');
  if (bytes.length === 0) throw new ToolError('contentBase64 did not decode to any bytes');
  if (bytes.length > MAX_INLINE_BYTES) {
    throw new ToolError('Inline content is limited to about 6 MB; pass a url instead');
  }
  const filename = input.filename?.trim() || 'upload.epub';
  return {
    bytes,
    filename: filename.toLowerCase().endsWith('.epub') ? filename : `${filename}.epub`,
  };
}
