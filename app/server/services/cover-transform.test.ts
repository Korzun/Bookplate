import sharp from 'sharp';
import { transformCover } from './cover-transform';

async function redSquare(size = 100): Promise<Buffer> {
  return sharp({
    create: { width: size, height: size, channels: 3, background: { r: 200, g: 0, b: 0 } },
  })
    .jpeg()
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
