import { useApolloClient, useMutation, useQuery } from '@apollo/client/react';
import { use, useCallback, useLayoutEffect, useMemo, useRef } from 'react';

import { useFragment } from '~/gql';
import type {
  BookResolvePendingFixMutation,
  PendingFixResolution,
  PendingFixRowFragmentFragment,
  UndoKind,
} from '~/gql/graphql';
import {
  BookResolvePendingFixDocument,
  LibraryPendingFixesDocument,
  MetadataFixFragment,
  PendingFixRowFragment,
} from '~/graphql/upload';
import type { MetadataFix } from '~/lib/book-types';
import type { ValidationFailure } from '~/lib/severity';
import { unwrapResult } from '~/provider/apollo';
import { useCurrentLibraryId } from '~/provider/library-target';

import { UploadContext } from '../context';
import type { TransportItem } from './use-upload-transport';
import { useUploadTransport } from './use-upload-transport';

// `unwrapResult`'s `TPayload` sits in a position TypeScript cannot infer from
// the call, so it is named explicitly here, extracted from the generated
// union rather than hand-duplicated — same shape as
// `control/unlink-book-lineage-button/index.tsx`.
type BookResolvePendingFixPayload = Extract<
  NonNullable<BookResolvePendingFixMutation['bookResolvePendingFix']>,
  { __typename: 'BookResolvePendingFixPayload' }
>;

/**
 * The pending-fix query's own row type, UNMASKED — not `FragmentType<typeof
 * PendingFixRowFragment>`: the merge below reads `.book.id` and `.state` off
 * these directly.
 *
 * `PendingFixRowFragmentFragment` is the fragment's own resolved type, and
 * exactly what `useFragment(PendingFixRowFragment, …)` returns. Deriving it
 * off `LibraryPendingFixesQuery['node']` instead would land on the still-
 * MASKED row (`{ __typename: 'PendingFix' } & { ' $fragmentRefs'?: … }`),
 * which exposes neither `.book` nor `.state`. `state`'s three nested
 * `MetadataFix` arrays stay masked one level further in; unmasking those is
 * this hook's own job, further down.
 *
 * Masking in this codebase is compile-time only (`useFragment` is an
 * identity cast, `gql/fragment-masking.ts`), so naming this concrete row
 * type is honest rather than a workaround.
 */
type PendingFixRow = PendingFixRowFragmentFragment;

/** The field/kind/from triple `BookResolvePendingFixInput.fixes` takes — the
 * wire shape, as an object, not the joined string `fixKey` produces for
 * local dedup. */
export type FixKey = { field: string; kind: string; from: string };

/**
 * What every fix resolution below resolves internally.
 *
 * `ok` is `true` on success, `false` on any typed error or network failure.
 *
 * `bookGlobalId` is the book id the SERVER reports back, which is NOT
 * necessarily the one that was passed in: a successful `ACCEPT` (and the
 * `UNDO` of an apply-snapshot) re-imports the rewritten EPUB through
 * `applyEpubChanges`, minting a new content-hash id and re-keying the
 * `PendingFix` row under it. `runRotating` below follows it — the merge join
 * in `items` is keyed on exactly this string. Present only when `ok` is
 * `true` (a typed error carries no payload to read it from).
 *
 * This type stays INTERNAL: `UseUploadQueue`'s public contract is still
 * boolean, so `page/upload` never sees a `FixOutcome`.
 */
type FixOutcome = { ok: boolean; bookGlobalId?: string };

export type UploadItemStatus = 'queued' | 'uploading' | 'done' | 'error';

/** The server's `PendingFix.state.undo` carries only `kind` — the actual
 * revert (proposals/appliedFixes/originalMetadata) is server-owned now and
 * applied by the `UNDO` resolution, not replayed client-side. `kind` stays
 * lowercase (`'apply' | 'dismiss'`) to match `component/fix-review`'s
 * existing `UNDO_LABEL` lookup unchanged — translated from the server's
 * `UndoKind` enum (`'APPLY' | 'DISMISS'`) at the merge boundary below. */
