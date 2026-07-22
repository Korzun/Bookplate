export type BookList = Record<string, Book>;

export type Book = {
  id: string;
  title: string;
  author: string;
  titleSort: string;
  authorSort: string;
  publishDate: string;
  publisher?: string;
  series: string;
  seriesIndex: number;
  description?: string;
  subjects: string[];
  identifiers: Identifier[];
  hasCover: boolean;
  size: number;
  /** ISO timestamp of the source file's last modification; changes when the cover changes. */
  mtime?: string;
  addedAt?: string;
  chapterCount: number;
  chapterSpineMap?: number[];
  chapterNames?: string[];
  pageCount: number;
  /** Cached device editions across all devices; present on the single-book detail fetch. */
  deviceEditionCount?: number;
};

export type Identifier = { scheme: string; value: string };

export type Series = Record<string, BookList>;

export type MetadataFix = {
  field: string;
  kind: string;
  from: string;
  to: string | null;
  reason?: string;
  changes: Record<string, string | string[]>;
};

export type UploadFileResult = {
  filename: string;
  bookId: string;
  applied: MetadataFix[];
  proposals: MetadataFix[];
};

export type UploadResult = { uploaded: string[]; results: UploadFileResult[] };

export type DisplayUnit =
  | { type: 'standalone'; bookId: string }
  | { type: 'series'; seriesName: string };

export type BookListFilter = {
  query?: string;
  author?: string;
  seriesName?: string;
  status?: 'not-started' | 'in-progress' | 'completed';
  subjects?: string[];
  entryType?: 'series' | 'standalone';
};

export type BookSummary = Omit<
  Book,
  'description' | 'identifiers' | 'subjects' | 'addedAt' | 'chapterSpineMap' | 'chapterNames'
>;

export type PagedBookListResponse = {
  items: DisplayUnit[];
  books: BookSummary[];
  nextCursor: string | null;
};
