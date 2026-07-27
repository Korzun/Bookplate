import * as fs from 'fs';

import { logger } from '../logger';
import { Book, Owner } from '../types';
import { BookStore } from './book-store';
import { validateEpubReport, type ValidationReport } from './epub-validator';
import { ValidationStore } from './validation-store';

const log = logger('revalidate-library');

export interface RevalidateDeps {
  bookStore: BookStore;
  validationStore: ValidationStore;
  validationThreshold: Parameters<typeof validateEpubReport>[1];
}

// Validate one stored book against the configured threshold and persist the
// report. Returns the report. Throws if the file can't be read.
export async function revalidateBook(
  deps: Pick<RevalidateDeps, 'validationStore' | 'validationThreshold'>,
  owner: Owner,
  book: Book
): Promise<ValidationReport> {
  const report = await validateEpubReport(fs.readFileSync(book.path), deps.validationThreshold);
  await deps.validationStore.saveValidation(owner, book.id, report);
  return report;
}

// Re-validate every book in the owner's library, sequentially. A per-book
// failure is logged and counted; it never aborts the pass.
export async function revalidateLibrary(
  deps: RevalidateDeps,
  owner: Owner
): Promise<{ validated: number; failed: number }> {
  const books = await deps.bookStore.listBooks(owner);
  let validated = 0;
  let failed = 0;
  for (const book of books) {
    try {
      await revalidateBook(deps, owner, book);
      validated++;
    } catch (err: unknown) {
      log.warn(
        `revalidate: skipping "${book.filename}" — ${err instanceof Error ? err.message : String(err)}`
      );
      failed++;
    }
  }
  return { validated, failed };
}
