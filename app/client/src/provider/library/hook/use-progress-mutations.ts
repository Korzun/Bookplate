import type { Reference } from '@apollo/client';
import { useMutation, useQuery } from '@apollo/client/react';
import { useCallback, useMemo, useState } from 'react';

import { useFragment } from '~/gql';
import type {
  BookLinkDocumentMutation,
  ProgressDeleteMutation,
  ProgressSetMutation,
} from '~/gql/graphql';
import {
  BookLinkDocumentDocument,
  ProgressDeleteDocument,
  ProgressRowFragment,
  ProgressSetDocument,
} from '~/graphql/progress';
import { ViewerBootstrapDocument } from '~/graphql/viewer-bootstrap';
import { unwrapResult } from '~/provider/apollo';

// `unwrapResult`'s `TPayload` sits in a position TypeScript cannot infer from
// the call, so it is named explicitly here, extracted from the generated
// union rather than hand-duplicated.
//
// `ProgressSetMutation['progressSet']` is NOT nullable in the generated type
// (unlike the other two below) — the field itself has no "no such row"
// convention, only the two typed union members — so no `NonNullable` wrapper
// is needed here.
type ProgressSetPayload = Extract<
  ProgressSetMutation['progressSet'],
  { __typename: 'ProgressSetPayload' }
>;
type ProgressDeletePayload = Extract<
  NonNullable<ProgressDeleteMutation['progressDelete']>,
  { __typename: 'ProgressDeletePayload' }
>;
type BookLinkDocumentPayload = Extract<
  NonNullable<BookLinkDocumentMutation['bookLinkDocument']>,
  { __typename: 'BookLinkDocumentPayload' }
>;

export type UseSetMyProgress = {
  setProgress: (args: { currentChapter: number; percentage: number }) => Promise<boolean>;
  saving: boolean;
  error: string | undefined;
};

export type UseDeleteProgress = {
  deleteProgress: (progressId: string) => Promise<boolean>;
  deleting: boolean;
  error: string | undefined;
};

export type UseLinkProgress = {
  /**
   * `progressId` is the `Progress.id` of the orphan row being linked — the
   * caller already has it, since this is only ever invoked from a component
   * rendering that exact row to offer the "link" action in the first place.
   * See this hook's own doc comment for why the mutation's response alone
   * cannot supply it.
   */
  link: (documentId: string, progressId: string) => Promise<boolean>;
  linking: boolean;
  error: string | undefined;
};

