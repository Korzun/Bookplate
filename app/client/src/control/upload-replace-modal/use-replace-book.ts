import { useMutation } from '@apollo/client/react';
import { useCallback, useMemo, useRef, useState } from 'react';

import { useFragment as unmaskFragment } from '~/gql';
import type { BookAnalyzeReplaceMutation, BookReplaceMutation } from '~/gql/graphql';
import {
  BookAnalyzeReplaceDocument,
  BookReplaceDocument,
  MetadataFixFragment,
} from '~/graphql/upload';
import type { MetadataFix, ReplaceAnalysis } from '~/lib/book-types';
import { stageUpload } from '~/lib/staged-upload';
import { unwrapResult } from '~/provider/apollo';
import { useCurrentLibraryId } from '~/provider/library-target';

// `unwrapResult`'s `TPayload` sits in a position TypeScript cannot infer from
// the call, so it is named explicitly here, extracted from the generated
// union rather than hand-duplicated — same shape as `component/book-edit-form`'s save.
type BookAnalyzeReplacePayload = Extract<
  NonNullable<BookAnalyzeReplaceMutation['bookAnalyzeReplace']>,
  { __typename: 'BookAnalyzeReplacePayload' }
>;
type BookReplacePayload = Extract<
  NonNullable<BookReplaceMutation['bookReplace']>,
  { __typename: 'BookReplacePayload' }
>;

/** The bare minimum `bookReplace` resolves — just enough for a caller to
 * navigate to the post-replace book. `BookReplacePayload.book` also carries
 * `title`/`author`, but nothing here reads them. */
export type ReplacedBook = { id: string };

export interface UseReplaceBook {
  analyzeReplacement: (id: string, file: File) => Promise<ReplaceAnalysis | undefined>;
  commitReplacement: (id: string, acceptedFixKeys: string[]) => Promise<ReplacedBook | undefined>;
  analyzing: boolean;
  committing: boolean;
  commitError: string | undefined;
}

/** Mirrors `provider/upload/hook/use-upload-queue.ts`'s own `toMetadataFix`
 * — the same `MetadataFixFragment` shape unmasked into the plain
 * `MetadataFix` type (`~/lib/book-types`) this modal's children (`FixReview`)
 * already expect. Not imported from there since that module doesn't export
 * it. */
const toMetadataFix = (f: {
  field: string;
  kind: string;
  from: string;
  to: string | null;
  reason: string | null;
  fromChips: string[] | null;
  toChips: string[] | null;
  changes: unknown;
}): MetadataFix => ({
  field: f.field,
  kind: f.kind,
  from: f.from,
  to: f.to,
  reason: f.reason ?? undefined,
  changes: (f.changes ?? {}) as Record<string, string | string[]>,
  fromChips: f.fromChips ?? undefined,
  toChips: f.toChips ?? undefined,
});

/**
 * Replaces a book's underlying EPUB file over GraphQL via the sanctioned
 * staging seam (`~/lib/staged-upload`, the same pattern step 7 established
 * for staged covers in `component/book-edit-form`'s save): file bytes have no
 * GraphQL transport, so `analyzeReplacement` posts the file to the REST
 * staging endpoint FIRST and only then calls `bookAnalyzeReplace` with the
 * resolved `stagedUploadId`.
 *
 * **Staged exactly ONCE.** `bookAnalyzeReplace` is explicitly read-only and
 * does not consume the staged upload (its own doc comment in
 * `graphql/upload.ts`), so the SAME `stagedUploadId` `analyzeReplacement`
 * resolves is kept in a ref and reused by `commitReplacement` — it never
 * re-stages the file. This is why `commitReplacement` no longer takes a
 * `file` argument at all (the REST-era signature did): the bytes already
 * made their one trip to the server by the time a commit is possible, since
 * the modal's Replace button stays disabled until `analyzeReplacement`
 * resolves a valid analysis (`upload-replace-modal/index.tsx`).
 *
 * If `commitReplacement` is ever called with nothing staged (no prior
 * successful `analyzeReplacement`), it is a no-op that resolves `undefined`
 * without touching the network — there is no staged id to commit.
 *
 * **Cache coherence on commit (whole-step review I-1).** A replace is the
 * single most disruptive write in this provider: it swaps the EPUB, rotates
 * the content-hash book id, AND rewrites title/author from the new file's
 * metadata. `commitReplacement`'s `update` therefore does what every sibling
 * mutation does, for the same two reasons they do it:
 *
 *   1. Evicts the current library's whole `Library.entries` field. The new
 *      title/author decide the row's sort position and series grouping, and
 *      the rotated id makes the existing edge dangle — neither is something
 *      `BookReplacePayload` can express (it carries `book` alone). `entries`
 *      is `relayStylePagination(['filter'])` and `page/library`'s entries
 *      read (the deleted `useLibraryEntries`, until Task 5) is a
 *      plain cache-first `useQuery` with nothing refetching it on
 *      navigation, so without this the grid showed the PRE-replace title
 *      until a hard reload. The library id comes from
 *      `useCurrentLibraryId()`, not the payload — unlike `BookDeletePayload`,
 *      this payload has no `library { id }`. Same "not free" cost
 *      `page/book`'s delete and `component/book-edit-form`'s save document: it discards
 *      every page `fetchMore` had accumulated.
 *   2. Evicts the OLD `Book:<id>` entity when the payload reports a
 *      different id. Normalization writes the payload into a brand-new
 *      `Book:<newId>` and cannot know the old one described the same book;
 *      `cache.gc()` alone will not collect the orphan while a
 *      `Library.book(id: oldId)` field from a prior /book or /book-edit
 *      visit still references it. Identical branch and rationale to
 *      `component/book-edit-form`'s save and `page/book`'s regen handler.
 *
 * A failed commit (typed error member, no payload) evicts nothing — the book
 * was not replaced, so the cached grid is still correct.
 *
 * **Placement (Task 8).** Moved here from `provider/book/hook/` when that
 * barrel dissolved. `./index.tsx` — `UploadReplaceModal` — is its ONLY
 * consumer, so this is the call site. It is a sibling module rather than an
 * inlined `useMutation` pair in the component body because the two mutations
 * are not independent: `analyzeReplacement` stages the bytes ONCE and hands
 * the resulting `stagedUploadId` to `commitReplacement` through a ref that
 * has to outlive both calls. Keeping that handshake in one named unit is
 * also what lets `use-replace-book.test.tsx` pin the "staged exactly once"
 * contract and both cache evictions directly, instead of inferring them
 * through the modal's file-picker UI.
 */
