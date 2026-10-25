import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { z } from 'zod';

import type { ToolDeps } from './deps';
import { decodeBookId, executeDocument, guarded, NOT_FOUND_BOOK, ok, ToolError } from './execute';
import {
  describeFix,
  describeRating,
  describeValidation,
  FIX_FIELDS,
  metadataFixSchema,
  RATING_FIELDS_GQL,
  ratingSchema,
  toFixOut,
  toValidationSummary,
  VALIDATION_SUMMARY_FIELDS,
  validationSummarySchema,
  type MetadataFixGql,
  type RatingGql,
  type ValidationSummaryGql,
} from './shared';

export const BOOK_DETAIL_FIELDS = `
  id documentId title titleSort author authorSort description publisher publishDate
  series { id name } seriesIndex
  identifiers { scheme value } subjects
  pageCount chapterCount size addedAt mtime hasCover
  validation { ${VALIDATION_SUMMARY_FIELDS} }
  pendingFix {
    fileName
    state {
      proposals { ${FIX_FIELDS} }
      autoFixes { ${FIX_FIELDS} }
      appliedFixes { ${FIX_FIELDS} }
    }
  }
  lineage { type oldId newId timestamp }
  progress { percentage currentChapter device timestamp }
  ${RATING_FIELDS_GQL}
`;

export type BookDetailGql = {
  id: string;
  documentId: string;
  title: string;
  titleSort: string;
  author: string;
  authorSort: string;
  description: string;
  publisher: string;
  publishDate: string;
  series: { id: string; name: string } | null;
  seriesIndex: number;
  identifiers: Array<{ scheme: string; value: string }>;
  subjects: string[];
  pageCount: number;
  chapterCount: number;
  size: number;
  addedAt: string;
  mtime: string;
  hasCover: boolean;
  validation: ValidationSummaryGql | null;
  pendingFix: {
    fileName: string;
    state: {
      proposals: MetadataFixGql[];
      autoFixes: MetadataFixGql[];
      appliedFixes: MetadataFixGql[];
    };
  } | null;
  lineage: Array<{ type: string; oldId: string; newId: string; timestamp: string }>;
  progress: {
    percentage: number;
    currentChapter: number | null;
    device: string;
    timestamp: string;
  } | null;
  rating: RatingGql;
};

export const bookDetailSchema = {
  id: z.string(),
  documentId: z.string(),
  title: z.string(),
  titleSort: z.string(),
  author: z.string(),
  authorSort: z.string(),
  description: z.string(),
  publisher: z.string(),
  publishDate: z.string(),
  series: z.string().nullable(),
  seriesId: z.string().nullable(),
  seriesIndex: z.number(),
  identifiers: z.array(z.object({ scheme: z.string(), value: z.string() })),
  subjects: z.array(z.string()),
  pageCount: z.number(),
  chapterCount: z.number(),
  size: z.number(),
  addedAt: z.string(),
  mtime: z.string(),
  hasCover: z.boolean(),
  validation: validationSummarySchema.nullable(),
  pendingFixes: z.array(metadataFixSchema).describe('Outstanding metadata recommendations'),
  autoFixesApplied: z.array(metadataFixSchema).describe('Fixes applied automatically at import'),
  lineage: z.array(
    z.object({ type: z.string(), oldId: z.string(), newId: z.string(), timestamp: z.string() })
  ),
  progress: z
    .object({
      percentage: z.number(),
      currentChapter: z.number().nullable(),
      device: z.string(),
      timestamp: z.string(),
    })
    .nullable(),
  rating: ratingSchema,
};

export const toBookDetail = (b: BookDetailGql) => ({
  id: b.id,
  documentId: b.documentId,
  title: b.title,
  titleSort: b.titleSort,
  author: b.author,
  authorSort: b.authorSort,
  description: b.description,
  publisher: b.publisher,
  publishDate: b.publishDate,
  series: b.series?.name ?? null,
  seriesId: b.series?.id ?? null,
  seriesIndex: b.seriesIndex,
  identifiers: b.identifiers,
  subjects: b.subjects,
  pageCount: b.pageCount,
  chapterCount: b.chapterCount,
  size: b.size,
  addedAt: b.addedAt,
  mtime: b.mtime,
  hasCover: b.hasCover,
  validation: b.validation === null ? null : toValidationSummary(b.validation),
  pendingFixes: (b.pendingFix?.state.proposals ?? []).map(toFixOut),
  autoFixesApplied: (b.pendingFix?.state.autoFixes ?? []).map(toFixOut),
  lineage: b.lineage,
  progress: b.progress,
  rating: b.rating,
});

export type BookDetail = ReturnType<typeof toBookDetail>;

export const describeBookDetail = (b: BookDetail): string => {
  const lines = [
    `"${b.title}" by ${b.author || 'unknown'} — id=${b.id}`,
    b.series !== null ? `Series: ${b.series} #${b.seriesIndex}` : 'Standalone (no series)',
    `Publisher: ${b.publisher || '—'}  Published: ${b.publishDate || '—'}  Pages: ${b.pageCount}`,
    `Subjects: ${b.subjects.length > 0 ? b.subjects.join(', ') : '—'}`,
    b.identifiers.length > 0
      ? `Identifiers: ${b.identifiers.map((i) => `${i.scheme}:${i.value}`).join(', ')}`
      : 'Identifiers: —',
    `Validation: ${describeValidation(b.validation)}`,
  ];
  lines.splice(2, 0, describeRating(b.rating));
  if (b.description) lines.push(`Description: ${b.description.slice(0, 500)}`);
  if (b.pendingFixes.length > 0) {
    lines.push('Recommendations:');
    for (const fix of b.pendingFixes) lines.push(`  - ${describeFix(fix)}`);
  }
  if (b.progress !== null) {
    lines.push(
      `Reading progress: ${Math.round(b.progress.percentage * 100)}% on ${b.progress.device}`
    );
  }
  return lines.join('\n');
};

const DOCUMENT = `
  query GetBook($id: ID!) {
    viewer { library { book(id: $id) { ${BOOK_DETAIL_FIELDS} } } }
  }
`;

type Result = { viewer: { library: { book: BookDetailGql | null } | null } };

/** Shared by the write tools, which re-read the book after a mutation. */
export async function fetchBookDetail(deps: ToolDeps, globalId: string): Promise<BookDetail> {
  const data = await executeDocument<Result>(deps.context, DOCUMENT, { id: globalId });
  const book = data.viewer.library?.book ?? null;
  if (book === null) throw new ToolError(NOT_FOUND_BOOK);
  return toBookDetail(book);
}

export function registerGetBook(server: McpServer, deps: ToolDeps): void {
  server.registerTool(
    'get_book',
    {
      title: 'Get a book',
      description:
        'Full metadata for one book: fields, series, identifiers, validation summary, outstanding ' +
        'metadata recommendations (with the keys resolve_metadata_fixes takes), lineage and reading progress.',
      inputSchema: { bookId: z.string().describe('A book id from search_library or get_series') },
      outputSchema: bookDetailSchema,
      annotations: { readOnlyHint: true, idempotentHint: true, openWorldHint: false },
    },
    (args) =>
      guarded(deps, {}, async () => {
        if (decodeBookId(deps, args.bookId) === null) throw new ToolError(NOT_FOUND_BOOK);
        const book = await fetchBookDetail(deps, args.bookId);
        return ok(describeBookDetail(book), book);
      })
  );
}
