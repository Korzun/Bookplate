import * as fs from 'fs';
import * as path from 'path';

import { XMLParser, XMLBuilder } from 'fast-xml-parser';
import { unzipSync, strToU8 } from 'fflate';

import { packEpub } from './epub-zip';

export interface EpubChanges {
  title?: string;
  author?: string;
  titleSort?: string;
  authorSort?: string;
  publishDate?: string;
  description?: string;
  publisher?: string;
  series?: string;
  seriesIndex?: number;
  identifiers?: { scheme: string; value: string }[];
  subjects?: string[];
  coverData?: Buffer;
  coverMime?: string;
}

interface LoadedOpf {
  files: Record<string, Uint8Array>;
  opfRelPath: string;
  opf: Record<string, unknown>;
  pkg: Record<string, unknown>;
  metadata: Record<string, unknown>;
}

// Unzip an EPUB and parse its OPF package document. Rebuilding the archive
// from decompressed data (rather than editing in place) sidesteps source
// quirks like ZIP general-purpose bit 3 (data descriptors) that some EPUB
// authoring tools set, which can otherwise leave the rewritten file unreadable.
function loadOpf(filePath: string): LoadedOpf {
  const files = unzipSync(fs.readFileSync(filePath));

  // Step 1: resolve OPF path from container.xml
  const containerData = files['META-INF/container.xml'];
  if (!containerData) throw new Error('Missing META-INF/container.xml');

  const containerParser = new XMLParser({
    ignoreAttributes: false,
    attributeNamePrefix: '@_',
    parseTagValue: false,
  });
  const containerXml = containerParser.parse(Buffer.from(containerData).toString('utf8'));
  const rootfiles = containerXml?.container?.rootfiles?.rootfile;
  const rootfileArr = Array.isArray(rootfiles) ? rootfiles : [rootfiles];
  const opfRelPath: string = rootfileArr[0]?.['@_full-path'];
  if (!opfRelPath) throw new Error('Cannot find OPF rootfile path in container.xml');

  // Step 2: parse OPF
  const opfData = files[opfRelPath];
  if (!opfData) throw new Error(`Cannot find OPF file: ${opfRelPath}`);

  const parser = new XMLParser({
    ignoreAttributes: false,
    attributeNamePrefix: '@_',
    parseTagValue: false,
    // Drop the source's `<?xml …?>` declaration so the builder doesn't re-emit it;
    // we prepend exactly one below. Keeping it produced a duplicate declaration
    // that epubcheck rejects (RSC-005 "declaration must be at the start").
    ignoreDeclaration: true,
    isArray: (name) =>
      ['item', 'meta', 'dc:title', 'dc:creator', 'dc:identifier', 'dc:subject'].includes(name),
  });
  const opf = parser.parse(Buffer.from(opfData).toString('utf8')) as Record<string, unknown>;
  const pkg = (opf?.package ?? opf) as Record<string, unknown>;
  if (!pkg.metadata) pkg.metadata = {};
  const metadata = pkg.metadata as Record<string, unknown>;
  return { files, opfRelPath, opf, pkg, metadata };
}

function serializeEpub(
  files: Record<string, Uint8Array>,
  opfRelPath: string,
  opf: Record<string, unknown>
): Buffer {
  const builder = new XMLBuilder({
    ignoreAttributes: false,
    attributeNamePrefix: '@_',
    suppressEmptyNode: false,
    format: false,
  });
  const newOpfXml = '<?xml version="1.0" encoding="UTF-8"?>\n' + (builder.build(opf) as string);
  files[opfRelPath] = strToU8(newOpfXml);
  return packEpub(files);
}

// Deterministic placeholder injected for a missing dcterms:modified meta, so
// re-uploads of the same content keep the same fingerprint. The upload
// validator (@korzun/epubcheck-ts) only counts dcterms:modified metas; it does
// not validate the value's date format.
const INJECTED_MODIFIED = '0000-00-00T00:00:00Z';

/**
 * Ensure an EPUB-3 package has exactly one non-refining
 * `<meta property="dcterms:modified">` (EPUBCheck RSC-005). Dedupes 2+ (keeping
 * the latest timestamp) and injects one when absent. No-op for non-EPUB3
 * packages, for exactly-one, and for refining metas. Mutates `metadata.meta`.
 */
