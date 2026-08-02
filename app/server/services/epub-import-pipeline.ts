import { randomUUID } from 'crypto';
import * as fs from 'fs';
import * as path from 'path';

import type { ValidationThreshold } from '@korzun/epubcheck-ts';

import { logger } from '../logger';
import { Book, MetadataFix, Owner } from '../types';
import { detectMetadataIssues, MetadataIssue } from '../utils/metadata-issues';
import { applyEpubChanges, ApplyEpubChangesDeps } from './apply-epub-changes';
import { parseEpub } from './epub-parser';
import {
  assertValidEpub,
  EpubValidationError,
  toValidationReport,
  ValidationReport,
} from './epub-validator';
import { EpubChanges, repairPackageDocument } from './epub-writer';

const log = logger('EpubImportPipeline');

// Convert a detected issue into the persisted/wire fix shape. Moved here from
// ui.ts (the upload route) so the replace flow can share it.
export function toFix(issue: MetadataIssue): MetadataFix {
  return {
    field: issue.field,
    kind: issue.kind,
    from: issue.from,
    to: issue.to,
    ...(issue.reason ? { reason: issue.reason } : {}),
    changes: issue.changes,
    ...(issue.fromChips ? { fromChips: issue.fromChips } : {}),
    ...(issue.toChips ? { toChips: issue.toChips } : {}),
  };
}

// Stable identity for a fix, used to track which proposals a caller accepted
// across a request boundary (upload's pending-fix rows, replace's
// acceptedFixKeys).
export const fixKey = (f: MetadataFix): string => `${f.field}:${f.kind}:${f.from}`;

// Replace `compound` (case-insensitive) with `parts` in a subjects array,
// de-duplicating case-insensitively. Adds the parts if the compound is gone.
// Mirrors the client upload flow's applySplit (use-upload-queue.ts): a
// subjects-split fix carries its edit in fromChips/toChips rather than a plain
// `changes` merge, so it must be folded into the book's CURRENT subjects.
//
// Exported (Task 4, `bookResolvePendingFix`): that mutation folds a
// `PendingFix`'s STORED proposals into an `EpubChanges` object the same way
// `applyAutoAndAccepted` folds freshly re-detected ones below — same
// subjects-split payload shape (`fromChips`/`toChips`, empty `changes`), same
// fold rule — so it reuses this helper rather than a third copy.
export function applySplit(subjects: string[], compound: string, parts: string[]): string[] {
  const idx = subjects.findIndex((s) => s.toLowerCase() === compound.toLowerCase());
  const next =
    idx >= 0
      ? [...subjects.slice(0, idx), ...parts, ...subjects.slice(idx + 1)]
      : [...subjects, ...parts];
  return next.filter((s, i) => next.findIndex((o) => o.toLowerCase() === s.toLowerCase()) === i);
}

export interface EpubAnalysis {
  valid: boolean;
  report: ValidationReport;
  repairedBytes: Buffer;
  structuralFix: MetadataFix | null;
  autoFixes: MetadataFix[];
  proposals: MetadataFix[];
}

export interface AnalyzeEpubOptions {
  originalName: string;
  librarySubjects: string[];
  validationThreshold: ValidationThreshold;
  /**
   * Skip the detectMetadataIssues pass — autoFixes/proposals come back empty
   * (aside from any structural fix). Set by callers (upload) that immediately
   * re-detect against the persisted book via applyAutoAndAccepted, so the
   * detection work isn't done twice for the same content.
   */
  skipDetect?: boolean;
}

/**
 * Read-only analysis of a candidate EPUB on disk: repairs the RSC-005
 * dcterms:modified count in place (so the file this points at ends up
 * matching what will be persisted), validates the repaired bytes, and
 * (unless `skipDetect`) detects metadata issues from the parsed metadata,
 * split into auto-eligible and proposal-only fixes. Never creates or
 * modifies a book.
 */
