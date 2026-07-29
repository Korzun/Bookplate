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
 * Ensure an EPUB 3 package has exactly one non-refining
 * `<meta property="dcterms:modified">` (EPUBCheck RSC-005). Dedupes 2+ (keeping
 * the latest timestamp) and injects one when absent. No-op for non-EPUB3
 * packages, for exactly-one, and for refining metas. Mutates `metadata.meta`.
 *
 * EPUB 2 is deliberately excluded: RSC-005's "exactly one" count is an EPUB 3
 * rule, and `property` is an EPUB 3 attribute. EPUBCheck validates a 2.x package
 * against opf20.rng, where `<meta>` requires `name` and `content`, allows no
 * other attributes, and must be empty — so injecting here would take a valid
 * EPUB 2 and make it fail validation.
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

/**
 * Add, update, or remove a refining `<meta refines="#id" property="…">value</meta>`
 * element in `metadata.meta`. An empty `value` removes any existing match; a
 * non-empty value replaces the match (or appends one). Mutates `metadata.meta`.
 */
function setRefinement(
  metadata: Record<string, unknown>,
  id: string,
  property: string,
  value: string
): void {
  const metas = Array.isArray(metadata['meta'])
    ? (metadata['meta'] as Record<string, unknown>[])
    : [];
  const kept = metas.filter((m) => !(m['@_property'] === property && m['@_refines'] === `#${id}`));
  if (value) {
    kept.push({ '@_refines': `#${id}`, '@_property': property, '#text': value });
  }
  metadata['meta'] = kept;
}

/**
 * Add, update, or remove a named OPF-2 `<meta name="…" content="…"/>` element in
 * `metadata.meta`. An empty `content` removes any existing match; a non-empty
 * value replaces the match (or appends one). Mutates `metadata.meta`.
 */
function setNamedMeta(metadata: Record<string, unknown>, name: string, content: string): void {
  const metas = Array.isArray(metadata['meta'])
    ? (metadata['meta'] as Record<string, unknown>[])
    : [];
  const kept = metas.filter((m) => m['@_name'] !== name);
  if (content) {
    kept.push({ '@_name': name, '@_content': content });
  }
  metadata['meta'] = kept;
}

/** Read the text of a refining meta (`<meta refines="#id" property="…">`), or ''. */
function getRefinement(metadata: Record<string, unknown>, id: string, property: string): string {
  const metas = Array.isArray(metadata['meta'])
    ? (metadata['meta'] as Record<string, unknown>[])
    : [];
  const m = metas.find((mm) => mm['@_property'] === property && mm['@_refines'] === `#${id}`);
  return m ? String(m['#text'] ?? '') : '';
}

/**
 * Write a Dublin Core element that carries an optional sort key (dc:title /
 * dc:creator), in the encoding valid for the package version:
 *   • EPUB 3 — a plain element with an `id`, plus a sibling
 *     `<meta refines="#id" property="file-as">` for the sort key. The EPUB 2
 *     `file-as` / `opf:file-as` attributes are schema-invalid on a 3.x package
 *     (EPUBCheck RSC-005 "attribute file-as not allowed here").
 *   • EPUB 2 — the sort key's valid home depends on the element. `opf:file-as`
 *     is allowed on `dc:creator`/`dc:contributor` (needs the opf namespace) but
 *     NOT on `dc:title` under opf20.rng, so a title sort is written as the
 *     widely-supported `<meta name="calibre:title_sort" content="…"/>` instead.
 *     Emitting `opf:file-as` on `dc:title` triggers EPUBCheck RSC-005
 *     ("attribute opf:file-as not allowed here; expected attribute id or
 *     xml:lang").
 * Collapses to a single element, matching the prior writer. Mutates `metadata`.
 */
