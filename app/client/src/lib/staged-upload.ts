import { apiFetch } from '~/lib/api-fetch';

const ROUTES = {
  cover: '/api/books/cover-staging',
  epub: '/api/books/replace-staging',
} as const;

/** The multipart field name each route's multer instance expects. */
const FIELD = { cover: 'cover', epub: 'file' } as const;

export type StagedKind = keyof typeof ROUTES;

/**
 * Posts bytes to the REST staging seam and resolves the staged upload id.
 *
 * Staging is a PERMANENT REST seam (apollo-client-migration spec §9.1): it is
 * multipart, and GraphQL has no transport for file bytes here. The GraphQL
 * mutations take the returned id instead — `bookUpdateMetadata`'s
 * `stagedCoverId`, `bookReplace`'s staged epub id.
 *
 * Parameterised by kind because step 9's replace flow needs the identical
 * shape against `replace-staging`; this is the first client staging helper in
 * the codebase, so it is built once rather than inlined at the call site.
 *
 * The server gives a staged upload a 30-minute TTL with a lazy sweep and a
 * one-time `consume` (`services/replace-staging.ts`), so bytes staged for a
 * mutation that then fails clean themselves up — callers need no compensation.
 */
export async function stageUpload(
  file: File,
  kind: StagedKind,
  withTargetUser: (url: string) => string = (url) => url
): Promise<string> {
  const body = new FormData();
  body.append(FIELD[kind], file);

  const response = await apiFetch(withTargetUser(ROUTES[kind]), { method: 'POST', body });

  if (!response.ok) {
    let message = `Failed to upload the ${kind === 'cover' ? 'cover image' : 'file'}`;
    try {
      const parsed = (await response.json()) as { error?: string };
      if (parsed.error) message = parsed.error;
    } catch {
      // Non-JSON body (e.g. a proxy error page) — keep the generic message.
    }
    throw new Error(message);
  }

  const { stagedUploadId } = (await response.json()) as { stagedUploadId: string };
  return stagedUploadId;
}
