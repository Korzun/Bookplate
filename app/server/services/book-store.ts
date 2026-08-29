import { PrismaClient } from '@prisma/client';

import {
  Book,
  EpubMeta,
  Owner,
  PageCursor,
  BookListFilters,
  SearchSuggestionsResponse,
} from '../types';
import {
  addBook as addBookImpl,
  clearDeviceEditions as clearDeviceEditionsImpl,
  deleteBook as deleteBookImpl,
  reimportBook as reimportBookImpl,
  scan as scanImpl,
} from './book-lifecycle';
import { getStagingDir } from './book-paths';
import { listBooksPage as listBooksPageImpl, type LibraryPage } from './library-page';
import type { ScanProgress } from './scan-events';
import { getSearchSuggestions } from './search-suggestions';
import { getSeriesNextIndex } from './series-meta';

export class BookStore {
  constructor(
    private readonly booksRoot: string,
    private readonly prisma: PrismaClient,
    private readonly editionsRoot: string
  ) {}

  getStagingDir(): string {
    return getStagingDir(this.booksRoot);
  }

  async getSearchSuggestions(
    owner: Owner,
    args: {
      q: string;
      filter: { author?: string; seriesName?: string; activeSubjects?: string[] };
    }
  ): Promise<SearchSuggestionsResponse> {
    return getSearchSuggestions(this.prisma, owner, args);
  }

  async addBook(owner: Owner, id: string, srcPath: string, meta: EpubMeta): Promise<void> {
    return addBookImpl(this.prisma, this.booksRoot, owner, id, srcPath, meta);
  }

  async deleteBook(owner: Owner, id: string): Promise<Book | null> {
    return deleteBookImpl(this.prisma, this.booksRoot, this.editionsRoot, owner, id);
  }

  /**
   * Deletes all cached device editions (DB rows + on-disk files) for a book
   * across every device. Returns the number cleared, or null when the book
   * does not exist. A rare recovery action for when a book's editions get into
   * a bad state; editions regenerate lazily on the next device download.
   */
  async clearDeviceEditions(owner: Owner, id: string): Promise<number | null> {
    return clearDeviceEditionsImpl(this.prisma, this.booksRoot, this.editionsRoot, owner, id);
  }

  async reimportBook(owner: Owner, id: string): Promise<Book | null> {
    return reimportBookImpl(this.prisma, this.booksRoot, this.editionsRoot, owner, id);
  }

  async getSeriesNextIndex(owner: Owner, name: string): Promise<number> {
    return getSeriesNextIndex(this.prisma, owner, name);
  }

  async scan(
    owner: Owner,
    onProgress?: (progress: ScanProgress) => void
  ): Promise<{ imported: string[]; removed: string[] }> {
    return scanImpl(this.prisma, this.booksRoot, owner, onProgress);
  }

  /**
   * `graphql/schema/library/model.ts`'s `Library.entries` calls
   * `services/library-page.ts`'s `listBooksPage` directly (task 8) rather
   * than through this method — same pattern as `getSubjects`/`getAuthors`,
   * which `Library`'s model file already imports straight from
   * `book-catalog.ts`. This wrapper has no remaining caller outside its own
   * type signature; it stays, uncalled, until task 9 removes `BookStore`
   * entirely, so the class keeps compiling in the meantime.
   */
  async listBooksPage(
    owner: Owner,
    cursor: PageCursor | null,
    take: number,
    filters?: BookListFilters
  ): Promise<LibraryPage> {
    return listBooksPageImpl(this.prisma, owner, cursor, take, filters);
  }
}
