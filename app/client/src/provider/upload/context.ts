import { createContext } from 'react';

import type { UseUploadQueue } from './hook/use-upload-queue';
import type { AddFileOptions } from './hook/use-upload-transport';

/** Lifted upload-queue state, shared across the whole app so it survives
 * navigation. Mounted above the router, in `UploadProvider`. */
export const UploadContext = createContext<UseUploadQueue>({
  items: [],
  addFiles: (_files: FileList, _options?: AddFileOptions) => {},
  applyFix: async () => false,
  applyAllProposals: async () => false,
  dismissAllProposals: async () => false,
  dismissFix: async () => false,
  undo: async () => false,
  dismissCompleted: () => {},
});
