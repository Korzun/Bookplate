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
  await apiFetch(withUser(`/api/books/${encodeURIComponent(bookId)}/pending-fixes`), {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
};

export const deletePendingFix = async (withUser: WithUser, bookId: string): Promise<void> => {
  await apiFetch(withUser(`/api/books/${encodeURIComponent(bookId)}/pending-fixes`), {
    method: 'DELETE',
  });
};
