import * as fs from 'fs';
import * as crypto from 'crypto';
import * as path from 'path';
import AdmZip from 'adm-zip';
import { XMLParser } from 'fast-xml-parser';
import { EpubMeta } from '../types';

const PARTIAL_MD5_OFFSETS = [
  0, 1024, 4096, 16384, 65536, 262144, 1048576, 4194304, 16777216, 67108864, 268435456, 1073741824,
];

export function partialMD5(filePath: string): string {
  const stat = fs.statSync(filePath);
  const fileSize = stat.size;
  const fd = fs.openSync(filePath, 'r');
  const chunks: Buffer[] = [];
  try {
    for (const offset of PARTIAL_MD5_OFFSETS) {
      if (offset >= fileSize) break;
      const len = Math.min(1024, fileSize - offset);
      const buf = Buffer.alloc(len);
      fs.readSync(fd, buf, 0, len, offset);
      chunks.push(buf);
    }
  } finally {
    fs.closeSync(fd);
  }
  return crypto.createHash('md5').update(Buffer.concat(chunks)).digest('hex');
}

function flattenNavOl(ol: unknown, leafOnly = true): { href: string; title: string }[] {
  if (!ol || typeof ol !== 'object') return [];
  const items = (ol as Record<string, unknown>).li;
  if (!items) return [];
  const result: { href: string; title: string }[] = [];
  for (const item of (Array.isArray(items) ? items : [items]) as Array<Record<string, unknown>>) {
    const aNode = item.a;
    const hasChildren = !!item.ol;
    if (!leafOnly || !hasChildren) {
      if (aNode && typeof aNode === 'object') {
        const href = (aNode as Record<string, string>)['@_href'];
        const title = decodeEntities(((aNode as Record<string, string>)['#text'] ?? '').trim());
        if (href) result.push({ href, title });
      }
    }
    if (item.ol) result.push(...flattenNavOl(item.ol, leafOnly));
  }
  return result;
}

function flattenNcxNavPoints(
  navPoints: unknown[],
  leafOnly = true
): { href: string; title: string }[] {
  const result: { href: string; title: string }[] = [];
  for (const np of navPoints as Array<Record<string, unknown>>) {
    const src = (np.content as Record<string, string> | undefined)?.['@_src'];
    const navLabel = np.navLabel as Record<string, unknown> | undefined;
    const title = decodeEntities(((navLabel?.text as string | undefined) ?? '').trim());
    const hasChildren = !!np.navPoint;
    if (!leafOnly || !hasChildren) {
      if (src) result.push({ href: src, title });
    }
    if (np.navPoint) {
      const nested = Array.isArray(np.navPoint) ? np.navPoint : [np.navPoint];
      result.push(...flattenNcxNavPoints(nested as unknown[], leafOnly));
    }
  }
  return result;
}

const TITLE_DENY_EXACT = new Set([
  'cover',
  'title page',
  'titlepage',
  'copyright',
  'copyright page',
  'dedication',
  'contents',
  'table of contents',
  'toc',
  'acknowledgements',
  'acknowledgments',
  'epigraph',
  'map',
  'maps',
  'halftitle',
  'half title',
  'also by',
  'colophon',
  'dramatis personae',
  'cast of characters',
  'list of characters',
  'what has gone before',
]);

const TITLE_DENY_PREFIXES = ['about the', 'by the same', 'books by'];

function isTitleDenied(title: string): boolean {
  const lower = title.toLowerCase().trim();
  if (TITLE_DENY_EXACT.has(lower)) return true;
  return TITLE_DENY_PREFIXES.some((p) => lower.startsWith(p));
}

const EXCLUDED_EPUB_TYPES = new Set([
  'cover',
  'frontmatter',
  'dedication',
  'halftitle',
  'titlepage',
  'backmatter',
  'acknowledgments',
  'copyright-page',
  'afterword',
  'appendix',
  'index',
  'colophon',
]);

function getDocumentEpubTypes(zip: AdmZip, absHref: string): string[] {
  const entry = zip.getEntry(absHref);
  if (!entry) return [];
  const text = entry.getData().toString('utf8');
  const match =
    /<body(?:\s[^>]*)?\bepub:type="([^"]+)"/.exec(text) ??
    /<section(?:\s[^>]*)?\bepub:type="([^"]+)"/.exec(text);
  return match ? match[1].split(/\s+/) : [];
}

