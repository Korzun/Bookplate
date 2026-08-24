import { createContext } from 'react';

import type { UseUploadQueue } from './hook/use-upload-queue';

/** Lifted upload-queue state, shared across the whole app so it survives
 * navigation. Mounted above the router and below BookProvider. */
export const UploadContext = createContext<UseUploadQueue>({
  items: [],
  addFiles: () => {},
  applyFix: async () => false,
  applyAllProposals: async () => false,
  dismissAllProposals: async () => false,
  dismissFix: async () => false,
  undo: async () => false,
  dismissCompleted: () => {},
});
