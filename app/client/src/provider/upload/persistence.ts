import type { UploadItem } from '~/provider/book';

export const STORAGE_KEY = 'upload-queue';

/** An item is worth returning to after a reload only if the user still has a
 * decision to make: pending proposals, or an armed undo they might reverse. */
export const isWorthPersisting = (item: UploadItem): boolean =>
  (item.proposals?.length ?? 0) > 0 || item.undo !== undefined;

/** Storage-safe shape: the live `File` blob is never serializable. */
export type PersistedUploadItem = Omit<UploadItem, 'file'>;

export const serializeQueue = (items: UploadItem[]): PersistedUploadItem[] =>
  items.filter(isWorthPersisting).map((item) => {
    const { file: _file, ...rest } = item;
    return { ...rest, status: 'done' as const, bytesUploaded: item.fileSize };
  });

export const loadQueue = (): UploadItem[] => {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return [];
    const parsed = JSON.parse(raw) as PersistedUploadItem[];
    if (!Array.isArray(parsed)) return [];
    // Rehydrated items never carry a File; they resume as completed uploads.
    return parsed.map((i) => ({ ...i, file: undefined }));
  } catch {
    return [];
  }
};

export const saveQueue = (items: UploadItem[]): void => {
  const subset = serializeQueue(items);
  if (subset.length === 0) {
    localStorage.removeItem(STORAGE_KEY);
    return;
  }
  localStorage.setItem(STORAGE_KEY, JSON.stringify(subset));
};
