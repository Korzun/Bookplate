import { useApolloClient } from '@apollo/client/react';
import { use, useCallback, useLayoutEffect, useMemo, useRef } from 'react';

import { useFragment } from '~/gql';
import type { UndoKind } from '~/gql/graphql';
import { MetadataFixFragment } from '~/graphql/upload';
import type { ValidationFailure } from '~/lib/severity';
import type { MetadataFix } from '~/provider/book';
import { useCurrentLibraryId } from '~/provider/library-target';

import { UploadContext } from '../context';
import type { FixKey } from './use-fix-actions';
import { useFixActions } from './use-fix-actions';
import type { PendingFixRow } from './use-pending-fixes';
import { usePendingFixes } from './use-pending-fixes';
import type { TransportItem } from './use-upload-transport';
import { useUploadTransport } from './use-upload-transport';

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
 * rotates and the row remounts after an accept. That's cosmetic (the row
 * re-renders with the same content) and accepted on purpose — see this
 * migration's spec §4.4. */
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
 * `PendingFix` row has round-tripped back through `usePendingFixes`.
 *
 * `everSeen` is a DEFENSIVE guard, not a fix for an observed bug: it
 * distinguishes that transient "no row YET" gap from a row that EXISTED
 * earlier this session and has since vanished, so that IF a row a live item
 * was matched against ever disappears, this falls back to "no proposals"
 * rather than resurrecting the transport's stale pre-resolution list.
 *
 * The current server contract does not actually reach the "row vanished
 * while a live item remains" branch: `bookResolvePendingFix`'s ACCEPT and
 * DISMISS both always arm `undo` on success
 * (`app/server/.../resolve-pending-fix.ts`), `BookStore.upsertPendingFix`
 * only deletes a row when `proposals.length === 0 && !state.undo`
 * (`book-store.ts`), and `isLivePendingFix` keeps a resolved-but-undo-armed
 * row live in `Library.pendingFixes` for 7 days (`derive.ts`) — so a normal
 * ACCEPT/DISMISS/UNDO never produces a vanished row while a matching
 * transport item is still around. `CLEAR` is the one path that removes a
 * row, but `dismissCompleted` drops the local transport item in the very
 * same call, so there's no live item left to hit this branch either. The
 * ONLY theoretical trigger is the 7-day TTL lapsing while this tab has
 * stayed open with a matching live item the whole time. Kept anyway because
 * that invariant lives in a different layer (the server) and is enforced
 * nowhere on the client — deleting this guard would make client
 * correctness silently depend on server behaviour a future change could
 * flip without any client-side test catching it. */
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
 * The merged upload queue: joins the live transport (Task 6,
 * `useUploadTransport`) with the server's pending-fix rows (Task 7,
 * `usePendingFixes`/`useFixActions`) on `bookGlobalId`, and maps the public
 * fix-actions onto `useFixActions`'s four resolutions.
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
 * `proposals`) stay masked one level deeper than `usePendingFixes` itself
 * unmasks (that hook's own doc comment) — unmasking them is this hook's job.
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
  const { rows, refetch } = usePendingFixes();
  const { acceptFixes, dismissFixes, undoFixes, clearFixes } = useFixActions();
  const client = useApolloClient();
  // Also read to key `seenBookIdsRef`'s reset below — `usePendingFixes`
  // already resolves the same id internally via this same hook.
  const { libraryId } = useCurrentLibraryId();

  // The upload lands over XHR, so there is no mutation payload for Apollo to
  // reconcile from — the invalidation has to be explicit. Same field-level
  // eviction `use-delete-book` performs, and for the same reason: the new
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
    refetch(); // the new book may have arrived with proposals
  }, [client, libraryId, refetch]);
  const transport = useUploadTransport(onUploaded);

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
  // a row that just vanished. See `mergeRow`'s own doc comment for why this
  // (defensive, not currently reachable) guard exists at all.
  //
  // Reset on a `libraryId` change: `UploadProvider` mounts once, unkeyed, at
  // the app root, while `usePendingFixes` is scoped per-library — an admin
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

  const applyFix = useCallback(
    async (itemId: string, fix: MetadataFix): Promise<boolean> => {
      const gid = globalIdOf(itemId);
      if (!gid) return false;
      return acceptFixes(gid, [fixKeyOf(fix)]);
    },
    [globalIdOf, acceptFixes]
  );

  const applyAllProposals = useCallback(
    async (itemId: string): Promise<boolean> => {
      const gid = globalIdOf(itemId);
      if (!gid) return false;
      return acceptFixes(gid);
    },
    [globalIdOf, acceptFixes]
  );

  const dismissFix = useCallback(
    async (itemId: string, fix: MetadataFix): Promise<boolean> => {
      const gid = globalIdOf(itemId);
      if (!gid) return false;
      return dismissFixes(gid, [fixKeyOf(fix)]);
    },
    [globalIdOf, dismissFixes]
  );

  const dismissAllProposals = useCallback(
    async (itemId: string): Promise<boolean> => {
      const gid = globalIdOf(itemId);
      if (!gid) return false;
      return dismissFixes(gid);
    },
    [globalIdOf, dismissFixes]
  );

  const undo = useCallback(
    async (itemId: string): Promise<boolean> => {
      const gid = globalIdOf(itemId);
      if (!gid) return false;
      return undoFixes(gid);
    },
    [globalIdOf, undoFixes]
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
