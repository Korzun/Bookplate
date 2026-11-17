import * as fs from 'fs';
import * as path from 'path';

import { unzipSync, strToU8, strFromU8 } from 'fflate';

import { parseEpub } from '../services/epub-parser';
import { buildUpdatedEpub } from '../services/epub-writer';
import { packEpub } from '../services/epub-zip';
import { serverRootFrom } from '../utils/server-root';

/** Directory holding the bundled CC0 fixture EPUBs (tsx and compiled `dist/`). */
export function demoFixturesDir(): string {
  return path.join(serverRootFrom(__dirname), 'demo-seed', 'fixtures');
}

export const FIXTURES = {
  princessOfMars: 'edgar-rice-burroughs_a-princess-of-mars.epub',
  godsOfMars: 'edgar-rice-burroughs_the-gods-of-mars.epub',
  warlordOfMars: 'edgar-rice-burroughs_the-warlord-of-mars.epub',
  prideAndPrejudice: 'jane-austen_pride-and-prejudice.epub',
  frankenstein: 'mary-shelley_frankenstein.epub',
  timeMachine: 'h-g-wells_the-time-machine.epub',
  dracula: 'bram-stoker_dracula.epub',
  sherlockHolmes: 'arthur-conan-doyle_the-adventures-of-sherlock-holmes.epub',
} as const;

function readEntries(src: string): Record<string, Uint8Array> {
  return unzipSync(new Uint8Array(fs.readFileSync(src)));
}

function findOpfPath(files: Record<string, Uint8Array>): string {
  const container = strFromU8(files['META-INF/container.xml']);
  const m = /full-path="([^"]+)"/.exec(container);
  if (!m) throw new Error('container.xml has no rootfile');
  return m[1];
}

/**
 * Copy of `src` with the cover image file, its manifest item and the `cover`
 * meta / `cover-image` property removed.
 *
 * No parser change was needed: `parseEpub` finds covers by `<meta name="cover">`,
 * then `properties="cover-image"`, then any image whose href contains "cover".
 * The Standard Ebooks fixtures have exactly one such image, so with it gone no
 * strategy matches and no other image is substituted.
 */
export function deriveNoCover(src: string, dest: string): void {
  const files = readEntries(src);
  const opfPath = findOpfPath(files);
  const opfDir = path.posix.dirname(opfPath);
  let opf = strFromU8(files[opfPath]);

  const coverItem = /<item\b[^>]*\bproperties="cover-image"[^>]*\/>/.exec(opf);
  if (!coverItem) throw new Error('fixture has no cover-image manifest item');
  const href = /\bhref="([^"]+)"/.exec(coverItem[0])![1];
  const id = /\bid="([^"]+)"/.exec(coverItem[0])![1];

  opf = opf.replace(coverItem[0], '');
  opf = opf.replace(new RegExp(`<meta\\s+name="cover"\\s+content="${id}"\\s*/>`), '');
  files[opfPath] = strToU8(opf);
  delete files[opfDir === '.' ? href : `${opfDir}/${href}`];
  fs.writeFileSync(dest, packEpub(files));
}

/** Copy of `src` with `dc:title` upper-cased. */
export function deriveAllCapsTitle(src: string, dest: string): void {
  const title = parseEpub(src).title.toUpperCase();
  fs.writeFileSync(dest, buildUpdatedEpub(src, { title }));
}

/**
 * Copy of `src` damaged so the validator reports a WARNING but no ERROR/FATAL.
 *
 * Checked empirically against this validator: an undeclared file in the
 * package is only a USAGE message (not a WARNING), and most other damage
 * (empty dc:description, unknown elements, missing referenced resources,
 * remote images) is an ERROR. An empty `@font-face {}` rule in a stylesheet
 * yields exactly one CSS-019 WARNING and nothing worse.
 */
export function deriveWithWarning(src: string, dest: string): void {
  const files = readEntries(src);
  const cssPath = Object.keys(files).find((name) => name.endsWith('.css'));
  if (!cssPath) throw new Error('fixture has no stylesheet');
  files[cssPath] = strToU8(`${strFromU8(files[cssPath])}\n@font-face {}\n`);
  fs.writeFileSync(dest, packEpub(files));
}