function hrefsToSpineMap(
  entries: { href: string; title: string }[],
  fileDir: string,
  spineHrefToIndex: Map<string, number>
): { spineMap: number[]; names: string[] } {
  const seen = new Set<number>();
  const spineMap: number[] = [];
  const names: string[] = [];
  for (const { href, title } of entries) {
    const rootRel = path.posix.join(fileDir, href.split('#')[0]);
    const idx = spineHrefToIndex.get(rootRel);
    if (idx !== undefined && !seen.has(idx)) {
      seen.add(idx);
      spineMap.push(idx);
      names.push(title);
    }
  }
  return { spineMap, names };
}

function parseNavChapters(
  zip: AdmZip,
  opfDir: string,
  manifest: Array<{
    '@_id': string;
    '@_href': string;
    '@_media-type': string;
    '@_properties'?: string;
  }>,
  spineHrefToIndex: Map<string, number>
): { chapterCount: number; chapterSpineMap: number[]; chapterNames: string[] } {
  const navParser = new XMLParser({
    ignoreAttributes: false,
    attributeNamePrefix: '@_',
    parseTagValue: false,
    isArray: (name) => ['li', 'nav', 'navPoint'].includes(name),
  });

  const spineIndexToAbsHref = new Map<number, string>();
  for (const [href, idx] of spineHrefToIndex) {
    spineIndexToAbsHref.set(idx, href);
  }

  const filterByEpubType = (
    spineMap: number[],
    names: string[]
  ): { spineMap: number[]; names: string[] } => {
    const filteredSpineMap: number[] = [];
    const filteredNames: string[] = [];
    for (let i = 0; i < spineMap.length; i++) {
      const href = spineIndexToAbsHref.get(spineMap[i]);
      if (href) {
        const types = getDocumentEpubTypes(zip, href);
        if (types.some((t) => EXCLUDED_EPUB_TYPES.has(t))) continue;
      }
      filteredSpineMap.push(spineMap[i]);
      filteredNames.push(names[i]);
    }
    return { spineMap: filteredSpineMap, names: filteredNames };
  };

  // Try EPUB 3 nav document
  const navItem = manifest.find((i) => i['@_properties']?.split(' ').includes('nav'));
  if (navItem) {
    const navAbsHref = opfDir === '.' ? navItem['@_href'] : `${opfDir}/${navItem['@_href']}`;
    const navEntry = zip.getEntry(navAbsHref) ?? zip.getEntry(navItem['@_href']);
    if (navEntry) {
      const navDir = navAbsHref.includes('/')
        ? navAbsHref.substring(0, navAbsHref.lastIndexOf('/'))
        : '.';
      const doc = navParser.parse(navEntry.getData().toString('utf8')) as Record<string, unknown>;
      const navList = (doc?.html as Record<string, unknown>)?.body as { nav?: unknown } | undefined;
      const navArr = navList?.nav ? (Array.isArray(navList.nav) ? navList.nav : [navList.nav]) : [];
      const tocNav = (navArr as Array<Record<string, unknown>>).find((n) =>
        ((n['@_epub:type'] as string | undefined) ?? '').split(' ').includes('toc')
      );
      if (tocNav) {
        const entries = flattenNavOl(tocNav.ol);
        const titleFiltered = entries.filter((e) => !isTitleDenied(e.title));
        let { spineMap, names } = hrefsToSpineMap(titleFiltered, navDir, spineHrefToIndex);
        if (spineMap.length === 0 && entries.length > 0) {
          const fbFiltered = flattenNavOl(tocNav.ol, false).filter((e) => !isTitleDenied(e.title));
          ({ spineMap, names } = hrefsToSpineMap(fbFiltered, navDir, spineHrefToIndex));
        }
        const filtered = filterByEpubType(spineMap, names);
        if (filtered.spineMap.length > 0)
          return {
            chapterCount: filtered.spineMap.length,
            chapterSpineMap: filtered.spineMap,
            chapterNames: filtered.names,
          };
      }
    }
  }

  // Fall back to EPUB 2 NCX
  const ncxItem = manifest.find((i) => i['@_media-type'] === 'application/x-dtbncx+xml');
  if (ncxItem) {
    const ncxAbsHref = opfDir === '.' ? ncxItem['@_href'] : `${opfDir}/${ncxItem['@_href']}`;
    const ncxEntry = zip.getEntry(ncxAbsHref) ?? zip.getEntry(ncxItem['@_href']);
    if (ncxEntry) {
      const ncxDir = ncxAbsHref.includes('/')
        ? ncxAbsHref.substring(0, ncxAbsHref.lastIndexOf('/'))
        : '.';
      const doc = navParser.parse(ncxEntry.getData().toString('utf8')) as Record<string, unknown>;
      const navPoints: unknown[] =
        (((doc?.ncx as Record<string, unknown>)?.navMap as Record<string, unknown>)
          ?.navPoint as unknown[]) ?? [];
      const entries = flattenNcxNavPoints(navPoints);
      const titleFiltered = entries.filter((e) => !isTitleDenied(e.title));
      let { spineMap, names } = hrefsToSpineMap(titleFiltered, ncxDir, spineHrefToIndex);
      if (spineMap.length === 0 && entries.length > 0) {
        const fbFiltered = flattenNcxNavPoints(navPoints, false).filter(
          (e) => !isTitleDenied(e.title)
        );
        ({ spineMap, names } = hrefsToSpineMap(fbFiltered, ncxDir, spineHrefToIndex));
      }
      const filtered = filterByEpubType(spineMap, names);
      if (filtered.spineMap.length > 0)
        return {
          chapterCount: filtered.spineMap.length,
          chapterSpineMap: filtered.spineMap,
          chapterNames: filtered.names,
        };
    }
  }

  return { chapterCount: 0, chapterSpineMap: [], chapterNames: [] };
}

