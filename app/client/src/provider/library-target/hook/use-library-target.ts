import { use } from 'react';

import { Context } from '../context';

export type UseLibraryTarget = [string | undefined, (libraryId: string | undefined) => void];

export const useLibraryTarget = (): UseLibraryTarget => {
  const { targetLibraryId, setTargetLibraryId } = use(Context);
  return [targetLibraryId, setTargetLibraryId];
};
