import sharp from 'sharp';
import type { Mock } from 'vitest';

import { logger } from '../logger';
import { MAX_COVER_EDGE_PX, normalizeCover, SVG_RASTER_WIDTH_PX } from './cover-normalize';

vi.mock('../logger');

// Captured once at module load: `logger('CoverNormalize')` runs exactly once,
// when `cover-normalize.ts` is first imported, and vite.config.ts's
// `mockReset: true` would clear that call out of `logger`'s history before
// the first test otherwise (same pattern as `cost-limit-integration.test.ts`).
const warnSpy = ((): Mock => {
  const mocked = vi.mocked(logger);
  const index = mocked.mock.calls.findIndex(([namespace]) => namespace === 'CoverNormalize');
  if (index === -1) throw new Error("logger('CoverNormalize') was never called");
  const instance = mocked.mock.results[index].value as { warn: Mock };
  return instance.warn;
})();

type Rgb = { r: number; g: number; b: number; alpha?: number };

function solid(width: number, height: number, background: Rgb, channels: 3 | 4 = 3) {
  return sharp({ create: { width, height, channels, background } });
}

const RED: Rgb = { r: 200, g: 0, b: 0 };

describe('normalizeCover — baseline JPEG input', () => {
  it('returns the bytes untouched', async () => {
    const input = await solid(120, 180, RED).jpeg().toBuffer();
    const out = await normalizeCover(input, 'image/jpeg');
    expect(out.data.equals(input)).toBe(true);
    expect(out.mime).toBe('image/jpeg');
    expect(out.normalized).toBe(true);
  });

  it('corrects a mislabeled MIME to image/jpeg without touching the bytes', async () => {
    const input = await solid(120, 180, RED).jpeg().toBuffer();
    const out = await normalizeCover(input, 'image/png');
    expect(out.data.equals(input)).toBe(true);
    expect(out.mime).toBe('image/jpeg');
  });

  it('still caps an oversized baseline JPEG', async () => {
    const input = await solid(MAX_COVER_EDGE_PX + 400, 600, RED)
      .jpeg()
      .toBuffer();
    const out = await normalizeCover(input, 'image/jpeg');
    const meta = await sharp(out.data).metadata();
    expect(meta.format).toBe('jpeg');
    expect(meta.width).toBe(MAX_COVER_EDGE_PX);
    expect(meta.height).toBe(500);
  });
});

describe('normalizeCover — re-encoded inputs', () => {
  it('turns a progressive JPEG into a baseline JPEG', async () => {
    const input = await solid(120, 180, RED).jpeg({ progressive: true }).toBuffer();
    expect((await sharp(input).metadata()).isProgressive).toBe(true);

    const out = await normalizeCover(input, 'image/jpeg');
    const meta = await sharp(out.data).metadata();
    expect(meta.format).toBe('jpeg');
    expect(meta.isProgressive).toBe(false);
    expect(meta.width).toBe(120);
    expect(meta.height).toBe(180);
    expect(out.mime).toBe('image/jpeg');
    expect(out.normalized).toBe(true);
  });

  it('flattens PNG alpha onto white, not black', async () => {
    // Fully transparent: whatever the flatten background is becomes the whole
    // image, so the resulting luminance is the discriminator.
    const input = await solid(50, 50, { r: 0, g: 0, b: 0, alpha: 0 }, 4).png().toBuffer();
    const out = await normalizeCover(input, 'image/png');
    const meta = await sharp(out.data).metadata();
    expect(meta.format).toBe('jpeg');
    expect(meta.hasAlpha).toBe(false);
    const { channels } = await sharp(out.data).stats();
    for (const c of channels) expect(c.mean).toBeGreaterThan(250);
    expect(out.mime).toBe('image/jpeg');
  });

  it('re-encodes WebP and GIF to JPEG', async () => {
    for (const [buf, mime] of [
      [await solid(40, 60, RED).webp().toBuffer(), 'image/webp'],
      [await solid(40, 60, RED).gif().toBuffer(), 'image/gif'],
    ] as const) {
      const out = await normalizeCover(buf, mime);
      expect((await sharp(out.data).metadata()).format).toBe('jpeg');
      expect(out.mime).toBe('image/jpeg');
      expect(out.normalized).toBe(true);
    }
  });

  it('caps the long edge with fit inside', async () => {
    const input = await solid(3000, 1500, RED).png().toBuffer();
    const out = await normalizeCover(input, 'image/png');
    const meta = await sharp(out.data).metadata();
    expect(meta.width).toBe(2000);
    expect(meta.height).toBe(1000);
  });

  it('does not enlarge a small image', async () => {
    const input = await solid(100, 150, RED).png().toBuffer();
    const out = await normalizeCover(input, 'image/png');
    const meta = await sharp(out.data).metadata();
    expect(meta.width).toBe(100);
    expect(meta.height).toBe(150);
  });

  it('bakes EXIF orientation into the pixels when re-encoding', async () => {
    const input = await solid(100, 50, RED)
      .jpeg({ progressive: true })
      .withMetadata({ orientation: 6 })
      .toBuffer();
    const out = await normalizeCover(input, 'image/jpeg');
    const meta = await sharp(out.data).metadata();
    expect(meta.width).toBe(50);
    expect(meta.height).toBe(100);
    expect(meta.orientation).toBeUndefined();
  });

  it('converts a CMYK JPEG to sRGB', async () => {
    const input = await solid(60, 60, RED).toColourspace('cmyk').jpeg().toBuffer();
    expect((await sharp(input).metadata()).space).toBe('cmyk');

    const out = await normalizeCover(input, 'image/jpeg');
    const meta = await sharp(out.data).metadata();
    expect(meta.format).toBe('jpeg');
    expect(meta.space).toBe('srgb');
    expect(out.normalized).toBe(true);
  });

  it('rasterizes SVG at the fixed width', async () => {
    const input = Buffer.from(
      `<svg xmlns="http://www.w3.org/2000/svg" width="100" height="100"><rect width="100" height="100" fill="#c80000"/></svg>`
    );
    const out = await normalizeCover(input, 'image/svg+xml');
    const meta = await sharp(out.data).metadata();
    expect(meta.format).toBe('jpeg');
    expect(meta.width).toBe(SVG_RASTER_WIDTH_PX);
    expect(meta.height).toBe(SVG_RASTER_WIDTH_PX);
    expect(out.mime).toBe('image/jpeg');
  });
});

describe('normalizeCover — undecodable input', () => {
  it('keeps the bytes and MIME, reports not normalized, and warns', async () => {
    const input = Buffer.from('definitely-not-an-image');
    const out = await normalizeCover(input, 'image/jpeg');
    expect(out.data.equals(input)).toBe(true);
    expect(out.mime).toBe('image/jpeg');
    expect(out.normalized).toBe(false);
    expect(warnSpy).toHaveBeenCalledTimes(1);
    expect(warnSpy.mock.calls[0][0]).toMatch(/could not decode/i);
  });

  it('keeps a null MIME as null when it cannot decode', async () => {
    const out = await normalizeCover(Buffer.from('nope'), null);
    expect(out.mime).toBeNull();
    expect(out.normalized).toBe(false);
  });
});
