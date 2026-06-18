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
  addedAt?: string;
  chapterCount: number;
  chapterSpineMap?: number[];
  chapterNames?: string[];
  pageCount: number;
};

export type Identifier = { scheme: string; value: string };

export type Series = Record<string, BookList>;

export type UploadResult = { uploaded: string[] };

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