function writeSortedField(
  pkg: Record<string, unknown>,
  metadata: Record<string, unknown>,
  key: 'dc:title' | 'dc:creator',
  fallbackId: string,
  changeText: string | undefined,
  changeSort: string | undefined,
  isV3: boolean
): void {
  const arr = (metadata[key] as unknown[]) ?? [];
  const first = arr[0];
  const obj =
    typeof first === 'object' && first !== null ? (first as Record<string, string>) : undefined;
  const existingId = obj?.['@_id'] ?? '';
  const attrSort = obj?.['@_file-as'] ?? obj?.['@_opf:file-as'] ?? '';
  const refineSort = existingId ? getRefinement(metadata, existingId, 'file-as') : '';
  const text = changeText ?? (typeof first === 'string' ? first : (obj?.['#text'] ?? ''));
  // An explicit '' clears the sort; undefined preserves the existing one
  // (from either an attribute or an EPUB 3 refinement).
  const sort = changeSort ?? (attrSort || refineSort);

  if (isV3) {
    if (sort) {
      const id = existingId || fallbackId;
      metadata[key] = [{ '#text': text, '@_id': id }];
      setRefinement(metadata, id, 'file-as', sort);
    } else if (existingId) {
      setRefinement(metadata, existingId, 'file-as', '');
      metadata[key] = [{ '#text': text, '@_id': existingId }];
    } else {
      metadata[key] = [text];
    }
    return;
  }

  // EPUB 2: drop any stale EPUB 3 refinement first, then encode the sort in the
  // form that's schema-valid for this element.
  if (existingId) setRefinement(metadata, existingId, 'file-as', '');

  if (key === 'dc:title') {
    // opf:file-as is not permitted on dc:title under opf20.rng (RSC-005). Encode
    // the title sort as <meta name="calibre:title_sort"> and write a plain
    // element, dropping any pre-existing (invalid) file-as attribute.
    setNamedMeta(metadata, 'calibre:title_sort', sort);
    metadata[key] = [text];
    return;
  }

  // dc:creator/dc:contributor: opf:file-as attribute (needs the opf namespace).
  if (sort && !(pkg as Record<string, string>)['@_xmlns:opf']) {
    (pkg as Record<string, string>)['@_xmlns:opf'] = 'http://www.idpf.org/2007/opf';
  }
  metadata[key] = sort ? [{ '#text': text, '@_opf:file-as': sort }] : [text];
}

/**
 * Keep the NCX's `<meta name="dtb:uid">` in step with the package
 * unique-identifier's value. epubcheck (NCX-001) requires them to match, so an
 * identifier edit that leaves a stale `dtb:uid` behind invalidates the EPUB.
 * No-op when there is no NCX, no dtb:uid target value, or the NCX is unparsable.
 * Applies to any package that ships an NCX (legacy toc), version-independent.
 */
function syncNcxUid(
  files: Record<string, Uint8Array>,
  opfDir: string,
  manifestItems: Record<string, string>[],
  uidValue: string
): void {
  if (!uidValue) return;
  const ncxItem = manifestItems.find((i) => i['@_media-type'] === 'application/x-dtbncx+xml');
  const href = ncxItem?.['@_href'];
  if (!href) return;
  const ncxPath = opfDir === '.' ? href : `${opfDir}/${href}`;
  const ncxData = files[ncxPath];
  if (!ncxData) return;

  const parser = new XMLParser({
    ignoreAttributes: false,
    attributeNamePrefix: '@_',
    parseTagValue: false,
    ignoreDeclaration: true,
    isArray: (name) => name === 'meta',
  });
  let doc: Record<string, unknown>;
  try {
    doc = parser.parse(Buffer.from(ncxData).toString('utf8')) as Record<string, unknown>;
  } catch {
    return;
  }
  const ncx = doc?.['ncx'] as Record<string, unknown> | undefined;
  if (!ncx) return;
  if (!ncx['head'] || typeof ncx['head'] !== 'object') ncx['head'] = {};
  const head = ncx['head'] as Record<string, unknown>;
  const metas = Array.isArray(head['meta']) ? (head['meta'] as Record<string, string>[]) : [];
  const kept = metas.filter((m) => m['@_name'] !== 'dtb:uid');
  kept.push({ '@_name': 'dtb:uid', '@_content': uidValue });
  head['meta'] = kept;

  const builder = new XMLBuilder({
    ignoreAttributes: false,
    attributeNamePrefix: '@_',
    suppressEmptyNode: false,
    format: false,
  });
  files[ncxPath] = strToU8(
    '<?xml version="1.0" encoding="UTF-8"?>\n' + (builder.build(doc) as string)
  );
}