/**
 * The REST hook (`provider/progress/hook/use-set-my-progress.ts`) wrote an
 * OPTIMISTIC entry into the local progress map before the request, and
 * rolled it back on failure. That side effect doesn't carry over as
 * optimism — it becomes a real cache write, just relocated:
 *
 *   1. **Visibility of the new percentage** — the whole point of the old
 *      optimistic write — is now Apollo's own normalization:
 *      `ProgressSetDocument` re-selects the full `ProgressRowFragment` on
 *      the returned `progress`, so an ALREADY-cached `Progress:<id>` entity
 *      (the common case: re-setting progress for a book already being
 *      tracked) gets its fields overwritten in place the moment the
 *      mutation resolves — no hand-written `update` needed for that case.
 *      See this hook's own test, "updates an already-listed progress row
 *      via normalization alone".
 *
 *   2. A returned entity does NOT insert itself into a list it wasn't
 *      already part of, though (same reason `useCreateDevice` needs a
 *      `cache.modify` for `Viewer.devices`) — the FIRST time progress is
 *      set for a document, the entity is brand new and no `Library.progress`
 *      edge references it yet. The `update` below inserts one, keyed off
 *      the mutation's own re-selected `library { id }` (both
 *      `MyProgressListDocument` and `UserProgressListDocument` read the
 *      SAME `Library.progress` field, since it carries no `keyArgs` in
 *      `cacheConfig` — one insert serves both screens). Guarded by an
 *      `alreadyListed` check so the already-cached case above doesn't grow a
 *      duplicate edge.
 *
 *   **Seen-to-fail**: deleting this `cache.modify` block (leaving the
 *   mutation to run with no `update` at all) leaves "adds the new progress
 *   to the cached connection after a set" failing — the new `Progress`
 *   entity is written and readable on its own, but
 *   `client.cache.readQuery(MyProgressListDocument)` still returns only the
 *   pre-existing edge; the new row never appears in the list. Restored.
 *
 *   3. **I-1 (final whole-branch review)**: point 1 above only covers a
 *      `Progress` entity that's already CACHED under `Progress:<id>` — it
 *      says nothing about `Book.progress`, a SEPARATE field on a SEPARATE
 *      entity (`Book:<bookId>`) that `page/book`, the library grid
 *      (`BookRowFragment`), and the series page (`SeriesBookRowFragment`)
 *      all read. For a book with NO prior progress row, the server had
 *      previously returned `progress: null` there, Apollo cached that, and
 *      nothing overwrote it — the new percentage was invisible on all three
 *      screens for the rest of the session, even though `Progress:<id>`
 *      itself was written correctly. `ProgressRowFragment` already selects
 *      `book { id }` on the returned `progress` (no new server field
 *      needed), so this inserts a REFERENCE into `Book:<bookId>.progress`
 *      the same way point 2 inserts one into `Library.progress`'s edges —
 *      `useFragment` un-masks the mutation's own `progress` field to reach
 *      `.book.id` (an identity cast at runtime, not an actual hook; see
 *      `gql/fragment-masking.ts`), safe to call from inside this
 *      non-render `update` callback.
 *
 *   **Seen-to-fail**: deleting this `Book.progress` `cache.modify` call
 *   leaves "inserts a Book.progress reference when a first-time set has no
 *   prior cached progress" failing — `Book:<bookId>.progress` reads back
 *   `null`, the value seeded before the set, instead of a reference to the
 *   new `Progress` entity. Restored.
 *
 * The old hook's ROLLBACK-on-failure has no analogue here: nothing is
 * written to the cache before the request settles (no optimistic response is
 * configured), so there is nothing to roll back — a failed mutation simply
 * leaves the pre-existing cache state untouched, which is the same
 * OBSERVABLE result the rollback produced.
 *
 * The old hook also generated/stored a per-browser `device_id` in
 * `localStorage` and always sent `device: 'Web'`. Neither is sent here — the
 * server itself defaults a missing `device` to `'Web'`
 * (`graphql/schema/progress/mutation/set.ts`, `missing device becomes
 * 'Web'`) and an empty `deviceId`, so omitting both reproduces the same
 * server-observed values without the client tracking a device id at all.
 *
 * `ProgressSetInput.userId` must be the viewer's OWN `User` global id — there
 * is no admin write path for progress at all (input field doc comment,
 * schema-verified) — so this hook does not accept a `userId` argument. It
 * reads one off `ViewerBootstrapDocument`'s `viewer.user { id }`, the same
 * already-cached app-bootstrap query `useRegenerateSyncPassword` reads for
 * the identical reason: ordinarily a cache hit, not a second network round
 * trip. `viewer.user` is null only for the config-based admin, who has no
 * `User` row and for whom `progressSet` has no meaning anyway (the server
 * 403s an admin caller regardless); `setProgress` guards on it defensively
 * and reports an error rather than sending a request with no `userId`.
 */