export type UndoSnapshot = { kind: 'apply' | 'dismiss' };

export type UploadItem = {
  id: string;
  fileName: string;
  fileSize: number;
  status: UploadItemStatus;
  bytesUploaded: number;
  errorMessage?: string;
  validation?: ValidationFailure;
  /** Relay global id — the ONLY book identifier a queue item carries. No raw
   * book id may appear anywhere under `provider/upload/` (this migration's
   * global constraint); see `use-upload-transport.ts`'s `TransportItem` for
   * the same rule on the live half of this merge. */
  bookGlobalId?: string;
  /** High-confidence fixes the server applied during upload (informational). */
  autoFixes?: MetadataFix[];
  appliedFixes?: MetadataFix[];
  proposals?: MetadataFix[];
  undo?: UndoSnapshot;
};

export type UseUploadQueue = {
  items: UploadItem[];
  addFiles: (files: FileList) => void;
  applyFix: (itemId: string, fix: MetadataFix) => Promise<boolean>;
  applyAllProposals: (itemId: string) => Promise<boolean>;
  /** Async now (Task 8): resolves through `BookResolvePendingFixDocument`
   * rather than mutating local state. Every call site must `await` or `void`
   * the call — a bare statement would silently float the promise. */
  dismissAllProposals: (itemId: string) => Promise<boolean>;
  /** Async now (Task 8) — see `dismissAllProposals`'s own note. */
  dismissFix: (itemId: string, fix: MetadataFix) => Promise<boolean>;
  undo: (itemId: string) => Promise<boolean>;
  dismissCompleted: (itemId: string) => void;
};

/** Fixes have no server id — the queue identifies them by field:kind:from so
 * multiple compound-subject splits (same field+kind, different compound) stay
 * distinct. */
export const fixKey = (fix: MetadataFix): string => `${fix.field}:${fix.kind}:${fix.from}`;

/** The server's `BookResolvePendingFixInput.fixes` takes the triple as an
 * object, not the joined string `fixKey` produces for local dedup — this is
 * the wire shape `applyFix`/`dismissFix` send. */
export const fixKeyOf = (fix: MetadataFix): FixKey => ({
  field: fix.field,
  kind: fix.kind,
  from: fix.from,
});

const UNDO_KIND: Record<UndoKind, 'apply' | 'dismiss'> = { APPLY: 'apply', DISMISS: 'dismiss' };

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

type ResolvedRow = {
  row: PendingFixRow;
  autoFixes: MetadataFix[];
  appliedFixes: MetadataFix[];
  proposals: MetadataFix[];
};

/** A seeded row: a server pending-fix row with no live transport counterpart
 * (a fresh reload, or a book whose upload happened in an earlier session).
 * `status` is always `'done'` and `bytesUploaded` equals `fileSize` — there's
 * no live progress to show.
 *
 * Keyed on the server's `PendingFix.id`, DELIBERATELY, not a synthetic stable
 * id: a successful `ACCEPT` that rewrites the EPUB mints a new content-hash
 * book id, and `PendingFix.id` is derived from it, so this row's React key
 * rotates and the row remounts after an accept. The REMOUNT is cosmetic (the
 * row re-renders with the same content) and accepted on purpose — see this
 * migration's spec §4.4. The rotation ITSELF is not cosmetic, and §4.4 said
 * so too weakly before review C-1: it also breaks the merge join in
 * `items` below, which `runRotating` now repairs by remapping the live
 * transport item onto the new id. */
const seededRow = (r: ResolvedRow): UploadItem => ({
  id: r.row.id,
  fileName: r.row.fileName,
  fileSize: r.row.fileSize,
  status: 'done',
  bytesUploaded: r.row.fileSize,
  bookGlobalId: r.row.book.id,
  autoFixes: r.autoFixes,
  appliedFixes: r.appliedFixes,
  proposals: r.proposals,
  undo: r.row.state.undo ? { kind: UNDO_KIND[r.row.state.undo.kind] } : undefined,
});

