export type MetadataFix = {
  field: string;
  kind: string;
  from: string;
  to: string | null;
  reason?: string;
  changes: Record<string, string | string[]>;
  fromChips?: string[];
  toChips?: string[];
};

export type UploadFileResult = {
  filename: string;
  bookId: string;
  /** Relay global id for `bookId` (Task 7, book-edit spec) — lets the
   * upload queue build a working Edit link for flag-only proposals, which
   * are produced right here at upload-analysis time, before any later
   * PATCH could otherwise supply one. */
  globalId: string;
  applied: MetadataFix[];
  proposals: MetadataFix[];
};

export type BookListFilter = {
  query?: string;
  author?: string;
  seriesName?: string;
  status?: 'not-started' | 'in-progress' | 'completed';
  subjects?: string[];
  entryType?: 'series' | 'standalone';
};