export const useSetMyProgress = (documentId: string): UseSetMyProgress => {
  const { data: viewerData } = useQuery(ViewerBootstrapDocument);
  const userId = viewerData?.viewer.user?.id;

  const [runSet] = useMutation(ProgressSetDocument);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | undefined>();

  const setProgress = useCallback(
    async ({
      currentChapter,
      percentage,
    }: {
      currentChapter: number;
      percentage: number;
    }): Promise<boolean> => {
      if (saving) return false;
      if (userId === undefined) {
        setError('Not signed in');
        return false;
      }

      setSaving(true);
      setError(undefined);

      try {
        const { data } = await runSet({
          variables: { input: { document: documentId, userId, currentChapter, percentage } },
          update: (cache, { data: mutationData }) => {
            const result = unwrapResult<ProgressSetPayload>(
              mutationData?.progressSet,
              'ProgressSetPayload'
            );
            if (result.status !== 'ok') return;

            cache.modify({
              id: cache.identify({ __typename: 'Library', id: result.payload.library.id }),
              fields: {
                progress: (
                  existing:
                    | { edges: { cursor: string; node: Reference }[] }
                    | Reference
                    | undefined,
                  { toReference }
                ) => {
                  // `existing` is typed as a `Reference` union member because
                  // `cache.modify`'s field-modifier signature is generic over
                  // ANY field, not specific to `progress` — a bare `Reference`
                  // never actually lands here in practice (this field is
                  // never itself a normalized entity), but the `'edges' in`
                  // check narrows it out for TypeScript rather than asserting
                  // past it.
                  if (!existing || !('edges' in existing)) return existing;

                  const ref = toReference(result.payload.progress);
                  if (!ref) return existing;

                  const alreadyListed = existing.edges.some(
                    (edge) => edge.node.__ref === ref.__ref
                  );
                  if (alreadyListed) return existing;

                  return {
                    ...existing,
                    edges: [
                      {
                        __typename: 'LibraryProgressConnectionEdge',
                        cursor: result.payload.progress.id,
                        node: ref,
                      },
                      ...existing.edges,
                    ],
                  };
                },
              },
            });

            // I-1: see this hook's own doc comment, point 3 — a first-time
            // set for a book with no prior progress row otherwise leaves
            // `Book.progress` cached as the `null` the server returned
            // before anything existed.
            const unmaskedProgress = useFragment(ProgressRowFragment, result.payload.progress);
            const bookId = unmaskedProgress.book?.id;
            if (bookId) {
              cache.modify({
                id: cache.identify({ __typename: 'Book', id: bookId }),
                fields: {
                  progress: (_existing, { toReference }) =>
                    toReference(unmaskedProgress) ?? null,
                },
              });
            }
          },
        });

        const result = unwrapResult<ProgressSetPayload>(data?.progressSet, 'ProgressSetPayload');
        if (result.status === 'missing') {
          setError('Failed to save progress');
          return false;
        }
        if (result.status === 'error') {
          setError(result.message);
          return false;
        }

        return true;
      } catch (err) {
        setError(err instanceof Error ? err.message : 'Failed to save progress');
        return false;
      } finally {
        setSaving(false);
      }
    },
    [runSet, saving, userId, documentId]
  );

  return useMemo(() => ({ setProgress, saving, error }), [setProgress, saving, error]);
};

