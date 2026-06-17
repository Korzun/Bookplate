import { Book } from '../types';

function escapeXml(s: string): string {
  return s
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

class RawXml {
  constructor(readonly value: string) {}
}

export function raw(s: string): RawXml {
  return new RawXml(s);
}

export function xml(strings: TemplateStringsArray, ...values: unknown[]): string {
  return strings.reduce((acc, str, i) => {
    if (i >= values.length) return acc + str;
    const v = values[i];
    return acc + str + (v instanceof RawXml ? v.value : escapeXml(String(v)));
  }, '');
}

export interface FeedParams {
  id: string;
  title: string;
  selfHref: string;
  baseUrl: string;
  now: string;
  entries: string[];
}

export function navEntry(
  id: string,
  title: string,
  content: string,
  href: string,
  kind: 'navigation' | 'acquisition',
  now: string
): string {
  return xml`  <entry>
    <title>${title}</title>
    <id>${id}</id>
    <updated>${now}</updated>
    <content type="text">${content}</content>
    <link rel="subsection" href="${href}" type="application/atom+xml;profile=opds-catalog;kind=${kind}"/>
  </entry>`;
}

export function bookEntry(b: Book, baseUrl: string, smallestThumbnailWidth: number | null): string {
  const parts: string[] = [
    xml`  <entry>
    <title>${b.title}</title>
    <id>urn:hass-odps:book:${b.id}</id>
    <updated>${b.mtime.toISOString()}</updated>
    <author><name>${b.author}</name></author>
    <summary>${b.description}</summary>
    <link rel="http://opds-spec.org/acquisition"
          href="${baseUrl}/opds/books/${b.id}/download"
          type="application/epub+zip"
          title="${b.filename}"/>`,
  ];
  if (b.hasCover) {
    parts.push(
      xml`    <link rel="http://opds-spec.org/image"
          href="${baseUrl}/opds/books/${b.id}/cover"
          type="image/jpeg"/>`
    );
  }
  if (b.hasCover && smallestThumbnailWidth !== null) {
    parts.push(
      xml`    <link rel="http://opds-spec.org/image/thumbnail"
          href="${baseUrl}/opds/books/${b.id}/cover?width=${String(smallestThumbnailWidth)}"
          type="image/jpeg"/>`
    );
  }
  parts.push('  </entry>');
  return parts.join('\n');
}

function feedWrapper(params: FeedParams, kind: 'navigation' | 'acquisition'): string {
  const { id, title, selfHref, baseUrl, now, entries } = params;
  const header = xml`<?xml version="1.0" encoding="UTF-8"?>
<feed xmlns="http://www.w3.org/2005/Atom" xmlns:opds="http://opds-spec.org/2010/catalog">
  <id>${id}</id>
  <title>${title}</title>
  <updated>${now}</updated>
  <link rel="self" href="${selfHref}" type="application/atom+xml;profile=opds-catalog;kind=${kind}"/>
  <link rel="start" href="${baseUrl}/opds/" type="application/atom+xml;profile=opds-catalog;kind=navigation"/>`;
  return header + (entries.length > 0 ? '\n' + entries.join('\n') : '') + '\n</feed>';
}

export function navigationFeed(params: FeedParams): string {
  return feedWrapper(params, 'navigation');
}

export function acquisitionFeed(params: FeedParams): string {
  return feedWrapper(params, 'acquisition');
}