type MetaLike = string | { [key: string]: string | undefined };

interface LocalizedValue {
  text: string;
  lang: string;
  fileAs: string;
  id: string;
}

function toLocalizedValue(item: MetaLike): LocalizedValue {
  return typeof item === 'string'
    ? { text: decodeEntities(item), lang: '', fileAs: '', id: '' }
    : {
        text: decodeEntities(item['#text'] ?? ''),
        lang: item['@_xml:lang'] ?? '',
        fileAs: decodeEntities((item['@_file-as'] ?? item['@_opf:file-as'] ?? '').trim()),
        id: item['@_id'] ?? '',
      };
}

function pickLocalized(items: MetaLike[]): LocalizedValue {
  const candidates = items.map(toLocalizedValue);
  return (
    candidates.find((c) => c.lang.toLowerCase().startsWith('en')) ??
    candidates.find((c) => c.lang === '') ??
    candidates[0] ?? { text: '', lang: '', fileAs: '', id: '' }
  );
}

function pickLang(items: MetaLike[]): string {
  return pickLocalized(items).text;
}

function decodeEntities(text: string): string {
  return text
    .replace(/&#(\d+);/g, (_, code) => String.fromCodePoint(parseInt(code, 10)))
    .replace(/&#x([0-9a-fA-F]+);/g, (_, hex) => String.fromCodePoint(parseInt(hex, 16)));
}

const ISO_8601_RE = /^\d{4}(-\d{2}(-\d{2}(T\d{2}:\d{2}(:\d{2}(\.\d+)?)?(Z|[+-]\d{2}:\d{2})?)?)?)?$/;

function inferScheme(value: string): string {
  const lower = value.toLowerCase();
  if (lower.startsWith('urn:isbn:') || lower.startsWith('isbn:')) return 'ISBN';
  if (value.startsWith('978') || value.startsWith('979')) return 'ISBN';
  if (lower.startsWith('urn:uuid:')) return 'UUID';
  return '';
}

export function parseEpub(filePath: string): EpubMeta {
  const zip = new AdmZip(filePath);
  const parser = new XMLParser({
    ignoreAttributes: false,
    attributeNamePrefix: '@_',
    parseTagValue: false,
    isArray: (name) =>
      ['item', 'meta', 'dc:title', 'dc:creator', 'dc:identifier', 'dc:subject'].includes(name),
  });

  // Step 1: container.xml → OPF path
  const containerEntry = zip.getEntry('META-INF/container.xml');
  if (!containerEntry) throw new Error('Missing META-INF/container.xml');
  const containerXml = parser.parse(containerEntry.getData().toString('utf8'));
  const rootfiles = containerXml?.container?.rootfiles?.rootfile;
  const rootfileArr = Array.isArray(rootfiles) ? rootfiles : [rootfiles];
  const opfRelPath: string = rootfileArr[0]?.['@_full-path'];
  if (!opfRelPath) throw new Error('Cannot find OPF rootfile path in container.xml');

  // Step 2: read OPF
  const opfEntry = zip.getEntry(opfRelPath);
  if (!opfEntry) throw new Error(`Cannot find OPF file: ${opfRelPath}`);
  const opf = parser.parse(opfEntry.getData().toString('utf8'));
  const pkg = opf?.package ?? opf;
  const metadata = pkg?.metadata ?? {};
  const manifest: Array<{
    '@_id': string;
    '@_href': string;
    '@_media-type': string;
    '@_properties'?: string;
  }> = pkg?.manifest?.item ?? [];
  const opfDir = path.dirname(opfRelPath);

  // Build spine href → 0-based spine index map (used for chapter detection)
  const rawSpineRefs = pkg?.spine?.itemref ?? [];
  const spineItemRefs: Array<{ '@_idref': string }> = Array.isArray(rawSpineRefs)
    ? (rawSpineRefs as Array<{ '@_idref': string }>)
    : [rawSpineRefs as { '@_idref': string }];
  const hrefByManifestId = new Map<string, string>();
  for (const item of manifest) {
    hrefByManifestId.set(item['@_id'], item['@_href']);
  }
  const spineHrefToIndex = new Map<string, number>();
  for (let i = 0; i < spineItemRefs.length; i++) {
    const href = hrefByManifestId.get(spineItemRefs[i]['@_idref']);
    if (href) {
      spineHrefToIndex.set(opfDir === '.' ? href : `${opfDir}/${href}`, i);
    }
  }
  // Compute Adobe standard page count: 1 page = 1,024 characters (including spaces)
  let totalChars = 0;
  for (const itemRef of spineItemRefs) {
    const href = hrefByManifestId.get(itemRef['@_idref']);
    if (!href) continue;
    const absHref = opfDir === '.' ? href : `${opfDir}/${href}`;
    const entry = zip.getEntry(absHref) ?? zip.getEntry(href);
    if (!entry) continue;
    const text = entry
      .getData()
      .toString('utf8')
      .replace(/<[^>]*>/g, '');
    totalChars += text.length;
  }
  const pageCount = Math.ceil(totalChars / 1024);

  const { chapterCount, chapterSpineMap, chapterNames } = parseNavChapters(
    zip,
    opfDir,
    manifest,
    spineHrefToIndex
  );

  // Step 3: extract metadata
  const titleCandidate = pickLocalized(metadata['dc:title'] ?? []);
  const fallbackTitle = path.basename(filePath, path.extname(filePath));
  const title = titleCandidate.text || fallbackTitle;
  const creatorCandidate = pickLocalized(metadata['dc:creator'] ?? []);
  const author = creatorCandidate.text;

  const rawDesc = metadata['dc:description'];
  const description = decodeEntities(
    Array.isArray(rawDesc) ? pickLang(rawDesc) : typeof rawDesc === 'string' ? rawDesc : ''
  );

  const rawPublisher = metadata['dc:publisher'];
  const publisher = decodeEntities(
    (typeof rawPublisher === 'string'
      ? rawPublisher
      : typeof rawPublisher === 'object' && rawPublisher !== null
        ? ((rawPublisher as { '#text'?: string })['#text'] ?? '')
        : ''
    ).trim()
  );

  const rawIdentifiers = (metadata['dc:identifier'] ?? []) as MetaLike[];
  const identifiers = rawIdentifiers
    .map((item) => {
      const value = (typeof item === 'string' ? item : (item['#text'] ?? '')).trim();
      const schemeAttr = typeof item === 'object' ? ((item['@_opf:scheme'] as string) ?? '') : '';
      const scheme = schemeAttr || inferScheme(value);
      return { scheme, value };
    })
    .filter(({ value }) => value !== '');

  const rawSubjects = (metadata['dc:subject'] ?? []) as MetaLike[];
  const subjects = rawSubjects
    .map((item) => decodeEntities((typeof item === 'string' ? item : (item['#text'] ?? '')).trim()))
    .filter(Boolean);

  const metas: Array<{
    '@_name'?: string;
    '@_content'?: string;
    '@_property'?: string;
    '@_refines'?: string;
    '#text'?: string;
  }> = metadata?.meta ?? [];

  let calibreSeries = '';
  let calibreSeriesIndex = 0;
  let groupPosition = 0;
  const collectionCandidates: MetaLike[] = [];

  for (const m of metas) {
    if (m['@_name'] === 'calibre:series') calibreSeries = decodeEntities(m['@_content'] ?? '');
    if (m['@_name'] === 'calibre:series_index')
      calibreSeriesIndex = parseFloat(m['@_content'] ?? '0') || 0;
    if (m['@_property'] === 'belongs-to-collection') collectionCandidates.push(m);
    if (m['@_property'] === 'group-position') groupPosition = parseFloat(m['#text'] ?? '0') || 0;
  }

  const series = calibreSeries || pickLang(collectionCandidates);
  const seriesIndex = calibreSeriesIndex || groupPosition;

  // titleSort: dc:title file-as only; EPUB 3 <meta refines> fallback for the title element
  const attrTitleSort = titleCandidate.text ? titleCandidate.fileAs : '';
  const refinesMeta =
    !attrTitleSort && titleCandidate.id
      ? metas.find(
          (m) => m['@_property'] === 'file-as' && m['@_refines'] === `#${titleCandidate.id}`
        )
      : undefined;
  const titleSort =
    attrTitleSort || (refinesMeta ? decodeEntities((refinesMeta['#text'] ?? '').trim()) : '');

  // authorSort: dc:creator file-as only; no fallback to title
  const authorSort = creatorCandidate.fileAs;

  // publishDate: dc:date, validated as ISO 8601; discard invalid values
  // fast-xml-parser may give string, {#text:...} (when attrs present), or array (multiple elements)
  const rawDateNode = metadata['dc:date'];
  const rawDateCandidate = Array.isArray(rawDateNode) ? rawDateNode[0] : rawDateNode;
  const rawDate =
    typeof rawDateCandidate === 'string'
      ? rawDateCandidate.trim()
      : typeof rawDateCandidate === 'object' && rawDateCandidate !== null
        ? ((rawDateCandidate as { '#text'?: string })['#text'] ?? '').trim()
        : '';
  const publishDate = ISO_8601_RE.test(rawDate) ? rawDate : '';

  // Step 4: cover image
  let coverData: Buffer | null = null;
  let coverMime: string | null = null;

  let coverHref: string | undefined;
  // strategy 1: <meta name="cover"> → item id → href
  const coverMeta = metas.find((m) => m['@_name'] === 'cover');
  if (coverMeta?.['@_content']) {
    const coverId = coverMeta['@_content'];
    const item = manifest.find((i) => i['@_id'] === coverId);
    if (item) coverHref = item['@_href'];
  }
  // strategy 2: properties="cover-image"
  if (!coverHref) {
    const item = manifest.find((i) => i['@_properties'] === 'cover-image');
    if (item) coverHref = item['@_href'];
  }
  // strategy 3: href contains "cover" and is image
  if (!coverHref) {
    const item = manifest.find(
      (i) => i['@_href']?.toLowerCase().includes('cover') && i['@_media-type']?.startsWith('image/')
    );
    if (item) coverHref = item['@_href'];
  }

  if (coverHref) {
    // resolve relative to OPF directory
    const coverPath = opfDir === '.' ? coverHref : `${opfDir}/${coverHref}`;
    const coverEntry = zip.getEntry(coverPath) ?? zip.getEntry(coverHref);
    if (coverEntry) {
      coverData = coverEntry.getData();
      coverMime = manifest.find((i) => i['@_href'] === coverHref)?.['@_media-type'] ?? 'image/jpeg';
    }
  }

  return {
    title,
    titleSort,
    authorSort,
    publishDate,
    author,
    description,
    publisher,
    identifiers,
    subjects,
    series,
    seriesIndex,
    coverData,
    coverMime,
    chapterCount,
    chapterSpineMap,
    chapterNames,
    pageCount,
  };
}