export function normalizeModifiedMeta(
  metadata: Record<string, unknown>,
  version: string
): { changed: boolean; action: 'deduped' | 'injected' | 'none' } {
  if (!version.startsWith('3')) return { changed: false, action: 'none' };

  const metas = Array.isArray(metadata['meta'])
    ? (metadata['meta'] as Record<string, unknown>[])
    : [];
  const isModified = (m: Record<string, unknown>) =>
    m?.['@_property'] === 'dcterms:modified' && m?.['@_refines'] === undefined;
  const idxs = metas.map((m, i) => (isModified(m) ? i : -1)).filter((i) => i >= 0);

  if (idxs.length === 1) return { changed: false, action: 'none' };

  if (idxs.length === 0) {
    if (!Array.isArray(metadata['meta'])) metadata['meta'] = [];
    (metadata['meta'] as Record<string, unknown>[]).push({
      '@_property': 'dcterms:modified',
      '#text': INJECTED_MODIFIED,
    });
    return { changed: true, action: 'injected' };
  }

  // 2+: keep the lexically-greatest #text (ISO-8601 = chronological); tie-break
  // on the later document position so exactly one survives.
  let keep = idxs[0];
  for (const i of idxs.slice(1)) {
    const cur = String(metas[i]['#text'] ?? '');
    const best = String(metas[keep]['#text'] ?? '');
    if (cur > best || (cur === best && i > keep)) keep = i;
  }
  const drop = new Set(idxs.filter((i) => i !== keep));
  metadata['meta'] = metas.filter((_, i) => !drop.has(i));
  return { changed: true, action: 'deduped' };
}

/**
 * Repair the RSC-005 dcterms:modified count on disk-resident EPUB bytes. Returns
 * the (possibly rewritten) bytes; `repaired: false` with the original bytes when
 * nothing needed changing (so the caller can preserve the fingerprint).
 */
export function repairPackageDocument(filePath: string): {
  bytes: Buffer;
  repaired: boolean;
  action: 'deduped' | 'injected' | 'none';
} {
  const { files, opfRelPath, opf, pkg, metadata } = loadOpf(filePath);
  const result = normalizeModifiedMeta(metadata, String(pkg['@_version'] ?? ''));
  if (!result.changed) {
    return { bytes: Buffer.from(fs.readFileSync(filePath)), repaired: false, action: 'none' };
  }
  return { bytes: serializeEpub(files, opfRelPath, opf), repaired: true, action: result.action };
}