export const useReplaceBook = (): UseReplaceBook => {
  const [runAnalyze] = useMutation(BookAnalyzeReplaceDocument);
  const [runReplace] = useMutation(BookReplaceDocument);
  const [analyzing, setAnalyzing] = useState(false);
  const [committing, setCommitting] = useState(false);
  const [commitError, setCommitError] = useState<string | undefined>(undefined);
  const stagedUploadId = useRef<string | undefined>(undefined);
  const { libraryId } = useCurrentLibraryId();

  const analyzeReplacement = useCallback(
    async (id: string, file: File): Promise<ReplaceAnalysis | undefined> => {
      if (analyzing) return undefined;
      setAnalyzing(true);
      // Picking a new file to analyze supersedes any previous commit
      // attempt — clear its error so a stale message doesn't linger.
      setCommitError(undefined);
      try {
        const staged = await stageUpload(file, 'epub');
        stagedUploadId.current = staged;

        const { data } = await runAnalyze({ variables: { id, stagedUploadId: staged } });
        const result = unwrapResult<BookAnalyzeReplacePayload>(
          data?.bookAnalyzeReplace,
          'BookAnalyzeReplacePayload'
        );
        if (result.status !== 'ok') return undefined;

        return {
          valid: result.payload.valid,
          autoFixes: unmaskFragment(MetadataFixFragment, result.payload.autoFixes).map(
            toMetadataFix
          ),
          proposals: unmaskFragment(MetadataFixFragment, result.payload.proposals).map(
            toMetadataFix
          ),
        };
      } catch {
        return undefined;
      } finally {
        setAnalyzing(false);
      }
    },
    [analyzing, runAnalyze]
  );

  const commitReplacement = useCallback(
    async (id: string, acceptedFixKeys: string[]): Promise<ReplacedBook | undefined> => {
      if (committing) return undefined;
      const staged = stagedUploadId.current;
      if (staged === undefined) return undefined;

      setCommitting(true);
      setCommitError(undefined);
      try {
        const { data } = await runReplace({
          variables: { id, stagedUploadId: staged, acceptedFixKeys },
          update: (cache, { data: mutationData }) => {
            const outcome = unwrapResult<BookReplacePayload>(
              mutationData?.bookReplace,
              'BookReplacePayload'
            );
            if (outcome.status !== 'ok') return;

            // See this hook's doc comment for why both evictions are here.
            if (libraryId !== undefined) {
              cache.evict({
                id: cache.identify({ __typename: 'Library', id: libraryId }),
                fieldName: 'entries',
              });
            }
            if (outcome.payload.book.id !== id) {
              cache.evict({ id: cache.identify({ __typename: 'Book', id }) });
            }
            cache.gc();
          },
        });
        const result = unwrapResult<BookReplacePayload>(data?.bookReplace, 'BookReplacePayload');
        if (result.status === 'missing') {
          setCommitError("Couldn't replace this book");
          return undefined;
        }
        if (result.status === 'error') {
          setCommitError(result.message);
          return undefined;
        }

        return { id: result.payload.book.id };
      } catch {
        return undefined;
      } finally {
        setCommitting(false);
      }
    },
    [committing, runReplace, libraryId]
  );

  return useMemo(
    () => ({ analyzeReplacement, commitReplacement, analyzing, committing, commitError }),
    [analyzeReplacement, commitReplacement, analyzing, committing, commitError]
  );
};
