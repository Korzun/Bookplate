import AdmZip from 'adm-zip';
import { XMLParser } from 'fast-xml-parser';
import { simplifyContent } from './simplify';
import { transformCover, CoverTransform } from './cover-transform';
import { packEpub } from './epub-zip';

export interface EditionBuildOptions {
  simplify: boolean;
  cover: CoverTransform | null;
}

interface ManifestItem {
  '@_id': string;
  '@_href': string;
  '@_media-type': string;
  '@_properties'?: string;
}

const XHTML_TYPES = new Set(['application/xhtml+xml', 'text/html']);

function joinZipPath(dir: string, href: string): string {
  return dir === '.' ? href : `${dir}/${href}`;
}

function resolveStructure(zip: AdmZip): {
  opfDir: string;
  items: ManifestItem[];
  coverHref: string | null;
} {
  const parser = new XMLParser({
    ignoreAttributes: false,
    isArray: (name) => ['item', 'meta', 'rootfile'].includes(name),
  });

  const container = zip.getEntry('META-INF/container.xml')?.getData().toString('utf8') ?? '';
  const containerXml = parser.parse(container);
  const rootfiles = containerXml?.container?.rootfiles?.rootfile ?? [];
  const opfPath: string = rootfiles[0]?.['@_full-path'] ?? 'content.opf';
  const opfDir = opfPath.includes('/') ? opfPath.slice(0, opfPath.lastIndexOf('/')) : '.';

  const opfXml = parser.parse(zip.getEntry(opfPath)?.getData().toString('utf8') ?? '');
  const pkg = opfXml?.package ?? {};
  const items: ManifestItem[] = pkg?.manifest?.item ?? [];
  const metas = pkg?.metadata?.meta ?? [];

  // Cover detection (mirror epub-parser's fallbacks).
  let coverHref: string | null = null;
  const coverMeta = metas.find((m: Record<string, string>) => m['@_name'] === 'cover');
  if (coverMeta) {
    const item = items.find((i) => i['@_id'] === coverMeta['@_content']);
    if (item) coverHref = item['@_href'];
  }
  if (!coverHref) {
    const byProp = items.find((i) => i['@_properties'] === 'cover-image');
    if (byProp) coverHref = byProp['@_href'];
  }
  if (!coverHref) {
    const byName = items.find(
      (i) => i['@_href'].toLowerCase().includes('cover') && i['@_media-type'].startsWith('image/')
    );
    if (byName) coverHref = byName['@_href'];
  }

  return { opfDir, items, coverHref };
}

/** Build a device-specific EPUB edition: simplify XHTML content and/or replace the cover in place. */
export async function buildEdition(sourcePath: string, opts: EditionBuildOptions): Promise<Buffer> {
  const zip = new AdmZip(sourcePath);
  const { opfDir, items, coverHref } = resolveStructure(zip);

  if (opts.simplify) {
    for (const item of items) {
      if (!XHTML_TYPES.has(item['@_media-type'])) continue;
      const entryPath = joinZipPath(opfDir, item['@_href']);
      const entry = zip.getEntry(entryPath);
      if (!entry) continue;
      const simplified = simplifyContent(item['@_href'], entry.getData().toString('utf8'));
      zip.updateFile(entryPath, Buffer.from(simplified, 'utf8'));
    }
  }

  if (opts.cover && coverHref) {
    const coverPath = joinZipPath(opfDir, coverHref);
    const entry = zip.getEntry(coverPath);
    if (entry) {
      const transformed = await transformCover(entry.getData(), opts.cover);
      zip.updateFile(coverPath, transformed);
    }
  }

  // Repackage via packEpub rather than adm-zip's toBuffer: the latter reorders
  // entries (dropping `mimetype` from first position) and deflates it, which
  // fails epubcheck (PKG-006) and makes edition-store discard the edition.
  const files: Record<string, Uint8Array> = {};
  for (const entry of zip.getEntries()) {
    if (entry.isDirectory) continue;
    files[entry.entryName] = entry.getData();
  }
  return packEpub(files);
}
