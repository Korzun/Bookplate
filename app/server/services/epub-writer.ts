import AdmZip from 'adm-zip';
import { XMLParser, XMLBuilder } from 'fast-xml-parser';
import * as path from 'path';

export interface EpubChanges {
  title?: string;
  author?: string;
  fileAs?: string;
  description?: string;
  publisher?: string;
  series?: string;
  seriesIndex?: number;
  identifiers?: { scheme: string; value: string }[];
  subjects?: string[];
  coverData?: Buffer;
  coverMime?: string;
}

export function writeMetadata(filePath: string, changes: EpubChanges): void {
  const zip = new AdmZip(filePath);

  // Step 1: resolve OPF path from container.xml
  const containerEntry = zip.getEntry('META-INF/container.xml');
  if (!containerEntry) throw new Error('Missing META-INF/container.xml');

  const containerParser = new XMLParser({
    ignoreAttributes: false,
    attributeNamePrefix: '@_',
    parseTagValue: false,
  });
  const containerXml = containerParser.parse(containerEntry.getData().toString('utf8'));
  const rootfiles = containerXml?.container?.rootfiles?.rootfile;
  const rootfileArr = Array.isArray(rootfiles) ? rootfiles : [rootfiles];
  const opfRelPath: string = rootfileArr[0]?.['@_full-path'];
  if (!opfRelPath) throw new Error('Cannot find OPF rootfile path in container.xml');

  // Step 2: parse OPF
  const opfEntry = zip.getEntry(opfRelPath);
  if (!opfEntry) throw new Error(`Cannot find OPF file: ${opfRelPath}`);

  const parser = new XMLParser({
    ignoreAttributes: false,
    attributeNamePrefix: '@_',
    parseTagValue: false,
    isArray: (name) =>
      ['item', 'meta', 'dc:title', 'dc:creator', 'dc:identifier', 'dc:subject'].includes(name),
  });
  const opf = parser.parse(opfEntry.getData().toString('utf8')) as Record<string, unknown>;
  const pkg = (opf?.package ?? opf) as Record<string, unknown>;
  if (!pkg.metadata) pkg.metadata = {};
  const metadata = pkg.metadata as Record<string, unknown>;
  if (!pkg.manifest) pkg.manifest = { item: [] };
  const mfst = pkg.manifest as Record<string, unknown>;
  if (!mfst.item) mfst.item = [];
  const manifestItems = mfst.item as Record<string, string>[];
  const opfDir = path.dirname(opfRelPath);

  // Step 3: apply text field changes
  if (changes.title !== undefined) {
    metadata['dc:title'] = [changes.title];
  }

  // author and fileAs both live on dc:creator; update them together to preserve each other
  if (changes.author !== undefined || changes.fileAs !== undefined) {
    const existing = ((metadata['dc:creator'] as unknown[]) ?? [])[0];
    const currentAuthor =
      changes.author ??
      (typeof existing === 'string'
        ? existing
        : ((existing as Record<string, string>)?.['#text'] ?? ''));
    const currentFileAs =
      changes.fileAs ??
      (typeof existing === 'object' && existing !== null
        ? ((existing as Record<string, string>)['@_file-as'] ??
          (existing as Record<string, string>)['@_opf:file-as'] ??
          '')
        : '');
    metadata['dc:creator'] = currentFileAs
      ? [{ '#text': currentAuthor, '@_file-as': currentFileAs }]
      : [currentAuthor];
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

    if (zip.getEntry(coverEntryPath)) {
      zip.updateFile(coverEntryPath, changes.coverData);
    } else {
      zip.addFile(coverEntryPath, changes.coverData);
    }

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

  // Step 6: serialize OPF and write ZIP
  const builder = new XMLBuilder({
    ignoreAttributes: false,
    attributeNamePrefix: '@_',
    suppressEmptyNode: false,
    format: false,
  });
  const newOpfXml = '<?xml version="1.0" encoding="UTF-8"?>\n' + (builder.build(opf) as string);
  zip.updateFile(opfRelPath, Buffer.from(newOpfXml, 'utf8'));
  zip.writeZip(filePath);
}
