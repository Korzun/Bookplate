import * as fs from 'fs';

import type { PrismaClient } from '@prisma/client';

import { logger } from '../logger';
import { Book, Owner } from '../types';
import { listBooks } from './book-catalog';
import { validateEpubReport, type ValidationReport } from './epub-validator';
import { saveValidation } from './validation';

const log = logger('revalidate-library');

/**
 * Task 9c, the "no DI, no deps object, no factory closure" convention vs.
 * this interface: DELIBERATELY KEPT, same reasoning as `ApplyEpubChangesDeps`
 * (`apply-epub-changes.ts`, this task's other instance of this decision) —
 * see that file's doc comment for the full argument. `prisma`/`booksRoot`/
 * `validationThreshold` is a `PrismaClient` plus the config a validation
 * pass needs, not a swappable-behind-an-interface dependency: it travels
 * unmodified from `revalidateLibrary` into `revalidateBook` below (via
 * `Pick`, since `revalidateBook` needs only two of the three fields), and
 * `revalidateLibrary`'s own one call site (`library/mutation/scan.ts`)
 * constructs it fresh from the same three values every time. Flattening
 * would just turn one 2-parameter object into 2-3 positional parameters
 * repeated at both layers, for no clarity gain.
 */
export interface RevalidateDeps {
  prisma: PrismaClient;
  booksRoot: string;
  validationThreshold: Parameters<typeof validateEpubReport>[1];
}

// Validate one stored book against the configured threshold and persist the
// report. Returns the report. Throws if the file can't be read.
export async function revalidateBook(
  deps: Pick<RevalidateDeps, 'prisma' | 'validationThreshold'>,
  owner: Owner,
  book: Book
): Promise<ValidationReport> {
  const report = await validateEpubReport(fs.readFileSync(book.path), deps.validationThreshold);
  await saveValidation(deps.prisma, owner, book.id, report);
  return report;
}

// Re-validate every book in the owner's library, sequentially. A per-book
// failure is logged and counted; it never aborts the pass.
export async function revalidateLibrary(
  deps: RevalidateDeps,
  owner: Owner
): Promise<{ validated: number; failed: number }> {
  const books = await listBooks(deps.prisma, deps.booksRoot, owner);
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
