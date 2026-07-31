#!/usr/bin/env node
/**
 * Regenerates every raster derived from the brand SVGs, then mirrors the ones the
 * web client serves into app/client/public.
 *
 * The SVGs in brand/svg (plus brand/favicon.svg) are the source of truth — edit
 * those, then run `node scripts/generate-brand-icons.mjs`. The line-art rasters
 * (mark-*.png, crest-*.png) are not produced here: they carry no tile colour, so
 * nothing in this pipeline changes them.
 */
import { Buffer } from 'node:buffer';
import { copyFile, mkdir, writeFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

import sharp from 'sharp';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const BRAND = join(ROOT, 'brand');
const PUBLIC = join(ROOT, 'app/client/public');

// brand/README.md: engraving ink, paper, page dark
const PAPER = '#F5F5F7';
const PAGE_DARK = '#0E0F11';

// Rendered bounds of the crest inside its 512 viewBox, so it can be placed by its
// visual edge rather than by the padding around it.
const CREST_BOX = { x: 145.5, y: 87.5, w: 221, h: 337 };

// Splash proportions of the assets they replace: crest height as a fraction of the
// short edge. The two families were authored at slightly different weights; keeping
// each one's own value means the layouts do not shift.
const BRAND_SPLASH_SCALE = 0.338;
const APPLE_SPLASH_SCALE = 0.3;

const ICON_SIZES = [16, 32, 48, 64, 128, 180, 192, 256, 512, 1024];
const APPLE_SPLASH_SIZES = [
  [750, 1334], [828, 1792], [1125, 2436], [1170, 2532], [1179, 2556],
  [1206, 2622], [1242, 2208], [1242, 2688], [1284, 2778], [1290, 2796],
  [1536, 2048], [1620, 2160], [1640, 2360], [1668, 2388], [2048, 2732],
];

const svg = (name) => join(BRAND, name);
const render = (src, w, h = w) =>
  sharp(src, { density: 600 }).resize(w, h).png({ compressionLevel: 9 }).toBuffer();

const write = async (path, buf) => {
  await mkdir(dirname(path), { recursive: true });
  await writeFile(path, buf);
};

/**
 * The crest line art, recoloured and cropped to its own bounds, at a given height.
 */
const crest = async (color, height) => {
  const source = await sharp(svg('svg/bookplate-crest.svg')).metadata();
  if (!source.width) throw new Error('crest svg has no intrinsic size');
  const { readFile } = await import('node:fs/promises');
  const art = (await readFile(svg('svg/bookplate-crest.svg'), 'utf8'))
    .replace(/currentColor/g, color)
    .replace(/<svg[^>]*>/, `<svg xmlns="http://www.w3.org/2000/svg" viewBox="${CREST_BOX.x} ${CREST_BOX.y} ${CREST_BOX.w} ${CREST_BOX.h}">`);
  const width = Math.round((height * CREST_BOX.w) / CREST_BOX.h);
  return sharp(Buffer.from(art), { density: 600 }).resize(width, height).png().toBuffer();
};

/** A launch screen: the crest centred on a flat background. */
const splash = async (width, height, background, color, scale) => {
  const art = await crest(color, Math.round(Math.min(width, height) * scale));
  const { width: aw, height: ah } = await sharp(art).metadata();
  return sharp({ create: { width, height, channels: 4, background } })
    .composite([{ input: art, left: Math.round((width - aw) / 2), top: Math.round((height - ah) / 2) }])
    .png({ compressionLevel: 9 })
    .toBuffer();
};

/**
 * A .ico holding 32bpp BGRA bitmaps — the same layout as the file it replaces.
 * Each image is a BITMAPINFOHEADER, bottom-up BGRA rows, then an all-zero AND mask
 * (padded to 4 bytes per row) which .ico still requires even when alpha is present.
 */
const ico = async (source, sizes) => {
  const images = await Promise.all(
    sizes.map(async (size) => {
      const { data } = await sharp(source, { density: 600 })
        .resize(size, size)
        .ensureAlpha()
        .raw()
        .toBuffer({ resolveWithObject: true });

      const header = Buffer.alloc(40);
      header.writeUInt32LE(40, 0);
      header.writeInt32LE(size, 4);
      header.writeInt32LE(size * 2, 8); // XOR bitmap + AND mask
      header.writeUInt16LE(1, 12);
      header.writeUInt16LE(32, 14);

      const xor = Buffer.alloc(size * size * 4);
      for (let y = 0; y < size; y += 1) {
        for (let x = 0; x < size; x += 1) {
          const from = (y * size + x) * 4;
          const to = ((size - 1 - y) * size + x) * 4; // .ico rows run bottom-up
          xor[to] = data[from + 2];
          xor[to + 1] = data[from + 1];
          xor[to + 2] = data[from];
          xor[to + 3] = data[from + 3];
        }
      }

      const maskStride = Math.ceil(size / 32) * 4;
      return { size, body: Buffer.concat([header, xor, Buffer.alloc(maskStride * size)]) };
    }),
  );

  const dir = Buffer.alloc(6);
  dir.writeUInt16LE(0, 0);
  dir.writeUInt16LE(1, 2); // 1 = icon
  dir.writeUInt16LE(images.length, 4);

  let offset = 6 + images.length * 16;
  const entries = images.map(({ size, body }) => {
    const entry = Buffer.alloc(16);
    entry.writeUInt8(size % 256, 0);
    entry.writeUInt8(size % 256, 1);
    entry.writeUInt16LE(1, 4);
    entry.writeUInt16LE(32, 6);
    entry.writeUInt32LE(body.length, 8);
    entry.writeUInt32LE(offset, 12);
    offset += body.length;
    return entry;
  });

  return Buffer.concat([dir, ...entries, ...images.map((i) => i.body)]);
};

const written = [];
const emit = async (path, buf) => {
  await write(path, buf);
  written.push(path.replace(`${ROOT}/`, ''));
};

// ── tiles ────────────────────────────────────────────────────────────────────
for (const size of ICON_SIZES) {
  await emit(join(BRAND, `png/icon-${size}.png`), await render(svg('svg/bookplate-icon.svg'), size));
}
await emit(join(BRAND, 'png/apple-touch-icon-180.png'), await render(svg('svg/bookplate-icon.svg'), 180));
await emit(join(BRAND, 'png/icon-maskable-512.png'), await render(svg('svg/bookplate-icon-maskable.svg'), 512));
await emit(join(BRAND, 'png/icon-crest-512.png'), await render(svg('svg/bookplate-icon-crest.svg'), 512));

// Home Assistant add-on root: a square tile and a wide banner.
await emit(join(BRAND, 'png/ha-icon-256.png'), await render(svg('svg/bookplate-icon.svg'), 256));
await emit(join(BRAND, 'png/ha-logo-720x200.png'), await render(svg('svg/bookplate-logo.svg'), 720, 200));

// ── favicon ──────────────────────────────────────────────────────────────────
await emit(join(BRAND, 'favicon.ico'), await ico(svg('favicon.svg'), [16, 32, 48]));

// ── launch screens ───────────────────────────────────────────────────────────
await emit(join(BRAND, 'png/splash-dark-1600x1000.png'), await splash(1600, 1000, PAGE_DARK, PAPER, BRAND_SPLASH_SCALE));
await emit(join(BRAND, 'png/splash-light-1600x1000.png'), await splash(1600, 1000, '#FFFFFF', '#0b1f3a', BRAND_SPLASH_SCALE));
for (const [w, h] of APPLE_SPLASH_SIZES) {
  await emit(join(PUBLIC, `splash/apple-splash-${w}x${h}.png`), await splash(w, h, PAGE_DARK, PAPER, APPLE_SPLASH_SCALE));
}

// ── what the web client serves ───────────────────────────────────────────────
const MIRRORED = [
  ['favicon.ico', 'favicon.ico'],
  ['favicon.svg', 'favicon.svg'],
  ['png/apple-touch-icon-180.png', 'apple-touch-icon-180.png'],
  ['png/icon-192.png', 'png/icon-192.png'],
  ['png/icon-512.png', 'png/icon-512.png'],
  ['png/icon-maskable-512.png', 'png/icon-maskable-512.png'],
];
for (const [from, to] of MIRRORED) {
  await mkdir(dirname(join(PUBLIC, to)), { recursive: true });
  await copyFile(join(BRAND, from), join(PUBLIC, to));
  written.push(join(PUBLIC, to).replace(`${ROOT}/`, ''));
}

// ── the add-on root ──────────────────────────────────────────────────────────
await copyFile(join(BRAND, 'png/ha-icon-256.png'), join(ROOT, 'icon.png'));
await copyFile(join(BRAND, 'png/ha-logo-720x200.png'), join(ROOT, 'logo.png'));
written.push('icon.png', 'logo.png');

console.log(`${written.length} files written`);
for (const path of written) console.log(`  ${path}`);
