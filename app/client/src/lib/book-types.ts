/**
 * Shared client-side book/upload TYPES, with no fetching attached.
 *
 * These lived in `provider/book/type.ts` (and, for `ReplaceAnalysis`, in
 * `provider/book/hook/use-replace-book.ts`) until Task 8 dissolved that
 * directory. They could not simply be deleted with it: none of them is a
 * GraphQL selection type, and several are read by modules this project
 * KEEPS — most visibly `provider/upload/hook/use-upload-queue.ts` and
 * `provider/upload/hook/use-upload-transport.ts`, which stay on the XHR
 * transport queue Task 9 preserves.
 *
 * The rule that put them here: a type describing data the client passes
 * AROUND (queue items, form filters, analysis results) belongs in `~/lib`,
 * next to the other transport-agnostic helpers. A type describing a
 * document's SELECTION belongs to codegen — which is why `BookEditBook`, the
 * hand-written mirror of `BookEditDocument`'s `book` selection, is NOT here:
 * `component/book-edit-form` now declares `BookEditFormFragment` and takes
 * `FragmentType<typeof BookEditFormFragment>`, so the generated type is the
 * only description of that shape and cannot drift from the document.
 */

/**
 * One metadata correction proposed (or already applied) by an import.
 *
 * The unmasked, plain-object counterpart to `MetadataFixFragment`
 * (`graphql/upload.ts`). Deliberately NOT the generated fragment type: this
 * shape is what the upload QUEUE carries in local state — items that exist
 * before any GraphQL round trip has happened for them — so it uses
 * `undefined` for absent optional values where the wire shape uses `null`.
 * `toMetadataFix` helpers at each unmask site do that conversion.
 */
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

/** One finished upload, as `provider/upload`'s XHR transport reports it. */
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

/**
 * The library grid's filter. Pure URL state — `lib/use-book-list-filter.ts`
 * is its only producer and the URL search params its only storage.
 */
export type BookListFilter = {
  query?: string;
  author?: string;
  seriesName?: string;
  status?: 'not-started' | 'in-progress' | 'completed';
  subjects?: string[];
  entryType?: 'series' | 'standalone';
};

/**
 * What `bookAnalyzeReplace` tells the replace modal about a candidate file,
 * unmasked into plain `MetadataFix`es. Produced by
 * `control/upload-replace-modal`'s own `analyzeReplacement`.
 */
export interface ReplaceAnalysis {
  valid: boolean;
  autoFixes: MetadataFix[];
  proposals: MetadataFix[];
}