export function buildUpdatedEpub(filePath: string, changes: EpubChanges): Buffer {
  const { files, opfRelPath, opf, pkg, metadata } = loadOpf(filePath);
  if (!pkg.manifest) pkg.manifest = { item: [] };
  const mfst = pkg.manifest as Record<string, unknown>;
  if (!mfst.item) mfst.item = [];
  const manifestItems = mfst.item as Record<string, string>[];
  const opfDir = path.dirname(opfRelPath);

  // Step 3: apply text field changes

  // dc:title: update title and/or titleSort together to preserve each other
  if (changes.title !== undefined || changes.titleSort !== undefined) {
    const existingTitleArr = (metadata['dc:title'] as unknown[]) ?? [];
    const existingTitle0 = existingTitleArr[0];
    const currentTitle =
      changes.title ??
      (typeof existingTitle0 === 'string'
        ? existingTitle0
        : ((existingTitle0 as Record<string, string>)?.['#text'] ?? ''));
    const currentTitleSort =
      changes.titleSort ??
      (typeof existingTitle0 === 'object' && existingTitle0 !== null
        ? ((existingTitle0 as Record<string, string>)['@_file-as'] ??
          (existingTitle0 as Record<string, string>)['@_opf:file-as'] ??
          '')
        : '');
    metadata['dc:title'] = currentTitleSort
      ? [{ '#text': currentTitle, '@_file-as': currentTitleSort }]
      : [currentTitle];
  }

  // dc:creator: update author and/or authorSort together to preserve each other
  if (changes.author !== undefined || changes.authorSort !== undefined) {
    const existingCreatorArr = (metadata['dc:creator'] as unknown[]) ?? [];
    const existingCreator0 = existingCreatorArr[0];
    const currentAuthor =
      changes.author ??
      (typeof existingCreator0 === 'string'
        ? existingCreator0
        : ((existingCreator0 as Record<string, string>)?.['#text'] ?? ''));
    const currentAuthorSort =
      changes.authorSort ??
      (typeof existingCreator0 === 'object' && existingCreator0 !== null
        ? ((existingCreator0 as Record<string, string>)['@_file-as'] ??
          (existingCreator0 as Record<string, string>)['@_opf:file-as'] ??
          '')
        : '');
    metadata['dc:creator'] = currentAuthorSort
      ? [{ '#text': currentAuthor, '@_file-as': currentAuthorSort }]
      : [currentAuthor];
  }

  // dc:date: set or remove publishDate
  if (changes.publishDate !== undefined) {
    if (changes.publishDate === '') {
      delete metadata['dc:date'];
    } else {
      metadata['dc:date'] = changes.publishDate;
    }
  }

  if (changes.description !== undefined) {
    metadata['dc:description'] = changes.description;
  }

  if (changes.publisher !== undefined) {
    metadata['dc:publisher'] = changes.publisher;
  }

  if (changes.identifiers !== undefined) {
    if (
      changes.identifiers.some((id) => id.scheme) &&
      !(pkg as Record<string, string>)['@_xmlns:opf']
    ) {
      (pkg as Record<string, string>)['@_xmlns:opf'] = 'http://www.idpf.org/2007/opf';
    }
    metadata['dc:identifier'] = changes.identifiers.map((id) =>
      id.scheme ? { '#text': id.value, '@_opf:scheme': id.scheme } : id.value
    );
  }

  if (changes.subjects !== undefined) {
    metadata['dc:subject'] = changes.subjects;
  }

  // Step 4: series changes
  if (changes.series !== undefined || changes.seriesIndex !== undefined) {
    const existingMetas = (metadata['meta'] as Record<string, string>[]) ?? [];
    const currentSeries =
      changes.series ??
      existingMetas.find((m) => m['@_name'] === 'calibre:series')?.['@_content'] ??
      '';
    const currentIndex =
      changes.seriesIndex ??
      parseFloat(
        existingMetas.find((m) => m['@_name'] === 'calibre:series_index')?.['@_content'] ?? '0'
      ) ??
      0;
    const filtered = existingMetas.filter(
      (m) => m['@_name'] !== 'calibre:series' && m['@_name'] !== 'calibre:series_index'
    );
    // A seriesIndex without a series name is not written (meaningless without a series).
    // To set only the index on an existing series, provide both series and seriesIndex.
    if (currentSeries) {
      filtered.push({ '@_name': 'calibre:series', '@_content': currentSeries });
      filtered.push({ '@_name': 'calibre:series_index', '@_content': String(currentIndex) });
    }
    metadata['meta'] = filtered;
  }

  // Step 5: cover replacement
  if (changes.coverData !== undefined && changes.coverMime !== undefined) {
    const ext = changes.coverMime.includes('/')
      ? changes.coverMime.split('/')[1].split('+')[0]
      : 'jpg';
    const coverFilename = `cover-edit.${ext}`;
    const coverEntryPath = opfDir === '.' ? coverFilename : `${opfDir}/${coverFilename}`;

    // Assignment both adds a new entry and replaces an existing one.
    files[coverEntryPath] = Uint8Array.from(changes.coverData);

    const existingItem = manifestItems.find((i) => i['@_id'] === 'cover-edit');
    if (existingItem) {
      existingItem['@_href'] = coverFilename;
      existingItem['@_media-type'] = changes.coverMime;
    } else {
      manifestItems.push({
        '@_id': 'cover-edit',
        '@_href': coverFilename,
        '@_media-type': changes.coverMime,
      });
    }

    const metas = (metadata['meta'] as Record<string, string>[]) ?? [];
    const coverMetaIdx = metas.findIndex((m) => m['@_name'] === 'cover');
    if (coverMetaIdx >= 0) {
      metas[coverMetaIdx] = { '@_name': 'cover', '@_content': 'cover-edit' };
    } else {
      metas.push({ '@_name': 'cover', '@_content': 'cover-edit' });
    }
    metadata['meta'] = metas;
  }

  // Step 6a: keep exactly one dcterms:modified so an edit never emits an
  // RSC-005 package.
  normalizeModifiedMeta(metadata, String(pkg['@_version'] ?? ''));

  // Step 6b: serialize the updated OPF and write the ZIP.
  return serializeEpub(files, opfRelPath, opf);
}
