import type { MetadataFix, UndoSnapshot } from '~/provider/book';

import { apiFetch } from '../../lib/api-fetch';

export type PendingFixState = {
  autoFixes: MetadataFix[];
  appliedFixes: MetadataFix[];
  proposals: MetadataFix[];
  undo: UndoSnapshot | null;
};

export type PendingFixDto = {
  bookId: string;
  /** Relay global id for `bookId` (Task 7, book-edit spec) — lets a
   * reseeded item build a working Edit link without the client ever
   * encoding one itself. */
  globalId: string;
  fileName: string;
  fileSize: number;
} & PendingFixState;

type WithUser = (path: string) => string;

export const getPendingFixes = async (withUser: WithUser): Promise<PendingFixDto[]> => {
  try {
    const res = await apiFetch(withUser('/api/books/pending-fixes'));
    if (!res.ok) return [];
    const data: unknown = await res.json();
    return Array.isArray(data) ? (data as PendingFixDto[]) : [];
  } catch {
    return [];
  }
};

export const putPendingFix = async (
  withUser: WithUser,
  bookId: string,
  body: { fileName: string; fileSize: number; state: PendingFixState }
): Promise<void> => {
  try {
    await apiFetch(withUser(`/api/books/${encodeURIComponent(bookId)}/pending-fixes`), {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    });
  } catch {
    // Swallow — this is a best-effort sync of pending-fix state; a failure here
    // shouldn't surface as an unhandled rejection to callers that fire-and-forget.
  }
};

export const deletePendingFix = async (withUser: WithUser, bookId: string): Promise<void> => {
  try {
    await apiFetch(withUser(`/api/books/${encodeURIComponent(bookId)}/pending-fixes`), {
      method: 'DELETE',
    });
  } catch {
    // Swallow — best-effort cleanup; see putPendingFix.
  }
};
