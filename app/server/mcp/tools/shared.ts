/**
 * Selections, output schemas and text renderings shared by several tools, so
 * a book looks the same whether it came from a search, a series, or an edit.
 */
import { z } from 'zod';

import { fixKey } from '../../services/epub-import-pipeline';

export const BOOK_SUMMARY_FIELDS = `
  id documentId title author
  series { id name } seriesIndex
  subjects publisher publishDate pageCount size addedAt
  hasCover hasActionablePendingFix
  validation { valid }
  progress { percentage }
`;

export type BookSummaryGql = {
  id: string;
  documentId: string;
  title: string;
  author: string;
  series: { id: string; name: string } | null;
  seriesIndex: number;
  subjects: string[];
  publisher: string;
  publishDate: string;
  pageCount: number;
  size: number;
  addedAt: string;
  hasCover: boolean;
  hasActionablePendingFix: boolean;
  validation: { valid: boolean } | null;
  progress: { percentage: number } | null;
};

export const bookSummarySchema = z.object({
  kind: z.literal('book'),
  id: z.string().describe('The id every other tool takes for this book'),
  documentId: z.string().describe('Content hash, for display only'),
  title: z.string(),
  author: z.string(),
  series: z.string().nullable(),
  seriesId: z.string().nullable(),
  seriesIndex: z.number(),
  subjects: z.array(z.string()),
  publisher: z.string(),
  publishDate: z.string(),
  pageCount: z.number(),
  size: z.number(),
  addedAt: z.string(),
  hasCover: z.boolean(),
  hasPendingFixes: z.boolean(),
  valid: z.boolean().nullable().describe('Last validation outcome; null if never validated'),
  progressPercentage: z.number().nullable(),
});
export type BookSummary = z.infer<typeof bookSummarySchema>;

export const summarizeBook = (b: BookSummaryGql): BookSummary => ({
  kind: 'book',
  id: b.id,
  documentId: b.documentId,
  title: b.title,
  author: b.author,
  series: b.series?.name ?? null,
  seriesId: b.series?.id ?? null,
  seriesIndex: b.seriesIndex,
  subjects: b.subjects,
  publisher: b.publisher,
  publishDate: b.publishDate,
  pageCount: b.pageCount,
  size: b.size,
  addedAt: b.addedAt,
  hasCover: b.hasCover,
  hasPendingFixes: b.hasActionablePendingFix,
  valid: b.validation?.valid ?? null,
  progressPercentage: b.progress?.percentage ?? null,
});

export const describeBook = (b: BookSummary): string => {
  const parts = [`"${b.title}" by ${b.author || 'unknown'}`];
  if (b.series !== null) parts.push(`(${b.series} #${b.seriesIndex})`);
  if (b.valid === false) parts.push('[invalid EPUB]');
  if (b.hasPendingFixes) parts.push('[has recommendations]');
  parts.push(`id=${b.id}`);
  return parts.join(' ');
};

export const SERIES_SUMMARY_FIELDS = `id name author bookCount totalPages progressPercentage`;

export type SeriesSummaryGql = {
  id: string;
  name: string;
  author: string;
  bookCount: number;
  totalPages: number;
  progressPercentage: number | null;
};

export const seriesSummarySchema = z.object({
  kind: z.literal('series'),
  id: z.string(),
  name: z.string(),
  author: z.string(),
  bookCount: z.number(),
  totalPages: z.number(),
  progressPercentage: z.number().nullable(),
});
export type SeriesSummary = z.infer<typeof seriesSummarySchema>;

export const summarizeSeries = (s: SeriesSummaryGql): SeriesSummary => ({
  kind: 'series',
  id: s.id,
  name: s.name,
  author: s.author,
  bookCount: s.bookCount,
  totalPages: s.totalPages,
  progressPercentage: s.progressPercentage,
});

export const describeSeries = (s: SeriesSummary): string =>
  `Series "${s.name}" by ${s.author || 'unknown'} — ${s.bookCount} book(s) id=${s.id}`;

export const FIX_FIELDS = `field kind from to reason`;

export type MetadataFixGql = {
  field: string;
  kind: string;
  from: string;
  to: string | null;
  reason: string | null;
};

export const metadataFixSchema = z.object({
  key: z
    .string()
    .describe('Pass this to resolve_metadata_fixes to accept or dismiss just this fix'),
  field: z.string(),
  kind: z.string(),
  from: z.string(),
  to: z.string().nullable().describe('Proposed value; null when the fix only flags a problem'),
  reason: z.string().nullable(),
});
export type MetadataFixOut = z.infer<typeof metadataFixSchema>;

export const toFixOut = (f: MetadataFixGql): MetadataFixOut => ({
  key: fixKey({ field: f.field, kind: f.kind, from: f.from, to: f.to, changes: {} }),
  field: f.field,
  kind: f.kind,
  from: f.from,
  to: f.to,
  reason: f.reason,
});

export const describeFix = (f: MetadataFixOut): string =>
  f.to === null
    ? `${f.field}: "${f.from}" flagged (${f.kind})${f.reason ? ` — ${f.reason}` : ''} [key=${f.key}]`
    : `${f.field}: "${f.from}" → "${f.to}" (${f.kind})${f.reason ? ` — ${f.reason}` : ''} [key=${f.key}]`;

export const PAGE_INFO_FIELDS = `pageInfo { hasNextPage endCursor }`;

export type PageInfoGql = { hasNextPage: boolean; endCursor: string | null };

export const nextCursorOf = (pageInfo: PageInfoGql): string | null =>
  pageInfo.hasNextPage ? pageInfo.endCursor : null;

export const nextCursorSchema = z
  .string()
  .nullable()
  .describe('Pass as `after` to fetch the next page; null when this was the last page');

export const VALIDATION_SUMMARY_FIELDS = `valid threshold validatedAt counts { severity count }`;

export type ValidationSummaryGql = {
  valid: boolean;
  threshold: string;
  validatedAt: string;
  counts: Array<{ severity: string; count: number }>;
};

export const validationSummarySchema = z.object({
  valid: z.boolean(),
  threshold: z.string(),
  validatedAt: z.string(),
  counts: z.record(z.string(), z.number()),
});
export type ValidationSummary = z.infer<typeof validationSummarySchema>;

export const toValidationSummary = (v: ValidationSummaryGql): ValidationSummary => ({
  valid: v.valid,
  threshold: v.threshold,
  validatedAt: v.validatedAt,
  counts: Object.fromEntries(v.counts.map((c) => [c.severity, c.count])),
});

export const describeValidation = (v: ValidationSummary | null): string => {
  if (v === null) return 'never validated';
  const counts = Object.entries(v.counts)
    .filter(([, n]) => n > 0)
    .map(([sev, n]) => `${n} ${sev.toLowerCase()}`)
    .join(', ');
  return `${v.valid ? 'valid' : 'INVALID'} at threshold ${v.threshold}${counts ? ` (${counts})` : ''}`;
};

export const clampFirst = (first: number | undefined, fallback: number, max: number): number =>
  Math.min(Math.max(first ?? fallback, 1), max);
