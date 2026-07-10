import sharp from 'sharp';
import { crop } from 'smartcrop-sharp';

export interface CoverTransform {
  width: number | null;
  height: number | null;
  fit: 'contain' | 'cover' | 'fill' | 'smart';
  grayscale: boolean;
}

/**
 * Resize and/or grayscale a cover image. Output format is preserved from the
 * input (no explicit format call), so the EPUB's cover MIME type stays valid.
 *
 * `smart` fills the target box like `cover`, but picks the crop window with
 * smartcrop.js (edge/detail-weighted) instead of the geometric centre, so the
 * title is kept. It needs both dimensions to define the target aspect ratio;
 * with a single dimension it degrades to a proportional resize (no crop), the
 * same as `cover`/`contain` behave with one dimension.
 */
export async function transformCover(data: Buffer, opts: CoverTransform): Promise<Buffer> {
  let pipeline = sharp(data);
  if (opts.width !== null || opts.height !== null) {
    if (opts.fit === 'smart' && opts.width !== null && opts.height !== null) {
      const meta = await sharp(data).metadata();
      const { topCrop } = await crop(data, { width: opts.width, height: opts.height });
      // Clamp against the source in case of off-by-one rounding from smartcrop.
      const left = Math.max(0, topCrop.x);
      const top = Math.max(0, topCrop.y);
      const width = Math.min(topCrop.width, (meta.width ?? topCrop.width) - left);
      const height = Math.min(topCrop.height, (meta.height ?? topCrop.height) - top);
      pipeline = sharp(data).extract({ left, top, width, height }).resize(opts.width, opts.height);
    } else {
      pipeline = pipeline.resize({
        width: opts.width ?? undefined,
        height: opts.height ?? undefined,
        // `smart` with a single dimension has no target aspect to crop to; sharp
        // resizes proportionally regardless of fit, so map it to a valid mode.
        fit: opts.fit === 'smart' ? 'cover' : opts.fit,
      });
    }
  }
  if (opts.grayscale) {
    pipeline = pipeline.grayscale();
  }
  return pipeline.toBuffer();
}
