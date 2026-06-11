export interface Book {
  id: string; // 32-char partial MD5 (KoReader binary algorithm) — matches KOSync progress.document
  /**
   * User-facing download name derived from metadata
   * ([author]-[series]-[index]-[title].epub). NOT the on-disk filename — every
   * book is stored as `<id>.epub`.
   */
  filename: string;
  /** Absolute on-disk path: `<booksRoot>/<username>/<id>.epub`. */
  path: string;
  title: string;
  fileAs: string;
  author: string;
  description: string;
  publisher: string;
  series: string;
  seriesIndex: number; // REAL — supports fractional entries like 2.5
  identifiers: { scheme: string; value: string }[];
  subjects: string[];
  hasCover: boolean; // true when cover blob is present in SQLite
  size: number;
  mtime: Date;
  addedAt: Date;
  chapterCount: number;
  chapterSpineMap: number[];
  chapterNames: string[];
  pageCount: number;
}

export interface EpubMeta {
  title: string;
  fileAs: string;
  author: string;
  description: string;
  publisher: string;
  series: string;
  seriesIndex: number;
  identifiers: { scheme: string; value: string }[];
  subjects: string[];
  coverData: Buffer | null;
  coverMime: string | null;
  chapterCount: number;
  chapterSpineMap: number[];
  chapterNames: string[];
  pageCount: number;
}

export interface Progress {
  document: string;
  progress: string;
  percentage: number;
  device: string;
  device_id: string;
  timestamp: number;
}

/** Identifies the user whose library an operation targets. */
export interface Owner {
  /** Surrogate user ID — scopes all database queries. */
  userId: string;
  /** Username — names the on-disk folder `<booksRoot>/<username>/`. */
  username: string;
}

export interface AppConfig {
  username: string;
  password: string;
  booksDir: string;
  dataDir: string;
  port: number;
  maxConcurrentUploads: number;
  thumbnailWidths: number[];
}
