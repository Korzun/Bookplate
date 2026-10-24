/**
 * Imports one already-received EPUB file into a reader's library: parse,
 * repair + validate, fingerprint, add, persist the validation report, run
 * metadata detection (auto-fixes applied, the rest left as proposals), and
 * queue thumbnails.
 *
 * Extracted from `routes/ui.ts`'s `POST /api/books/upload` loop so the MCP
 * `upload_book` tool runs the identical pipeline. The route keeps its HTTP
 * concerns (multer, status codes, the response envelope); this function
 * returns a discriminated outcome instead of writing a response. On every
 * outcome but `imported` — and on an unexpected throw — the staged file is
 * removed first, because nothing else will.
 */
import * as fs from 'fs';
import * as path from 'path';

import type { PrismaClient } from '@prisma/client';

import { logger } from '../logger';
import type { AppConfig, EpubMeta, MetadataFix, Owner } from '../types';
import { getBookById, getSubjects } from './book-catalog';
import { BookAlreadyExistsError } from './book-errors';
import { addBook, reimportBook } from './book-lifecycle';
import { analyzeEpub, applyAutoAndAccepted, type EpubAnalysis } from './epub-import-pipeline';
import { parseEpub, partialMD5 } from './epub-parser';
import type { ValidationReport } from './epub-validator';
import { upsertPendingFix } from './pending-fix';
import type { ThumbnailQueue } from './thumbnail-queue';
import { saveValidation } from './validation';

const log = logger('Import');

export type ImportEpubDeps = {
  prisma: PrismaClient;
  config: AppConfig;
  editionsRoot: string;
  thumbnailQueue: ThumbnailQueue;
};

export type ImportEpubFile = {
  /** Where the bytes already are — inside the staging dir, so `addBook` can move them. */
  path: string;
  originalName: string;
  size: number;
};

export type ImportEpubResult =
  | { kind: 'imported'; bookId: string; applied: MetadataFix[]; proposals: MetadataFix[] }
  | { kind: 'parse_failed'; message: string }
  | { kind: 'fingerprint_failed'; message: string }
  | {
      kind: 'invalid';
      validation: Pick<ValidationReport, 'messages' | 'counts' | 'threshold'>;
    }
  | { kind: 'duplicate' };

const unlinkQuiet = (filePath: string): void => {
  try {
    fs.unlinkSync(filePath);
  } catch {
    /* file may already be gone */
  }
};

const describe = (err: unknown): string => (err instanceof Error ? err.message : String(err));

export async function importEpub(
  deps: ImportEpubDeps,
  owner: Owner,
  file: ImportEpubFile
): Promise<ImportEpubResult> {
  const { prisma, config, editionsRoot, thumbnailQueue } = deps;
  const savedPath = file.path;

  let meta: EpubMeta;
  try {
    meta = parseEpub(savedPath);
  } catch (err: unknown) {
    unlinkQuiet(savedPath);
    return { kind: 'parse_failed', message: `Failed to parse EPUB: ${describe(err)}` };
  }

  // Repair (RSC-005) + validate. Detection is deferred to the post-addBook
  // applyAutoAndAccepted call below, which re-detects against the persisted
  // book — skipDetect avoids doing that work twice.
  let analysis: EpubAnalysis;
  try {
    analysis = await analyzeEpub(savedPath, {
      originalName: file.originalName,
      librarySubjects: [],
      validationThreshold: config.validationThreshold,
      skipDetect: true,
    });
  } catch (err: unknown) {
    unlinkQuiet(savedPath);
    throw err;
  }
  if (!analysis.valid) {
    unlinkQuiet(savedPath);
    return {
      kind: 'invalid',
      validation: {
        messages: analysis.report.messages,
        counts: analysis.report.counts,
        threshold: analysis.report.threshold,
      },
    };
  }
  const structuralFix = analysis.structuralFix;

  // Fingerprint reflects the repaired bytes.
  let id: string;
  try {
    id = partialMD5(savedPath);
  } catch (err: unknown) {
    unlinkQuiet(savedPath);
    return { kind: 'fingerprint_failed', message: `Failed to fingerprint EPUB: ${describe(err)}` };
  }

  // parseEpub falls back to the file's basename when no dc:title is present.
  // Since savedPath is a staging path with a unique prefix, we must ignore
  // that fallback and use the client's original filename stem instead.
  const stagedTitleFallback = path.basename(savedPath, path.extname(savedPath));
  const realTitle = meta.title === stagedTitleFallback ? '' : meta.title.trim();
  const titleFallback =
    realTitle || path.basename(file.originalName, path.extname(file.originalName));
  try {
    await addBook(prisma, config.booksDir, owner, id, savedPath, { ...meta, title: titleFallback });
  } catch (err: unknown) {
    unlinkQuiet(savedPath);
    if (err instanceof BookAlreadyExistsError) return { kind: 'duplicate' };
    throw err;
  }
  await saveValidation(prisma, owner, id, analysis.report);

  // Detect metadata issues; auto-apply the high-confidence ones in-request.
  let finalId = id;
  const applied: MetadataFix[] = structuralFix ? [structuralFix] : [];
  const proposals: MetadataFix[] = [];
  try {
    const librarySubjects = await getSubjects(prisma, owner);
    const created = await getBookById(prisma, config.booksDir, owner, id);
    if (created) {
      const result = await applyAutoAndAccepted(
        {
          reimportBook: (o, i) => reimportBook(prisma, config.booksDir, editionsRoot, o, i),
          prisma,
          validationThreshold: config.validationThreshold,
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
    log.warn(`Metadata detection skipped for "${file.originalName}": ${describe(err)}`);
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
      log.warn(`Pending-fix write skipped for "${file.originalName}": ${describe(err)}`);
    }
  }

  thumbnailQueue.enqueue(owner.userId, finalId);
  return { kind: 'imported', bookId: finalId, applied, proposals };
}
