import { zipSync, strToU8, Zippable } from 'fflate';

export const MIMETYPE_PATH = 'mimetype';
export const EPUB_MIMETYPE = 'application/epub+zip';

/**
 * Serialize EPUB entries into an OCF ZIP with the `mimetype` entry written
 * first and stored (uncompressed). The OCF spec requires this and epubcheck
 * rejects violations with PKG-005/PKG-006 — so a naive re-zip that reorders or
 * deflates entries (e.g. adm-zip's `toBuffer`) yields an invalid EPUB. Shared
 * by the metadata writer and the device-edition builder so both package EPUBs
 * the same, correct way.
 */
export function packEpub(files: Record<string, Uint8Array>): Buffer {
  const mimetype = files[MIMETYPE_PATH] ?? strToU8(EPUB_MIMETYPE);
  const out: Zippable = { [MIMETYPE_PATH]: [mimetype, { level: 0 }] };
  for (const [name, data] of Object.entries(files)) {
    if (name === MIMETYPE_PATH) continue;
    out[name] = data;
  }
  return Buffer.from(zipSync(out));
}