/** A live transport item, optionally joined with the server row describing
 * the same book. Progress fields (`status`/`bytesUploaded`/`errorMessage`/
 * `validation`) always come from the transport — only it has them. Fix state
 * (`autoFixes`/`appliedFixes`/`proposals`/`undo`) comes from the SERVER row
 * whenever one exists; the transport's own `autoFixes`/`proposals` (read off
 * the upload response) are only the fallback for a book with no row yet —
 * e.g. the instant after upload completes but before the server's
 * `PendingFix` row has round-tripped back through the query above.
 *
 * `everSeen` distinguishes that transient "no row YET" gap from a row this
 * live item was matched against earlier in the session and is no longer
 * matched against now — in which case this falls back to "no proposals"
 * rather than resurrecting the transport's stale pre-resolution list.
 *
 * **What actually triggers it (corrected — the previous version of this
 * comment was wrong).** It used to claim the guard was purely defensive and
 * that its "only theoretical trigger" was `Library.pendingFixes`' 7-day TTL
 * lapsing with the tab still open. That reasoned exclusively about the row
 * being DELETED, and missed the case that fires on the first accept of every
 * live upload: the row being RE-KEYED. A successful ACCEPT (or the UNDO of
 * an apply-snapshot) re-imports the rewritten EPUB under a new content-hash
 * book id and `upsertPendingFix`es the row under THAT id — so from this
 * join's point of view the row the live item was matched against is simply
 * gone, replaced by a different one it does not yet match.
 *
 * `runRotating` below now closes that gap by remapping the live item's
 * `bookGlobalId` onto the payload's new id (review C-1), but the remap runs
 * AFTER the mutation resolves, while the payload's re-keyed row list is
 * normalized into the cache DURING it — leaving exactly one render in which
 * the live item still holds the pre-accept id and matches nothing. Measured,
 * not assumed: `use-upload-queue.test.tsx`'s "never flashes the stale
 * upload-time proposals back while an ACCEPT rotation lands" captures that
 * render, and with this guard forced to `false` it fails, showing the
 * upload-time proposals the user just accepted flashing back onto the card.
 * So the guard is load-bearing, not defensive.
 *
 * The row-DELETED reasoning still holds on its own terms and is worth
 * keeping: `bookResolvePendingFix`'s ACCEPT and DISMISS both always arm
 * `undo` on success (`app/server/.../resolve-pending-fix.ts`),
 * `BookStore.upsertPendingFix` only deletes a row when
 * `proposals.length === 0 && !state.undo` (`book-store.ts`), and
 * `isLivePendingFix` keeps a resolved-but-undo-armed row live in
 * `Library.pendingFixes` for 7 days (`derive.ts`); `CLEAR` removes a row but
 * `dismissCompleted` drops the local transport item in the very same call.
 * So an outright DELETION under a live item remains reachable only via that
 * TTL — a second, weaker reason to keep the guard, on top of the rotation
 * window above, which is the real one. */
const mergeRow = (t: TransportItem, r: ResolvedRow | undefined, everSeen: boolean): UploadItem => {
  const base: UploadItem = {
    id: t.id,
    fileName: t.fileName,
    fileSize: t.fileSize,
    status: t.status,
    bytesUploaded: t.bytesUploaded,
    errorMessage: t.errorMessage,
    validation: t.validation,
    bookGlobalId: t.bookGlobalId,
  };
  if (!r) {
    return everSeen
      ? { ...base, autoFixes: [], proposals: [] }
      : { ...base, autoFixes: t.autoFixes, proposals: t.proposals };
  }
  return {
    ...base,
    autoFixes: r.autoFixes,
    appliedFixes: r.appliedFixes,
    proposals: r.proposals,
    undo: r.row.state.undo ? { kind: UNDO_KIND[r.row.state.undo.kind] } : undefined,
  };
};

