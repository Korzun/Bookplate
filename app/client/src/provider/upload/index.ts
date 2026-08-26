// The upload provider's public surface. `hook/index.ts` used to sit in
// between; it was a pure pass-through once the three read hooks
// (`usePendingFixes`, `useUploadBadge`, `useFixActions`) were dissolved into
// their call sites, so it is gone and this barrel points at the module
// directly.
export { useUploadQueue, fixKey, fixKeyOf } from './hook/use-upload-queue';
export type {
  UploadItem,
  UploadItemStatus,
  UndoSnapshot,
  UseUploadQueue,
} from './hook/use-upload-queue';
export { UploadProvider } from './provider';
