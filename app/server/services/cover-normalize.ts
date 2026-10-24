import sharp from 'sharp';

import { logger } from '../logger';

const log = logger('CoverNormalize');

/**
 * Long-edge cap for the stored cover. Full-size covers are only ever shown at
 * reader resolution, and constrained decoders (e-reader firmware) have pixel
 * limits, so anything larger is resized with `fit: 'inside'`.
 */
export const MAX_COVER_EDGE_PX = 2000;

/**
 * Width an SVG cover is rasterized at. An SVG has no useful intrinsic pixel
 * size, so unlike raster input it IS enlarged to this width (then capped by
 * `MAX_COVER_EDGE_PX` on the long edge like everything else).
 */
export const SVG_RASTER_WIDTH_PX = 1600;

export const JPEG_MIME = 'image/jpeg';

export interface NormalizedCover {
  data: Buffer;
  mime: string | null;
  /**
   * `true` when `data` is known to be a baseline, non-progressive, sRGB JPEG
   * within `MAX_COVER_EDGE_PX` — either passed through or re-encoded. `false`
   * only when sharp could not decode the input, in which case `data`/`mime`
   * are the caller's original values.
   */
  normalized: boolean;
}

/**
 * Normalizes a cover image to the most widely decodable format: a baseline
 * (non-progressive) sRGB JPEG, long edge at most `MAX_COVER_EDGE_PX`.
 *
 * Why: e-reader firmware is the weakest decoder in the chain. Crosspoint 2.0
 * picks its decoder from the URL extension and assumes JPEG, decodes
 * progressive JPEGs at one-eighth resolution, and has no WebP support.
 * Thumbnails are already always JPEG (`thumbnail-queue.ts`); this gives the
 * full stored cover (`Book.coverData`) the same guarantee.
 *
 * Rules:
 * - Already a baseline sRGB (or grayscale) JPEG within the cap: bytes are
 *   returned untouched — no generation loss on the common case. Only the
 *   MIME is corrected to `image/jpeg` if the manifest mislabeled it.
 * - Anything else sharp can decode (progressive JPEG, CMYK JPEG, PNG, GIF,
 *   WebP, SVG, …): re-encoded with sharp's default baseline JPEG output.
 *   EXIF orientation is baked into the pixels (sharp drops the tag on
 *   output), alpha is flattened onto WHITE (sharp's default is black), and the
 *   long edge is capped without enlarging.
 * - Undecodable: the original bytes and MIME are returned with
 *   `normalized: false` and a warning is logged. The cover is never dropped.
 */
export async function normalizeCover(data: Buffer, mime: string | null): Promise<NormalizedCover> {
  let meta: sharp.Metadata;
  try {
    meta = await sharp(data).metadata();
  } catch (err: unknown) {
    log.warn(
      `Could not decode cover (${mime ?? 'unknown MIME'}, ${data.length} bytes); keeping it as-is: ${
        err instanceof Error ? err.message : String(err)
      }`
    );
    return { data, mime, normalized: false };
  }

  const isSvg = meta.format === 'svg';
  const withinCap =
    (meta.width ?? Infinity) <= MAX_COVER_EDGE_PX && (meta.height ?? Infinity) <= MAX_COVER_EDGE_PX;
  const isBaselineJpeg =
    meta.format === 'jpeg' &&
    !meta.isProgressive &&
    (meta.space === 'srgb' || meta.space === 'b-w') &&
    !meta.hasAlpha;
  if (isBaselineJpeg && withinCap) {
    return { data, mime: JPEG_MIME, normalized: true };
  }

  try {
    const encoded = await sharp(data)
      // Bake EXIF orientation into the pixels: output strips the tag.
      .rotate()
      .resize(
        isSvg
          ? { width: SVG_RASTER_WIDTH_PX, height: MAX_COVER_EDGE_PX, fit: 'inside' }
          : {
              width: MAX_COVER_EDGE_PX,
              height: MAX_COVER_EDGE_PX,
              fit: 'inside',
              withoutEnlargement: true,
            }
      )
      .flatten({ background: '#ffffff' })
      .toColourspace('srgb')
      .jpeg()
      .toBuffer();
    return { data: encoded, mime: JPEG_MIME, normalized: true };
  } catch (err: unknown) {
    log.warn(
      `Could not decode cover (${meta.format ?? 'unknown format'}, ${data.length} bytes); keeping it as-is: ${
        err instanceof Error ? err.message : String(err)
      }`
    );
    return { data, mime, normalized: false };
  }
}
