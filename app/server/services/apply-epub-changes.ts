import { randomUUID } from 'crypto';
import * as fs from 'fs';
import * as path from 'path';

import type { PrismaClient } from '@prisma/client';

import { Book, Owner } from '../types';
import { assertValidEpub, toValidationReport } from './epub-validator';
import { buildUpdatedEpub, EpubChanges } from './epub-writer';
import { saveValidation } from './validation';

/**
 * Task 9c, the "no DI, no deps object, no factory closure" convention vs.
 * this interface: DELIBERATELY KEPT, not flattened to positional parameters.
 * The convention targets DI containers/factories that exist to make a
 * dependency swappable behind an interface — that is not what this is.
 * `reimportBook`/`prisma`/`validationThreshold` are a genuinely cohesive
 * unit (a bound write path plus the config it needs) that travels together,
 * unmodified, through THREE call layers: `routes/ui.ts` and
 * `epub-import-pipeline.ts`'s `applyAutoAndAccepted` both construct/forward
 * it into `applyEpubChanges`, which forwards it again into `replaceEpubBytes`
 * below. Flattening would mean repeating the same 3-parameter group in every
 * one of those signatures — `(reimportBook, prisma, validationThreshold,
 * owner, book, changes)` at each layer — which is the "call signature nobody
 * can read" case the spec warns flattening can produce, for no offsetting
 * clarity gain (there are 5 call sites total: `regen-chapters.ts`,
 * `update-metadata.ts`, `resolve-pending-fix.ts`, `replace.ts`, and
 * `routes/ui.ts`, all constructing the identical shape). Contrast
 * `Stores.book` (`graphql/context.ts`, removed this same task): that WAS a
 * DI seam — an interface existing so a class instance could be swapped in —
 * with no cohesion between its methods beyond "things a book might need".
 * This interface has one job and every field earns its place doing it.
 */
export interface ApplyEpubChangesDeps {
  /**
   * Bound to a concrete `(prisma, booksRoot, editionsRoot)` by each caller —
   * see `regen-chapters.ts`, `update-metadata.ts`, `resolve-pending-fix.ts`,
   * `replace.ts`, and `routes/ui.ts` for the closures. Replaced `bookStore:
   * BookStore` when the class was deleted (Task 9b); this is the one method
   * of it this module ever called.
   */
  reimportBook: (owner: Owner, id: string) => Promise<Book | null>;
  prisma: PrismaClient;
  validationThreshold: Parameters<typeof assertValidEpub>[1];
}

/**
 * Durably replace a book's EPUB bytes on disk: validate, atomically swap the
 * file, and re-import so the DB row (and the fingerprint/id) reflect the new
 * bytes. Returns the re-imported book.
 * Throws EpubValidationError / BookHashCollisionError / Error — callers map these.
 */
export async function replaceEpubBytes(
  deps: ApplyEpubChangesDeps,
  owner: Owner,
  book: Book,
  newBytes: Buffer
): Promise<Book> {
  const report = await assertValidEpub(newBytes, deps.validationThreshold);

  // Retain the original bytes so a failed re-import can be rolled back: the
  // swap lands on disk before reimportBook runs, so anything it throws (most
  // notably BookHashCollisionError) would otherwise leave the file changed
  // while the DB row still points at the old fingerprint.
  const originalBytes = fs.readFileSync(book.path);

  const tmpPath = path.join(path.dirname(book.path), `.tmp-${randomUUID()}.epub`);
  try {
    fs.writeFileSync(tmpPath, newBytes);
    fs.renameSync(tmpPath, book.path);
  } catch (err) {
    try {
      fs.unlinkSync(tmpPath);
    } catch {
      /* temp file may not exist */
    }
    throw err;
  }

  // Until reimportBook succeeds the DB still describes the original bytes, so
  // if it throws we restore them to keep disk and DB in sync. Once it returns,
  // the DB reflects the new bytes and the swap is committed — a later failure
  // (e.g. saveValidation) must NOT roll the file back.
  let updated: Book | null;
  try {
    updated = await deps.reimportBook(owner, book.id);
  } catch (err) {
    fs.writeFileSync(book.path, originalBytes);
    throw err;
  }
  if (!updated) {
    fs.writeFileSync(book.path, originalBytes);
    throw new Error('Re-import returned no book after replace');
  }
  await saveValidation(
    deps.prisma,
    owner,
    updated.id,
    toValidationReport(report, deps.validationThreshold)
  );
  return updated;
}

/**
 * Durably apply metadata changes to a book: rebuild the EPUB and delegate to
 * replaceEpubBytes for validation, atomic swap, and re-import.
 */
export async function applyEpubChanges(
  deps: ApplyEpubChangesDeps,
  owner: Owner,
  book: Book,
  changes: EpubChanges
): Promise<Book> {
  return replaceEpubBytes(deps, owner, book, buildUpdatedEpub(book.path, changes));
}
