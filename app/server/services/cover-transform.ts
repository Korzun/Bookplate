import sharp from 'sharp';

export interface CoverTransform {
  width: number | null;
  height: number | null;
  fit: 'contain' | 'cover' | 'fill';
  grayscale: boolean;
}

/**
 * Resize and/or grayscale a cover image. Output format is preserved from the
 * input (no explicit format call), so the EPUB's cover MIME type stays valid.
 */
export async function transformCover(data: Buffer, opts: CoverTransform): Promise<Buffer> {
  let pipeline = sharp(data);
  if (opts.width !== null || opts.height !== null) {
    pipeline = pipeline.resize({
      width: opts.width ?? undefined,
      height: opts.height ?? undefined,
      fit: opts.fit,
    });
  }
  if (opts.grayscale) {
    pipeline = pipeline.grayscale();
  }
  return pipeline.toBuffer();
}
