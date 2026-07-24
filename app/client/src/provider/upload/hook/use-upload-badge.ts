import { useUploadQueue } from './use-upload-queue';

export type UploadBadge = { count: number; active: boolean };

/** Nav-badge signal: `count` books have fixes awaiting a decision; `active` is
 * true while any upload is still running. */
export const useUploadBadge = (): UploadBadge => {
  const { items } = useUploadQueue();
  const count = items.filter((i) => (i.proposals?.length ?? 0) > 0).length;
  const active = items.some((i) => i.status === 'queued' || i.status === 'uploading');
  return { count, active };
};