/**
 * Replaces BOTH `useDeleteMyProgress` and `useDeleteUserProgress`:
 * `progressDelete` takes a `Progress.id` global id and authorises the
 * DECODED owner it carries, so it is genuinely admin-capable — the two old
 * REST paths differed only in which id they sent, and that's now the
 * caller's job (pass the row's own `Progress.id`), not this hook's.
 *
 * Both old hooks performed an OPTIMISTIC local removal before the request,
 * rolled back on failure, and — `useDeleteMyProgress`/`useDeleteUserProgress`
 * both — refused to even attempt the request when the local map had no entry
 * for the target id. That precondition check has no analogue here: this
 * hook has no local map to consult (the cache IS the source of truth), so
 * every call reaches the server and lets ITS "no such row" convention
 * (`progressDelete` resolves `null`) report the failure instead.
 *
 * The observable removal itself becomes `cache.evict` + `cache.gc()` on the
 * deleted `Progress` entity, mirroring `useDeleteBook`'s point 1: evicting
 * an entity that a `relayStylePagination` connection holds by `Reference`
 * makes `InMemoryCache` silently drop the now-dangling edge the next time
 * that connection is read (confirmed empirically for `Library.entries` in
 * `useDeleteBook`'s own tests; this hook's "removes the row from the cached
 * connection after a delete" test confirms the same holds for
 * `Library.progress`). Unlike `useDeleteBook`, there is no second,
 * field-level eviction here — deleting a `Progress` row has no
 * `Library.entries`-style side effect elsewhere in the graph (no analogue of
 * "deleting the last book in a series also deletes the series").
 *
 * **Seen-to-fail**: deleting the `cache.evict`/`cache.gc()` lines below
 * (leaving the mutation with no `update` at all) leaves "removes the row
 * from the cached connection after a delete" failing — the deleted
 * `Progress` entity and its edge both survive in the cache untouched, so a
 * subsequent `readQuery` for the connection still lists the deleted row.
 * Restored.
 *
 * **Task 7 addition**: `page/book`'s `BookDetailDocument` reads `Book.progress`
 * as a plain OBJECT field (`{ id percentage currentChapter }`), which Apollo
 * still normalizes as a `Reference` to the `Progress` entity (any object with
 * an `id` is). Evicting that entity, as above, leaves the reference dangling
 * — the owning `Book` becomes cache-INCOMPLETE, and `useBookDetail`'s
 * cache-first `useQuery` reacts to an incomplete read by refetching over the
 * network, which in `page/book/index.test.tsx`'s own coverage flips the whole
 * page to "Failed to load book." (no guaranteed mock for that refetch; in
 * production, a pointless real round trip at best).
 *
 * The deleted `Progress` entity is NOT a reliable source for its own `book`
 * link to null out directly: `BookDetailDocument` normalizes it with only
 * `{ id percentage currentChapter }` (no `book` sub-selection, since the
 * owning `Book` is already known on that path) — a book-detail-page-only
 * session never caches enough of the row for `cache.readFragment` to read a
 * `book` field back out of it. So this scans the EXTRACTED store for the
 * `Book` entity that HOLDS the dangling reference (the referring side, not
 * the referenced side) and nulls its `progress` field directly, before the
 * evict below removes the referenced data.
 *
 * **Seen-to-fail**: deleting the scan-and-null block leaves `page/book`'s
 * "issues progressDelete against the Progress global id..." test failing —
 * the page falls back to "Failed to load book." after a clean delete.
 * Restored.
 */
export const useDeleteProgress = (): UseDeleteProgress => {
  const [runDelete] = useMutation(ProgressDeleteDocument);
  const [deleting, setDeleting] = useState(false);
  const [error, setError] = useState<string | undefined>();

  const deleteProgress = useCallback(
    async (progressId: string): Promise<boolean> => {
      if (deleting) return false;

      setDeleting(true);
      setError(undefined);

      try {
        const { data } = await runDelete({
          variables: { id: progressId },
          update: (cache, { data: mutationData }) => {
            const result = unwrapResult<ProgressDeletePayload>(
              mutationData?.progressDelete,
              'ProgressDeletePayload'
            );
            if (result.status !== 'ok') return;

            const progressKey = cache.identify({
              __typename: 'Progress',
              id: result.payload.deletedId,
            });
            if (progressKey) {
              const extracted = cache.extract() as Record<
                string,
                { progress?: Reference } | undefined
              >;
              for (const [key, value] of Object.entries(extracted)) {
                if (key.startsWith('Book:') && value?.progress?.__ref === progressKey) {
                  cache.modify({ id: key, fields: { progress: () => null } });
                }
              }
            }

            cache.evict({ id: progressKey });
            cache.gc();
          },
        });

        const result = unwrapResult<ProgressDeletePayload>(
          data?.progressDelete,
          'ProgressDeletePayload'
        );
        if (result.status === 'missing') {
          setError('Failed to delete progress');
          return false;
        }
        if (result.status === 'error') {
          setError(result.message);
          return false;
        }

        return true;
      } catch (err) {
        setError(err instanceof Error ? err.message : 'Failed to delete progress');
        return false;
      } finally {
        setDeleting(false);
      }
    },
    [runDelete, deleting]
  );

  return useMemo(() => ({ deleteProgress, deleting, error }), [deleteProgress, deleting, error]);
};

