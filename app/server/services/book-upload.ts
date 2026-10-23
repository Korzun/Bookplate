import * as path from 'path';

import type { ValidationThreshold } from '@korzun/epubcheck-ts';
import type { PrismaClient } from '@prisma/client';

import { logger } from '../logger';
import type { EpubMeta, MetadataFix, Owner } from '../types';
import { getBookById, getSubjects } from './book-catalog';
import { BookAlreadyExistsError } from './book-errors';
import { addBook, reimportBook } from './book-lifecycle';
import { analyzeEpub, applyAutoAndAccepted, type EpubAnalysis } from './epub-import-pipeline';
import { parseEpub, partialMD5 } from './epub-parser';
import type { ValidationReport } from './epub-validator';
import { upsertPendingFix } from './pending-fix';
import { saveValidation } from './validation';

const log = logger('BookUpload');

export type ImportUploadedEpubDeps = {
  prisma: PrismaClient;
  booksDir: string;
  editionsRoot: string;
  validationThreshold: ValidationThreshold;
  thumbnails: { enqueue: (userId: string, bookId: string) => void };
};

export type UploadedEpub = {
  /** Where the bytes are now. Moved into the library on success. */
  readonly path: string;
  /** The uploader's own file name — the title fallback and a detection input. */
  readonly originalName: string;
  readonly size: number;
};

export type ImportUploadedEpubOutcome =
  | {
      readonly kind: 'added';
      readonly bookId: string;
      readonly applied: MetadataFix[];
      readonly proposals: MetadataFix[];
    }
  /** The file could not be parsed or fingerprinted at all. */
  | { readonly kind: 'unreadable'; readonly message: string }
  /** It parsed, but failed epubcheck at the configured threshold. */
  | { readonly kind: 'invalid'; readonly report: ValidationReport }
  /** The (repaired) content's fingerprint is already a book in this library. */
  | { readonly kind: 'duplicate'; readonly existingId: string };

const errorMessage = (err: unknown): string => (err instanceof Error ? err.message : String(err));

/**
 * Adds one uploaded EPUB to `owner`'s library: parse, repair (RSC-005) and
 * validate, fingerprint, add, persist the validation report, then detect
 * metadata issues — auto-applying the high-confidence ones and recording the
 * rest as a pending fix — and queue its thumbnails.
 *
 * Extracted verbatim from `POST /api/books/upload` (`routes/ui.ts`) so that
 * route and the GraphQL `bookAdd` mutation (which the MCP `add_book` tool
 * drives) cannot drift apart. The steps, their order and their best-effort
 * rules are unchanged from that route.
 *
 * Every expected failure is an outcome, not a throw. On any outcome but
 * `added`, the file is left where it was — cleaning it up belongs to the
 * caller, which knows whether it is a multer temp file or a staged upload.
 * An unexpected failure (e.g. epubcheck itself crashing) still throws.
 */
export async function importUploadedEpub(
  deps: ImportUploadedEpubDeps,
  owner: Owner,
  file: UploadedEpub
): Promise<ImportUploadedEpubOutcome> {
  const { prisma, booksDir, editionsRoot, validationThreshold } = deps;

  let meta: EpubMeta;
  try {
    meta = parseEpub(file.path);
  } catch (err: unknown) {
    return { kind: 'unreadable', message: `Failed to parse EPUB: ${errorMessage(err)}` };
  }

  // Repair (RSC-005) + validate. Detection is deferred to the post-addBook
  // applyAutoAndAccepted call below, which re-detects against the persisted
  // book — skipDetect avoids doing that work twice.
  const analysis: EpubAnalysis = await analyzeEpub(file.path, {
    originalName: file.originalName,
    librarySubjects: [],
    validationThreshold,
    skipDetect: true,
  });
  if (!analysis.valid) return { kind: 'invalid', report: analysis.report };
  const structuralFix = analysis.structuralFix;

  // Fingerprint reflects the repaired bytes.
  let id: string;
  try {
    id = partialMD5(file.path);
  } catch (err: unknown) {
    return { kind: 'unreadable', message: `Failed to fingerprint EPUB: ${errorMessage(err)}` };
  }

  // parseEpub falls back to the file's basename when no dc:title is present.
  // The path on disk is a temp/staging name, so ignore that fallback and use
  // the uploader's original filename stem instead.
  const onDiskStem = path.basename(file.path, path.extname(file.path));
  const realTitle = meta.title === onDiskStem ? '' : meta.title.trim();
  const title = realTitle || path.basename(file.originalName, path.extname(file.originalName));
  try {
    await addBook(prisma, booksDir, owner, id, file.path, { ...meta, title });
  } catch (err: unknown) {
    if (err instanceof BookAlreadyExistsError) return { kind: 'duplicate', existingId: id };
    throw err;
  }
  await saveValidation(prisma, owner, id, analysis.report);

  // Detect metadata issues; auto-apply the high-confidence ones in-request.
  let finalId = id;
  const applied: MetadataFix[] = structuralFix ? [structuralFix] : [];
  const proposals: MetadataFix[] = [];
  try {
    const librarySubjects = await getSubjects(prisma, owner);
    const created = await getBookById(prisma, booksDir, owner, id);
    if (created) {
      const result = await applyAutoAndAccepted(
        {
          reimportBook: (o, i) => reimportBook(prisma, booksDir, editionsRoot, o, i),
          prisma,
          validationThreshold,
        },
        owner,
        created,
        { originalName: file.originalName, librarySubjects, acceptedKeys: [] }
      );
      finalId = result.book.id;
      applied.push(...result.applied);
      proposals.push(...result.proposals);
    }
  } catch (err: unknown) {
    log.warn(`Metadata detection skipped for "${file.originalName}": ${errorMessage(err)}`);
  }

  if (proposals.length > 0) {
    try {
      await upsertPendingFix(prisma, owner, finalId, file.originalName, file.size, {
        autoFixes: applied,
        appliedFixes: [],
        proposals,
        undo: null,
      });
    } catch (err: unknown) {
      // Never fail an upload because a pending-fix write failed — the upload
      // already succeeded; the book just won't show proposals until retried.
      log.warn(`Pending-fix write skipped for "${file.originalName}": ${errorMessage(err)}`);
    }
  }

  deps.thumbnails.enqueue(owner.userId, finalId);
  return { kind: 'added', bookId: finalId, applied, proposals };
}
