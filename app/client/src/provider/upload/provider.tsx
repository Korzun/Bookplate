import type { ReactNode } from 'react';

import { useUploadQueueEngine } from '~/provider/book';

import { UploadContext } from './context';

export type UploadProviderProps = { children: ReactNode };

/** Runs the upload-queue engine exactly once, high in the tree, and shares it
 * via context so navigating between pages no longer tears the queue down. */
export const UploadProvider = ({ children }: UploadProviderProps) => {
  const value = useUploadQueueEngine();
  return <UploadContext.Provider value={value}>{children}</UploadContext.Provider>;
};
