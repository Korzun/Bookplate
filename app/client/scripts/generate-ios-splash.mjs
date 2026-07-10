// Generates iOS "Add to Home Screen" launch (splash) images: the app logo
// centered on the manifest background color, one PNG per supported device
// resolution (portrait). iOS only shows a launch image whose matching
// <link rel="apple-touch-startup-image" media="…"> exactly matches the
// device — see the media queries emitted by print-links() below, which are
// mirrored in index.html.
//
// Run from app/client:  node scripts/generate-ios-splash.mjs
import { mkdir, writeFile } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import sharp from 'sharp';

const HERE = dirname(fileURLToPath(import.meta.url));
const ROOT = resolve(HERE, '..');
const LOGO = resolve(ROOT, 'public/favicon.svg');
const OUT_DIR = resolve(ROOT, 'public/splash');

// Manifest background_color.
const BG = { r: 0x0e, g: 0x0f, b: 0x11, alpha: 1 };

// Portrait device set: physical px (w×h) + the CSS metrics iOS matches on.
const DEVICES = [
  // iPhones
  { w: 1290, h: 2796, cssW: 430, cssH: 932, ratio: 3 },
  { w: 1206, h: 2622, cssW: 402, cssH: 874, ratio: 3 },
  { w: 1179, h: 2556, cssW: 393, cssH: 852, ratio: 3 },
  { w: 1170, h: 2532, cssW: 390, cssH: 844, ratio: 3 },
  { w: 1284, h: 2778, cssW: 428, cssH: 926, ratio: 3 },
  { w: 1125, h: 2436, cssW: 375, cssH: 812, ratio: 3 },
  { w: 1242, h: 2688, cssW: 414, cssH: 896, ratio: 3 },
  { w: 828, h: 1792, cssW: 414, cssH: 896, ratio: 2 },
  { w: 750, h: 1334, cssW: 375, cssH: 667, ratio: 2 },
  { w: 1242, h: 2208, cssW: 414, cssH: 736, ratio: 3 },
  // iPads
  { w: 1536, h: 2048, cssW: 768, cssH: 1024, ratio: 2 },
  { w: 1620, h: 2160, cssW: 810, cssH: 1080, ratio: 2 },
  { w: 1640, h: 2360, cssW: 820, cssH: 1180, ratio: 2 },
  { w: 1668, h: 2388, cssW: 834, cssH: 1194, ratio: 2 },
  { w: 2048, h: 2732, cssW: 1024, cssH: 1366, ratio: 2 },
];

async function generate() {
  await mkdir(OUT_DIR, { recursive: true });
  for (const { w, h } of DEVICES) {
    const logoSize = Math.round(Math.min(w, h) * 0.3);
    const logo = await sharp(LOGO).resize(logoSize, logoSize).png().toBuffer();
    const out = resolve(OUT_DIR, `apple-splash-${w}x${h}.png`);
    await sharp({ create: { width: w, height: h, channels: 4, background: BG } })
      .composite([
        {
          input: logo,
          left: Math.round((w - logoSize) / 2),
          top: Math.round((h - logoSize) / 2),
        },
      ])
      .png()
      .toFile(out);
    console.log(`wrote public/splash/apple-splash-${w}x${h}.png`);
  }
}

function printLinks() {
  const lines = DEVICES.map(
    ({ w, h, cssW, cssH, ratio }) =>
      `    <link rel="apple-touch-startup-image" media="screen and (device-width: ${cssW}px) and (device-height: ${cssH}px) and (-webkit-device-pixel-ratio: ${ratio}) and (orientation: portrait)" href="/splash/apple-splash-${w}x${h}.png" />`
  );
  console.log('\n<!-- index.html link tags -->\n' + lines.join('\n'));
}

await generate();
printLinks();
