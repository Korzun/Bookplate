interface CoverUrlOptions {
  width?: number;
  /**
   * Cache-busting version token — typically the book's `mtime`. When supplied, the
   * cover endpoint serves the image with a long-lived immutable cache header, so the
   * browser reuses it with no network request until the version changes.
   */
  version?: string | number;
}

/**
 * Builds the cover image URL for a book, including an optional thumbnail width and a
 * cache-busting version token. Wrap the result in `withTargetUser` to scope it to an
 * admin's selected library.
 */
export function coverUrl(bookId: string, { width, version }: CoverUrlOptions = {}): string {
  const params = new URLSearchParams();
  if (width) params.set('width', String(width));
  if (version != null) params.set('v', versionToken(version));
  const query = params.toString();
  return `/api/books/${encodeURIComponent(bookId)}/cover${query ? `?${query}` : ''}`;
}

function versionToken(version: string | number): string {
  const ms = typeof version === 'number' ? version : Date.parse(version);
  return Number.isFinite(ms) ? String(Math.floor(ms)) : String(version);
}
