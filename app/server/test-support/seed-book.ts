import type { PrismaClient } from '@prisma/client';

import { addBook } from '../services/book-lifecycle';
import type { EpubMeta, Owner } from '../types';

/**
 * Test-only wiring for `addBook` — replaces `new BookStore(booksRoot, prisma,
 * editionsRoot).addBook(...)` now that the class is gone (Task 9b). Excluded
 * from the production build the same way `test-util.ts` is (see
 * `tsconfig.json`'s comment) since nothing here is reachable from production
 * code.
 *
 * Deliberately as thin as `BookStore.addBook` itself was: `srcPath` and
 * `meta` are still the caller's job (most call sites already have a local
 * `stage(id, content)` helper writing fixture bytes, and their own
 * `EpubMeta` fixture) — this only removes the class instantiation, not the
 * staging step. `roots` is an object (not a bare `booksRoot: string`) so a
 * call site reads as "the on-disk roots this seed writes under", matching
 * `ApplyEpubChangesDeps`-style dependency objects elsewhere, and so a second
 * root (e.g. `editionsRoot`) could join it later without changing every call
 * site's shape.
 */
export async function seedBook(
  prisma: PrismaClient,
  roots: { booksRoot: string },
  owner: Owner,
  id: string,
  srcPath: string,
  meta: EpubMeta
): Promise<void> {
  return addBook(prisma, roots.booksRoot, owner, id, srcPath, meta);
}
