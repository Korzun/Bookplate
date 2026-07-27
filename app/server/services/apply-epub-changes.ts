import { randomUUID } from 'crypto';
import * as fs from 'fs';
import * as path from 'path';

import { Book, Owner } from '../types';
import { BookStore } from './book-store';
import { assertValidEpub, toValidationReport } from './epub-validator';
import { buildUpdatedEpub, EpubChanges } from './epub-writer';
import { ValidationStore } from './validation-store';

export interface ApplyEpubChangesDeps {
  bookStore: BookStore;
  validationStore: ValidationStore;
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

  const updated = await deps.bookStore.reimportBook(owner, book.id);
  if (!updated) throw new Error('Re-import returned no book after replace');
  await deps.validationStore.saveValidation(
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
