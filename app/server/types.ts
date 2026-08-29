import type { ValidationThreshold } from '@korzun/epubcheck-ts';

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
  titleSort: string;
  authorSort: string;
  publishDate: string;
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
  /** Stored validation result: true = valid, false = failed, null = never validated. */
  valid?: boolean | null;
  /** Cached device editions for this book across all devices. Present only on the single-book detail fetch. */
  deviceEditionCount?: number;
}

export interface EpubMeta {
  title: string;
  titleSort: string;
  authorSort: string;
  publishDate: string;
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

export type BookListFilters = {
  query?: string;
  author?: string;
  seriesName?: string;
  status?: 'not-started' | 'in-progress' | 'completed';
  subjects?: string[];
  entryType?: 'series' | 'standalone';
};

export type SearchSuggestionsResponse = {
  groups: Array<{
    type: 'author' | 'series' | 'book' | 'subject';
    items: Array<{ label: string; value: string; matchStart: number; matchLength: number }>;
  }>;
};

/** Opaque base64-encoded JSON cursor stored in the client and echoed back on subsequent requests. */
export type PageCursor = {
  k: string; // sort key of the last display unit on the page
  t: 's' | 'b'; // 's' = series, 'b' = standalone book
  id: string; // secondary tiebreaker: series id for series, book id for standalones
};

/** Keyset cursor for progress pagination: last (timestamp, document) on a page. */
export type ProgressPageCursor = {
  timestamp: number;
  document: string;
};

export interface AppConfig {
  libraryName: string;
  username: string;
  password: string;
  booksDir: string;
  dataDir: string;
  port: number;
  maxConcurrentUploads: number;
  thumbnailWidths: number[];
  validationThreshold: ValidationThreshold;
  /**
   * How many reverse-proxy hops in front of this process to trust when
   * resolving a request's real client IP — used ONLY by `routes/ui.ts`'s
   * login rate limiter (`resolveLoginClientIp`), never as Express's own
   * `trust proxy` setting (deliberately not touched — that setting also
   * changes `req.secure`/cookie semantics app-wide, a strictly bigger
   * change than this one control needs). `0` (the default when unset,
   * including every existing `AppConfig` literal in the test suite, which
   * is why this is optional rather than required) means "trust nothing":
   * the limiter keys on the raw TCP peer address, ignoring
   * `X-Forwarded-For` entirely — safe, if wrong, behind an untrusted-proxy
   * or no-proxy deployment. Set to `1` for a single reverse proxy or
   * Cloudflare Tunnel directly in front of this process (the deployment
   * `README.md` documents); higher values trust that many chained hops.
   * NEVER set this higher than the actual number of proxies you control —
   * an unfilled/over-counted hop lets a client forge its own
   * `X-Forwarded-For` entry and pick an arbitrary rate-limit bucket,
   * defeating the limiter entirely.
   */
  trustProxyHops?: number;
}

export interface Device {
  id: string;
  name: string;
  slug: string;
  coverWidth: number | null;
  coverHeight: number | null;
  coverFit: 'contain' | 'cover' | 'fill' | 'smart';
  bwCover: boolean;
  simplify: boolean;
}

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

export type UndoSnapshot = {
  kind: 'apply' | 'dismiss';
  proposals: MetadataFix[];
  appliedFixes: MetadataFix[];
  originalMetadata?: Record<string, string | string[]>;
};

export type PendingFixState = {
  autoFixes: MetadataFix[];
  appliedFixes: MetadataFix[];
  proposals: MetadataFix[];
  undo: UndoSnapshot | null;
};