/**
 * The merged upload queue: joins the live transport (`useUploadTransport`,
 * still its own hook — it owns the XHR queue) with the server's pending-fix
 * rows on `bookGlobalId`, and maps the public fix-actions onto
 * `bookResolvePendingFix`'s four resolutions.
 *
 * **Both halves of the pending-fix conversation are INLINE here**, in the one
 * hook that needs them together. The read (`LibraryPendingFixesDocument`) and
 * the write (`BookResolvePendingFixDocument`) used to sit in two indirection
 * hooks, `usePendingFixes` and `useFixActions`, each with exactly this call
 * site plus one other; both were dissolved. Their public surfaces carried
 * `loading`/`error` fields that NO consumer ever read, which is what made
 * them safe to drop rather than re-thread.
 *
 * The documents themselves deliberately stay in `~/graphql/upload.ts`, a leaf
 * module, NOT in a route file: `UploadProvider` is a KEPT provider mounted
 * above the router, so its reads have no single owning route, and both
 * documents have a second reader outside this file (`component/nav`'s badge
 * for the query, `page/book-edit`'s guard modal for the mutation).
 *
 * A queue item comes from one of two places, or both:
 * - a LIVE transport item (this session's upload, has progress)
 * - a SERVER pending-fix row (survives reloads, carries the fix state)
 *
 * Once an upload completes, its transport item and the server row it created
 * describe the SAME book and must render as ONE row — `mergeRow` above does
 * that join; whatever server row is left unclaimed after every live item has
 * had a chance to claim one is a reseeded row with no live counterpart,
 * rendered via `seededRow`. Seeded rows come first in `items`, matching the
 * old REST engine's `setItems((prev) => [...seeded, ...prev])`.
 *
 * `MetadataFixFragment`'s three nested arrays (`autoFixes`/`appliedFixes`/
 * `proposals`) stay masked one level deeper than the row unmask above (see
 * `PendingFixRow`'s own comment) — unmasking them is this hook's job too.
 * The three `useFragment` calls below run ONCE EACH, flattened across every
 * row, at this hook's own top level: `useFragment` is a compile-time-only
 * identity cast (no real hook behaviour), but `react-hooks/rules-of-hooks`
 * still flags it by name if called inside a loop/`.map()`/`useMemo`
 * callback — verified against this repo's `oxlint` — so the flatten-then-
 * reslice below is not incidental complexity, it's what keeps this file
 * lintable while still going through the sanctioned unmask utility rather
 * than hand-rolling a second cast.
 */