/**
 * The REST hook (`provider/progress/hook/use-link-progress.ts`) took a
 * `bookId` (raw) plus a `username`, scoped the URL for an admin caller, and —
 * on success — re-keyed the orphan progress entry it held locally so the row
 * stayed visible under the book's id instead of vanishing from the cached
 * list (`mergeLinkedProgress`). None of that carries over as-is:
 *
 *   - The URL-scoping-by-username split is gone: `bookLinkDocument` takes
 *     the `Book` GLOBAL id alone (`bookGlobalId`, this hook's own argument)
 *     and authorises the DECODED owner it carries server-side
 *     (`graphql/schema/book/mutation/link-document.ts`), the same
 *     admin-capable-via-id-not-via-query-param shape every other book
 *     mutation in this migration already uses. There is no separate
 *     "admin scope" argument to thread through any more.
 *
 *   - `book { id lineage { oldId newId type } }` re-selects the FULL lineage
 *     list, so Apollo's own normalization overwrites the array on the
 *     existing `Book:<id>` entity — no hand-written `update` needed
 *     (`graphql/progress.ts`'s own doc comment already calls this out; this
 *     hook's "normalizes the returned book.lineage onto the Book entity
 *     without a hand-written update" test asserts it directly against the
 *     cache, per this migration's rule that a normalization-suffices claim
 *     must be pinned by a cache assertion, not just left as an absence of
 *     code).
 *
 *   - The re-keyed ORPHAN PROGRESS ENTRY's replacement is a `cache.evict`,
 *     not a re-key: `BookLinkDocumentPayload` carries no `progress` field at
 *     all (schema-verified, `link-document.ts:65-90` — only `book`), so the
 *     mutation's own response gives the client no `Progress` id to act on.
 *     But the CALLER already has one: `link` is only ever invoked from a
 *     component rendering the exact orphan row it's offering to link (there
 *     is no other UI path to this action), so `progressId` rides in as this
 *     hook's own second argument rather than being derived from the
 *     response. On success, `cache.evict` that `Progress:<progressId>`
 *     entity + `cache.gc()` — mirroring `useDeleteProgress`'s identical
 *     evict-the-entity-and-let-the-connection-self-heal shape. Without this,
 *     the stale orphan `Progress:<id>` (still `book: null`) survives
 *     untouched and the row renders as if nothing happened; the server DID
 *     migrate it (`book-store.ts`'s `linkDocument` transaction), the CACHE
 *     just never heard about it. Evicting the orphan is sufficient — a new
 *     `Progress` edge for the now-linked book, if any, arrives through
 *     `useSetMyProgress`'s own connection-insert the next time it's needed,
 *     not through this hook.
 *
 *   **Seen-to-fail**: deleting the `cache.evict`/`cache.gc()` lines below
 *   leaves "evicts the stale orphan Progress entity from the cache after a
 *   link" failing — `Progress:<progressId>` survives in `cache.extract()`
 *   instead of disappearing. Restored.
 */
export const useLinkProgress = (bookGlobalId: string): UseLinkProgress => {
  const [runLink] = useMutation(BookLinkDocumentDocument);
  const [linking, setLinking] = useState(false);
  const [error, setError] = useState<string | undefined>();

  const link = useCallback(
    async (documentId: string, progressId: string): Promise<boolean> => {
      if (linking) return false;

      setLinking(true);
      setError(undefined);

      try {
        const { data } = await runLink({
          variables: { id: bookGlobalId, documentId },
          update: (cache, { data: mutationData }) => {
            const result = unwrapResult<BookLinkDocumentPayload>(
              mutationData?.bookLinkDocument,
              'BookLinkDocumentPayload'
            );
            if (result.status !== 'ok') return;

            cache.evict({ id: cache.identify({ __typename: 'Progress', id: progressId }) });
            cache.gc();
          },
        });

        const result = unwrapResult<BookLinkDocumentPayload>(
          data?.bookLinkDocument,
          'BookLinkDocumentPayload'
        );
        if (result.status === 'missing') {
          setError('Failed to link progress');
          return false;
        }
        if (result.status === 'error') {
          setError(result.message);
          return false;
        }

        return true;
      } catch (err) {
        setError(err instanceof Error ? err.message : 'Failed to link progress');
        return false;
      } finally {
        setLinking(false);
      }
    },
    [runLink, linking, bookGlobalId]
  );

  return useMemo(() => ({ link, linking, error }), [link, linking, error]);
};
