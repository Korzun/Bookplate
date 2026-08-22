import { useMutation } from '@apollo/client/react';
import { useCallback, useMemo, useState } from 'react';

import type { BookUpdateMetadataMutation } from '~/gql/graphql';
import { BookUpdateMetadataDocument } from '~/graphql/book-edit';
import { stageUpload } from '~/lib/staged-upload';
import { unwrapResult } from '~/provider/apollo';

// `unwrapResult`'s `TPayload` sits in a position TypeScript cannot infer from
// the call, so it is named explicitly here, extracted from the generated
// union rather than hand-duplicated.
type BookUpdateMetadataPayload = Extract<
  NonNullable<BookUpdateMetadataMutation['bookUpdateMetadata']>,
  { __typename: 'BookUpdateMetadataPayload' }
>;

export type BookEditPatch = Partial<{
  title: string;
  titleSort: string;
  author: string;
  authorSort: string;
  description: string;
  publisher: string;
  publishDate: string;
  series: string;
  seriesIndex: number;
  subjects: string[];
  identifiers: { scheme: string; value: string }[];
  cover: File;
}>;

/** The resolved id shape the caller needs to navigate back to the edited book. */
export type UpdatedBook = { id: string; documentId: string };

export type UseUpdateBookMetadata = [
  (bookId: string, patch: BookEditPatch) => Promise<UpdatedBook | undefined>,
  boolean,
  string | undefined,
];

/**
 * A DELIBERATE 3-tuple, where the other four mutation hooks in this
 * directory (`use-delete-book`, `use-regen-chapters`, `use-clear-book-
 * editions`) are 4-tuples carrying a separate boolean `error` beside the
 * message. Those callers branch on `error`; `BookEditForm` only ever
 * renders `errorMessage` itself (there's nothing else useful to do with a
 * save failure but show it), so a bare `error: boolean` nothing reads would
 * be dead weight. This is a decision, not an oversight.
 *
 * Save is two phases because file bytes have no transport in GraphQL: the
 * cover, when changed, is staged over the permanent REST seam
 * (`~/lib/staged-upload`) FIRST, and only then does the id it resolves ride
 * into `bookUpdateMetadata`'s `stagedCoverId` input field. Staging happens
 * strictly before the mutation is even attempted — if `patch.cover` is
 * unset, `stageUpload` is never called at all, and if staging throws, the
 * catch below returns immediately with a cover-specific message and the
 * mutation never fires. This is why the two phases can report two DIFFERENT
 * user-facing messages ("Failed to upload the cover image…" vs "Couldn't
 * save your changes") where the REST-era single multipart PATCH could only
 * ever report one generic failure.
 *
 * The server closes the gap between the phases on its own: a staged upload
 * carries a 30-minute TTL with a lazy sweep and a one-time consume
 * (`~/lib/staged-upload`'s own doc comment), so a cover staged for a
 * mutation that then fails cleans itself up server-side. No client-side
 * compensation (e.g. "undo the stage") is needed or built here.
 *
 * `update` evicts the STALE `Book:<bookId>` entity ONLY when the payload's
 * `book.id` differs from the requested `bookId` — editing metadata rewrites
 * the EPUB file (title/author page, cover, etc.), which changes its content
 * hash, which is also the raw local half of the Book's global id, so a save
 * can genuinely mint a new id. When it does, Apollo's normalization on the
 * payload's re-selected `book { ... }` writes a BRAND NEW `Book:<new-id>`
 * entity — it has no way to know the old entity described the SAME book and
 * needs removing, so the pre-save `Book:<old-id>` would otherwise linger in
 * the cache forever with stale metadata. When the id is UNCHANGED,
 * normalization alone updates the existing entity's re-selected fields and
 * this `update` function does nothing extra — no hand-written update is
 * needed for that case.
 *
 * **Seen-to-fail (both guards deliberately broken, observed failing, then
 * restored — see task-4-report.md for the full transcript):**
 *
 *   - Deleting the `payload.book.id !== bookId` evict branch leaves "evicts
 *     the old Book entity when the payload reports a different id" failing:
 *     `Book:<old-id>` survives in `cache.extract()` instead of disappearing,
 *     because normalization alone never removes a stale entity under a
 *     different key.
 *   - Deleting the `if (saving) return undefined;` guard leaves "does not
 *     send a second request while the first is still in flight" failing:
 *     the second call reaches `runUpdate` again while only one mock is
 *     queued, and `MockLink` throws ("No more mocked responses…") instead of
 *     the call resolving to `undefined` silently.
 */
export const useUpdateBookMetadata = (): UseUpdateBookMetadata => {
  const [runUpdate] = useMutation(BookUpdateMetadataDocument);
  const [saving, setSaving] = useState(false);
  const [errorMessage, setErrorMessage] = useState<string | undefined>();

  const updateBookMetadata = useCallback(
    async (bookId: string, patch: BookEditPatch): Promise<UpdatedBook | undefined> => {
      if (saving) return undefined;

      setSaving(true);
      setErrorMessage(undefined);

      try {
        const { cover, ...rest } = patch;

        let stagedCoverId: string | undefined;
        if (cover !== undefined) {
          try {
            stagedCoverId = await stageUpload(cover, 'cover');
          } catch {
            // Deliberately NOT `err.message`: `stageUpload` usually throws a
            // user-facing message already, but nothing guarantees it always
            // mentions the cover (a raw network throw, for instance,
            // wouldn't) — and the whole point of this branch is that the
            // user can tell staging broke, not saving. A fixed message says
            // so unconditionally instead of gambling on the underlying
            // error's wording.
            setErrorMessage("Couldn't upload the cover image");
            return undefined;
          }
        }

        const { data } = await runUpdate({
          variables: {
            input: {
              id: bookId,
              ...rest,
              ...(stagedCoverId !== undefined ? { stagedCoverId } : {}),
            },
          },
          update: (cache, { data: mutationData }) => {
            const result = unwrapResult<BookUpdateMetadataPayload>(
              mutationData?.bookUpdateMetadata,
              'BookUpdateMetadataPayload'
            );
            if (result.status !== 'ok') return;
            if (result.payload.book.id === bookId) return;

            cache.evict({ id: cache.identify({ __typename: 'Book', id: bookId }) });
            cache.gc();
          },
        });

        const result = unwrapResult<BookUpdateMetadataPayload>(
          data?.bookUpdateMetadata,
          'BookUpdateMetadataPayload'
        );
        if (result.status === 'missing') {
          setErrorMessage("Couldn't save your changes");
          return undefined;
        }
        if (result.status === 'error') {
          setErrorMessage(result.message);
          return undefined;
        }

        return { id: result.payload.book.id, documentId: result.payload.book.documentId };
      } catch (err) {
        setErrorMessage(err instanceof Error ? err.message : "Couldn't save your changes");
        return undefined;
      } finally {
        setSaving(false);
      }
    },
    [runUpdate, saving]
  );

  return useMemo(
    () => [updateBookMetadata, saving, errorMessage] as UseUpdateBookMetadata,
    [updateBookMetadata, saving, errorMessage]
  );
};
