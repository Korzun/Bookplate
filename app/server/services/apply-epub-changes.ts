import { randomUUID } from 'crypto';
import * as fs from 'fs';
import * as path from 'path';

import { Book, Owner } from '../types';
import { BookStore } from './book-store';
import { assertValidEpub } from './epub-validator';
import { buildUpdatedEpub, EpubChanges } from './epub-writer';

export interface ApplyEpubChangesDeps {
  bookStore: BookStore;
  validationThreshold: Parameters<typeof assertValidEpub>[1];
}

/**
 * Durably apply metadata changes to a book: rebuild the EPUB, validate it,
 * atomically replace the file on disk, and re-import so the DB row (and the
 * fingerprint/id) reflect the new bytes. Returns the re-imported book.
 * Throws EpubValidationError / BookHashCollisionError / Error — callers map these.
 */
export async function applyEpubChanges(
  deps: ApplyEpubChangesDeps,
  owner: Owner,
  book: Book,
  changes: EpubChanges
): Promise<Book> {
  const updatedBytes = buildUpdatedEpub(book.path, changes);
  await assertValidEpub(updatedBytes, deps.validationThreshold);

  const tmpPath = path.join(path.dirname(book.path), `.tmp-${randomUUID()}.epub`);
  try {
    fs.writeFileSync(tmpPath, updatedBytes);
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
  if (!updated) throw new Error('Re-import returned no book after update');
  return updated;
}