export async function analyzeEpub(
  filePath: string,
  opts: AnalyzeEpubOptions
): Promise<EpubAnalysis> {
  // Pre-validation repair: fix the RSC-005 dcterms:modified count so the file
  // passes validation. Best-effort — on failure fall through to validation,
  // which rejects it exactly as before.
  let structuralFix: MetadataFix | null = null;
  try {
    const repair = repairPackageDocument(filePath);
    if (repair.repaired) {
      const tmpPath = path.join(
        path.dirname(filePath),
        `.tmp-repair-${randomUUID()}${path.extname(filePath)}`
      );
      try {
        fs.writeFileSync(tmpPath, repair.bytes);
        fs.renameSync(tmpPath, filePath);
      } catch (err) {
        try {
          fs.unlinkSync(tmpPath);
        } catch {
          /* temp file may not exist */
        }
        throw err;
      }
      structuralFix =
        repair.action === 'injected'
          ? {
              field: 'document',
              kind: 'missing-modified-date',
              from: '',
              to: 'added a missing modification date',
              changes: {},
            }
          : {
              field: 'document',
              kind: 'duplicate-modified-date',
              from: '',
              to: 'removed a duplicate modification date',
              changes: {},
            };
    }
  } catch (err: unknown) {
    log.warn(
      `Package repair skipped for "${opts.originalName}": ${err instanceof Error ? err.message : String(err)}`
    );
  }

  const repairedBytes = fs.readFileSync(filePath);
  let valid = true;
  let report: ValidationReport;
  try {
    const rawReport = await assertValidEpub(repairedBytes, opts.validationThreshold);
    report = toValidationReport(rawReport, opts.validationThreshold);
  } catch (err: unknown) {
    if (err instanceof EpubValidationError) {
      valid = false;
      report = {
        valid: false,
        messages: err.messages,
        counts: err.counts,
        threshold: err.threshold,
      };
    } else {
      throw err;
    }
  }

  let autoFixes: MetadataFix[] = structuralFix ? [structuralFix] : [];
  let proposals: MetadataFix[] = [];

  if (valid && !opts.skipDetect) {
    // parseEpub falls back to the file's basename when no dc:title is
    // present. Since filePath is typically a staging path with a unique
    // prefix, we must ignore that fallback and use the client's original
    // filename stem instead.
    const meta = parseEpub(filePath);
    const fileTitleFallback = path.basename(filePath, path.extname(filePath));
    const realTitle = meta.title === fileTitleFallback ? '' : meta.title.trim();
    const titleFallback =
      realTitle || path.basename(opts.originalName, path.extname(opts.originalName));

    const issues = detectMetadataIssues({
      title: titleFallback,
      titleSort: meta.titleSort,
      author: meta.author,
      authorSort: meta.authorSort,
      subjects: meta.subjects,
      filenameStem: path.basename(opts.originalName, path.extname(opts.originalName)),
      librarySubjects: opts.librarySubjects,
    });
    const autoIssues = issues.filter((i) => i.autoEligible);
    const proposalIssues = issues.filter((i) => !i.autoEligible);
    autoFixes = autoFixes.concat(autoIssues.map(toFix));
    proposals = proposalIssues.map(toFix);
  }

  return { valid, report, repairedBytes, structuralFix, autoFixes, proposals };
}

export interface ApplyAutoAndAcceptedOptions {
  originalName: string;
  librarySubjects: string[];
  acceptedKeys: string[];
}

export interface ApplyAutoAndAcceptedResult {
  book: Book;
  applied: MetadataFix[];
  proposals: MetadataFix[];
}

/**
 * Detect metadata issues on `book`'s current (persisted) metadata, and apply
 * the auto-eligible ones plus any proposal whose key is in `acceptedKeys` via
 * applyEpubChanges. Never fails the caller's request — if the write itself
 * fails, the would-be changes come back as proposals instead of applied
 * fixes. Returns the (possibly re-imported) book, the fixes actually
 * applied, and the remaining (unaccepted) proposals.
 */
export async function applyAutoAndAccepted(
  deps: ApplyEpubChangesDeps,
  owner: Owner,
  book: Book,
  opts: ApplyAutoAndAcceptedOptions
): Promise<ApplyAutoAndAcceptedResult> {
  const issues = detectMetadataIssues({
    title: book.title,
    titleSort: book.titleSort,
    author: book.author,
    authorSort: book.authorSort,
    subjects: book.subjects,
    filenameStem: path.basename(opts.originalName, path.extname(opts.originalName)),
    librarySubjects: opts.librarySubjects,
  });
  const autoIssues = issues.filter((i) => i.autoEligible);
  const proposalIssues = issues.filter((i) => !i.autoEligible);
  const acceptedSet = new Set(opts.acceptedKeys);
  const acceptedIssues = proposalIssues.filter((i) => acceptedSet.has(fixKey(toFix(i))));
  const remainingIssues = proposalIssues.filter((i) => !acceptedSet.has(fixKey(toFix(i))));

  const toApplyIssues = [...autoIssues, ...acceptedIssues];
  if (toApplyIssues.length === 0) {
    return { book, applied: [], proposals: remainingIssues.map(toFix) };
  }

  const changes: EpubChanges = {};
  let subjects = [...book.subjects];
  let subjectsChanged = false;
  for (const issue of toApplyIssues) {
    if (issue.kind === 'subjects-split') {
      // The split's payload lives in fromChips/toChips (its `changes` is empty);
      // fold it into the running subjects array instead of merging `changes`.
      subjects = applySplit(subjects, issue.fromChips?.[0] ?? issue.from, issue.toChips ?? []);
      subjectsChanged = true;
    } else {
      Object.assign(changes, issue.changes);
    }
  }
  if (subjectsChanged) changes.subjects = subjects;
  // The on-disk EPUB may have no genuine dc:title (book.title is then the
  // filename-fallback substituted at creation time). reimportBook (invoked by
  // applyEpubChanges below) re-derives the title from the on-disk EPUB bytes,
  // which would silently clobber that fallback with a hash-like id unless we
  // write it back in. Skip this if an issue already set a real title change.
  if (changes.title === undefined) {
    const currentMeta = parseEpub(book.path);
    const onDiskFallback = path.basename(book.path, path.extname(book.path));
    const realTitle = currentMeta.title === onDiskFallback ? '' : currentMeta.title.trim();
    if (realTitle === '') {
      changes.title = book.title;
    }
  }

  try {
    const updated = await applyEpubChanges(deps, owner, book, changes);
    return {
      book: updated,
      applied: toApplyIssues.map(toFix),
      proposals: remainingIssues.map(toFix),
    };
  } catch (err: unknown) {
    // Never fail the caller because a cosmetic fix failed — surface it as a
    // proposal instead.
    log.warn(
      `Auto-fix skipped for "${opts.originalName}": ${err instanceof Error ? err.message : String(err)}`
    );
    return {
      book,
      applied: [],
      proposals: [...toApplyIssues.map(toFix), ...remainingIssues.map(toFix)],
    };
  }
}
