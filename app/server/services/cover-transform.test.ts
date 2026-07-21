import sharp from 'sharp';

import { transformCover } from './cover-transform';

async function redSquare(size = 100): Promise<Buffer> {
  return sharp({
    create: { width: size, height: size, channels: 3, background: { r: 200, g: 0, b: 0 } },
  })
    .jpeg()
    .toBuffer();
}

// A tall white image with a black bar near the top: the only high-detail
// region, so a content-aware crop to a shorter box must keep the top band.
async function barTop(w = 200, h = 600): Promise<Buffer> {
  const bar = await sharp({
    create: { width: w, height: 60, channels: 3, background: { r: 0, g: 0, b: 0 } },
  })
    .png()
    .toBuffer();
  return sharp({
    create: { width: w, height: h, channels: 3, background: { r: 255, g: 255, b: 255 } },
  })
    .composite([{ input: bar, top: 20, left: 0 }])
    .png()
    .toBuffer();
}

describe('transformCover', () => {
  it('resizes to the requested width', async () => {
    const out = await transformCover(await redSquare(), {
      width: 40,
      height: null,
      fit: 'contain',
      grayscale: false,
    });
    const meta = await sharp(out).metadata();
    expect(meta.width).toBe(40);
  });

  it('produces a grayscale image when requested', async () => {
    const out = await transformCover(await redSquare(), {
      width: null,
      height: null,
      fit: 'contain',
      grayscale: true,
    });
    const { dominant } = await sharp(out).stats();
    // A grayscale red square has equal channels.
    expect(Math.abs(dominant.r - dominant.g)).toBeLessThan(8);
    expect(Math.abs(dominant.g - dominant.b)).toBeLessThan(8);
  });

  it('returns bytes unchanged in dimensions when no width/height/grayscale', async () => {
    const out = await transformCover(await redSquare(64), {
      width: null,
      height: null,
      fit: 'contain',
      grayscale: false,
    });
    const meta = await sharp(out).metadata();
    expect(meta.width).toBe(64);
  });
});

describe('transformCover — smart fit', () => {
  it('crops to the exact box and keeps the busy (title) region', async () => {
    const out = await transformCover(await barTop(), {
      width: 200,
      height: 200,
      fit: 'smart',
      grayscale: false,
    });
    const meta = await sharp(out).metadata();
    expect(meta.width).toBe(200);
    expect(meta.height).toBe(200);
    // A blind bottom/centre crop of a top-heavy image would be all white
    // (min ~255). Smart crop keeps the black bar, so black pixels survive.
    const stats = await sharp(out).stats();
    expect(stats.channels[0].min).toBeLessThan(30);
  });

  it('falls back to a proportional resize when only one dimension is set', async () => {
    const out = await transformCover(await barTop(), {
      width: 100,
      height: null,
      fit: 'smart',
      grayscale: false,
    });
    expect((await sharp(out).metadata()).width).toBe(100);
  });

  it('still honors grayscale', async () => {
    const out = await transformCover(await redSquare(100), {
      width: 60,
      height: 60,
      fit: 'smart',
      grayscale: true,
    });
    const { dominant } = await sharp(out).stats();
    expect(Math.abs(dominant.r - dominant.g)).toBeLessThan(8);
    expect(Math.abs(dominant.g - dominant.b)).toBeLessThan(8);
  });
});