export const useUploadQueueEngine = (): UseUploadQueue => {
  const client = useApolloClient();
  // Rooted at `node(id: $libraryId)` below, and also read to key
  // `seenBookIdsRef`'s reset further down. The Library global id
  // `useCurrentLibraryId()` hands out serves admins (viewing another user's
  // library) and non-admins alike — see that hook's own doc comment;
  // `useLibraryTarget()` must never be reached for directly here.
  const { libraryId } = useCurrentLibraryId();

  // Every `PendingFix` row for the current library. SKIPPED outright when
  // `libraryId` is `undefined` — an admin with no library selected has
  // nothing to root `node(id:)` on, and firing with `libraryId: ''` would be
  // a guaranteed-empty round trip on this project's second most expensive
  // operation.
  //
  // `loading`/`error` are deliberately NOT read: this hook renders no
  // loading state of its own (the queue is empty until rows arrive, which is
  // what the screen should show either way), and a failed pending-fix read
  // must not blank the live transport half of the queue.
  const { data, refetch } = useQuery(LibraryPendingFixesDocument, {
    variables: { libraryId: libraryId ?? '' },
    skip: libraryId === undefined,
  });
  const library = data?.node?.__typename === 'Library' ? data.node : undefined;
  const rows = useFragment(PendingFixRowFragment, library?.pendingFixes ?? []);

  // ── The write half: all four resolutions through one mutation ────────────
  //
  // `ACCEPT`/`DISMISS`/`UNDO`/`CLEAR` map one-to-one onto the server's own
  // `PendingFixResolution` enum.
  //
  // **Mostly no manual cache writes.** The mutation selects `library { id
  // pendingFixes { ... } }`, so Apollo reconciles the row list read above
  // from the payload by itself, purely through normalization. The exceptions
  // are both confined to ACCEPT and UNDO, the two actions that rewrite the
  // EPUB — see `run`'s own `update` for each.
  const [resolve] = useMutation(BookResolvePendingFixDocument);

  /**
   * **`fixes` is OMITTED from the variables, not passed as `undefined`, for
   * every bulk action** (`acceptFixes`/`dismissFixes` called with no `fixes`
   * argument, and always for `undoFixes`/`clearFixes`, which never take one).
   * "Absent" is what `BookResolvePendingFixInput.fixes` being optional means
   * server-side: every proposal, so omitting the key is the honest expression
   * of that intent. This is a CLARITY choice, not a behavioural one: a
   * `variables: { id, action, fixes: undefined }` object is wire-identical to
   * omitting the key (`JSON.stringify` drops `undefined`-valued properties
   * the same way either form would be sent), and no test can distinguish the
   * two, so nothing here guards against the `fixes: undefined` form
   * regressing back in.
   */
  const run = useCallback(
    async (id: string, action: PendingFixResolution, fixes?: FixKey[]): Promise<FixOutcome> => {
      try {
        const { data: resolveData } = await resolve({
          // `fixes` is OMITTED, not passed as undefined, for bulk actions —
          // see this callback's own doc comment.
          variables: fixes === undefined ? { id, action } : { id, action, fixes },
          update: (cache, { data: mutationData }) => {
            // ACCEPT applies metadata; UNDO reverts it. Both change the
            // fields the grid sorts and filters on, so both move the book's
            // position in the connection — a move the payload cannot
            // express. DISMISS and CLEAR only touch the pending-fix row,
            // which the payload's own `library { pendingFixes }` selection
            // already reconciles, so they evict nothing.
            if (action !== 'ACCEPT' && action !== 'UNDO') return;
            const outcome = unwrapResult<BookResolvePendingFixPayload>(
              mutationData?.bookResolvePendingFix,
              'BookResolvePendingFixPayload'
            );
            if (outcome.status !== 'ok') return;
            cache.evict({
              id: cache.identify({ __typename: 'Library', id: outcome.payload.library.id }),
              fieldName: 'entries',
            });
            // The book id ROTATES whenever the EPUB is rewritten, and
            // normalization writes the payload into a BRAND-NEW
            // `Book:<newId>` entity — it cannot know the old one described
            // the same book. Left alone, `Book:<oldId>` lingers with
            // pre-accept metadata (and a `pendingFix` holding pre-accept
            // proposals, which `page/book-edit`'s guard modal reads).
            // `cache.gc()` below does NOT save us: a `Library.book(id:
            // oldGid)` field written by any prior /book or /book-edit visit
            // still REFERENCES the orphan, so it is reachable and never
            // collected. Same branch, same reason, as
            // `component/book-edit-form`'s save and
            // `control/upload-replace-modal`'s replace on this identical
            // `applyEpubChanges` path.
            if (outcome.payload.book.id !== id) {
              cache.evict({ id: cache.identify({ __typename: 'Book', id }) });
            }
            cache.gc();
          },
        });
        const outcome = unwrapResult<BookResolvePendingFixPayload>(
          resolveData?.bookResolvePendingFix,
          'BookResolvePendingFixPayload'
        );
        return outcome.status === 'ok'
          ? { ok: true, bookGlobalId: outcome.payload.book.id }
          : { ok: false };
      } catch {
        // A network failure resolves `false` like a typed error does — the
        // public `UseUploadQueue` contract is a bare boolean, and
        // `page/upload` turns it into a toast.
        return { ok: false };
      }
    },
    [resolve]
  );

  const acceptFixes = useCallback(
    (bookGlobalId: string, fixes?: FixKey[]) => run(bookGlobalId, 'ACCEPT', fixes),
    [run]
  );
  const dismissFixes = useCallback(
    (bookGlobalId: string, fixes?: FixKey[]) => run(bookGlobalId, 'DISMISS', fixes),
    [run]
  );
  const undoFixes = useCallback((bookGlobalId: string) => run(bookGlobalId, 'UNDO'), [run]);
  const clearFixes = useCallback((bookGlobalId: string) => run(bookGlobalId, 'CLEAR'), [run]);

  // The upload lands over XHR, so there is no mutation payload for Apollo to
  // reconcile from — the invalidation has to be explicit. Same field-level
  // eviction `page/book`'s delete performs, and for the same reason: the new
  // book's position in a sorted, filtered, paginated connection is the
  // server's to decide, so the only correct move is to drop the stored
  // connection and let the next read miss.
  const onUploaded = useCallback(() => {
    if (libraryId !== undefined) {
      client.cache.evict({
        id: client.cache.identify({ __typename: 'Library', id: libraryId }),
        fieldName: 'entries',
      });
      client.cache.gc();
    }
    void refetch(); // the new book may have arrived with proposals
  }, [client, libraryId, refetch]);
  const transport = useUploadTransport(onUploaded);
  const { remapBookGlobalId } = transport;

  const autoFixesFlat = useFragment(
    MetadataFixFragment,
    rows.flatMap((r) => r.state.autoFixes)
  ).map(toMetadataFix);
  const appliedFixesFlat = useFragment(
    MetadataFixFragment,
    rows.flatMap((r) => r.state.appliedFixes)
  ).map(toMetadataFix);
  const proposalsFlat = useFragment(
    MetadataFixFragment,
    rows.flatMap((r) => r.state.proposals)
  ).map(toMetadataFix);

  // Re-slice the three flattened, unmasked arrays back per row, in the same
  // order `rows` (and therefore the flatMaps above) iterated them.
  const resolvedRows = useMemo<ResolvedRow[]>(() => {
    let ai = 0;
    let oi = 0;
    let pi = 0;
    return rows.map((row) => {
      const autoFixes = autoFixesFlat.slice(ai, ai + row.state.autoFixes.length);
      ai += row.state.autoFixes.length;
      const appliedFixes = appliedFixesFlat.slice(oi, oi + row.state.appliedFixes.length);
      oi += row.state.appliedFixes.length;
      const proposals = proposalsFlat.slice(pi, pi + row.state.proposals.length);
      pi += row.state.proposals.length;
      return { row, autoFixes, appliedFixes, proposals };
    });
  }, [rows, autoFixesFlat, appliedFixesFlat, proposalsFlat]);

  // Every book global id whose `PendingFix` row has been seen at least once
  // in the CURRENT library — updated AFTER each render (`useLayoutEffect`,
  // no deps) so the very next render's `items` computation already reflects
  // a row that just vanished (or, far more often, was re-keyed under a
  // rotated book id). See `mergeRow`'s own doc comment for what actually
  // triggers this guard — it is reachable and load-bearing, contrary to what
  // this file claimed before review C-1.
  //
  // Reset on a `libraryId` change: `UploadProvider` mounts once, unkeyed, at
  // the app root, while the pending-fix read is scoped per-library — an admin
  // switching library targets would otherwise leave this set growing
  // unboundedly for the tab's whole lifetime across every library visited.
  // Book global ids encode their owning library, so a stale entry from a
  // PRIOR library could never actually match a CURRENT item's
  // `bookGlobalId` either way — this reset is memory hygiene, not a
  // behaviour fix; nothing observable through `items` depends on it (see
  // this task's fix-round-1 report for why no test covers it).
  const seenBookIdsRef = useRef(new Set<string>());
  const seenLibraryIdRef = useRef(libraryId);
  useLayoutEffect(() => {
    if (seenLibraryIdRef.current !== libraryId) {
      seenBookIdsRef.current = new Set();
      seenLibraryIdRef.current = libraryId;
    }
    for (const r of resolvedRows) seenBookIdsRef.current.add(r.row.book.id);
  });

  const items = useMemo(() => {
    const byBook = new Map(resolvedRows.map((r) => [r.row.book.id, r]));
    const live: UploadItem[] = transport.items.map((t) => {
      const row = t.bookGlobalId ? byBook.get(t.bookGlobalId) : undefined;
      if (row && t.bookGlobalId) byBook.delete(t.bookGlobalId); // claimed — don't emit it twice
      const everSeen = !!t.bookGlobalId && seenBookIdsRef.current.has(t.bookGlobalId);
      return mergeRow(t, row, everSeen);
    });
    // Whatever is left has no live counterpart: a reload's reseeded rows.
    const seeded = [...byBook.values()].map(seededRow);
    return [...seeded, ...live];
  }, [resolvedRows, transport.items]);

  const globalIdOf = useCallback(
    (itemId: string): string | undefined => items.find((i) => i.id === itemId)?.bookGlobalId,
    [items]
  );

  // The ACCEPT/UNDO half of every mapper below, in one place: run the
  // resolution, FOLLOW the book id if the server rotated it, and hand the
  // caller the plain boolean `UseUploadQueue` promises.
  //
  // The remap is the fix for whole-step review C-1 and is load-bearing on
  // the very first accept of any this-session upload. `TransportItem.
  // bookGlobalId` is written once, in `xhr.onload`, and `items` above joins
  // the live transport against the server's rows on exactly that string. A
  // successful ACCEPT (or the UNDO of an apply-snapshot) re-imports the
  // rewritten EPUB, mints a new content-hash book id, and re-keys the
  // `PendingFix` row under it — so without this the live item's id points at
  // a book the server no longer knows: the join matches nothing, the
  // re-keyed row is emitted as a SECOND card for the same book, `FixReview`'s
  // Edit link points at a dead id, and every further action on the live card
  // resolves `missing`.
  //
  // DISMISS and CLEAR are deliberately NOT routed through here: neither
  // calls `applyEpubChanges`, so neither can rotate an id, and pretending
  // otherwise would suggest a hazard that path does not have.
  const runRotating = useCallback(
    async (itemId: string, action: (gid: string) => Promise<FixOutcome>): Promise<boolean> => {
      const gid = globalIdOf(itemId);
      if (!gid) return false;
      const outcome = await action(gid);
      if (outcome.bookGlobalId !== undefined && outcome.bookGlobalId !== gid) {
        remapBookGlobalId(gid, outcome.bookGlobalId);
      }
      return outcome.ok;
    },
    [globalIdOf, remapBookGlobalId]
  );

  const applyFix = useCallback(
    async (itemId: string, fix: MetadataFix): Promise<boolean> =>
      runRotating(itemId, (gid) => acceptFixes(gid, [fixKeyOf(fix)])),
    [runRotating, acceptFixes]
  );

  const applyAllProposals = useCallback(
    async (itemId: string): Promise<boolean> => runRotating(itemId, (gid) => acceptFixes(gid)),
    [runRotating, acceptFixes]
  );

  const dismissFix = useCallback(
    async (itemId: string, fix: MetadataFix): Promise<boolean> => {
      const gid = globalIdOf(itemId);
      if (!gid) return false;
      return (await dismissFixes(gid, [fixKeyOf(fix)])).ok;
    },
    [globalIdOf, dismissFixes]
  );

  const dismissAllProposals = useCallback(
    async (itemId: string): Promise<boolean> => {
      const gid = globalIdOf(itemId);
      if (!gid) return false;
      return (await dismissFixes(gid)).ok;
    },
    [globalIdOf, dismissFixes]
  );

  const undo = useCallback(
    async (itemId: string): Promise<boolean> => runRotating(itemId, undoFixes),
    [runRotating, undoFixes]
  );

  // Removes the local (live) row and, if this book also has a server row,
  // clears it there too — the local half of the old `dismissCompleted`
  // dropped an item outright; the server half is now a `CLEAR` mutation.
  // `dropItem` is a harmless no-op for a purely-seeded item (its id was never
  // a transport session id).
  const dismissCompleted = useCallback(
    (itemId: string) => {
      const gid = globalIdOf(itemId);
      transport.dropItem(itemId);
      if (gid) void clearFixes(gid);
    },
    [globalIdOf, transport, clearFixes]
  );

  return {
    items,
    addFiles: transport.addFiles,
    applyFix,
    applyAllProposals,
    dismissAllProposals,
    dismissFix,
    undo,
    dismissCompleted,
  };
};

export const useUploadQueue = (): UseUploadQueue => use(UploadContext);