export function buildUpdatedEpub(filePath: string, changes: EpubChanges): Buffer {
  const { files, opfRelPath, opf, pkg, metadata } = loadOpf(filePath);
  const isV3 = String(pkg['@_version'] ?? '').startsWith('3');
  if (!pkg.manifest) pkg.manifest = { item: [] };
  const mfst = pkg.manifest as Record<string, unknown>;
  if (!mfst.item) mfst.item = [];
  const manifestItems = mfst.item as Record<string, string>[];
  const opfDir = path.dirname(opfRelPath);

  // Step 3: apply text field changes

  // dc:title / dc:creator: update the value and/or its sort key together,
  // encoded per the package version (EPUB 3 <meta refines>, EPUB 2 opf:file-as).
  if (changes.title !== undefined || changes.titleSort !== undefined) {
    writeSortedField(pkg, metadata, 'dc:title', 'title-1', changes.title, changes.titleSort, isV3);
  }

  if (changes.author !== undefined || changes.authorSort !== undefined) {
    writeSortedField(
      pkg,
      metadata,
      'dc:creator',
      'creator-1',
      changes.author,
      changes.authorSort,
      isV3
    );
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
    // The <package unique-identifier> attribute points at a dc:identifier by id.
    // Rebuilding the identifier list would orphan that reference (EPUBCheck
    // OPF-030), so carry the id onto the first rebuilt identifier.
    const uid = String((pkg as Record<string, string>)['@_unique-identifier'] ?? '');
    const hasScheme = changes.identifiers.some((id) => id.scheme);

    // Rebuild identifier-type refinements from scratch (ids are regenerated below).
    if (Array.isArray(metadata['meta'])) {
      metadata['meta'] = (metadata['meta'] as Record<string, unknown>[]).filter(
        (m) => m['@_property'] !== 'identifier-type'
      );
    }

    // EPUB 3 forbids opf:scheme on dc:identifier; it carries the scheme via a
    // <meta refines property="identifier-type"> instead. EPUB 2 keeps opf:scheme.
    if (!isV3 && hasScheme && !(pkg as Record<string, string>)['@_xmlns:opf']) {
      (pkg as Record<string, string>)['@_xmlns:opf'] = 'http://www.idpf.org/2007/opf';
    }

    metadata['dc:identifier'] = changes.identifiers.map((id, i) => {
      const keepUid = i === 0 && uid !== '';
      const elemId = keepUid ? uid : `book-id-${i}`;
      if (isV3) {
        if (id.scheme) setRefinement(metadata, elemId, 'identifier-type', id.scheme);
        // An id anchors the unique-identifier reference and/or the refinement.
        return keepUid || id.scheme ? { '#text': id.value, '@_id': elemId } : id.value;
      }
      const el: Record<string, string> = { '#text': id.value };
      if (keepUid) el['@_id'] = uid;
      if (id.scheme) el['@_opf:scheme'] = id.scheme;
      return keepUid || id.scheme ? el : id.value;
    });

    // The unique-identifier's value changed, so a legacy NCX's dtb:uid must be
    // re-synced or epubcheck fails with NCX-001. The new value lives on the
    // first (uid-carrying) identifier.
    const newUidValue =
      uid !== '' && changes.identifiers.length > 0 ? changes.identifiers[0].value : '';
    syncNcxUid(files, opfDir, manifestItems, newUidValue);
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
