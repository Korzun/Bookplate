import { use } from 'react';

import { Context } from '../context';

export type UseLibraryTarget = [string | undefined, (username: string | undefined) => void];

export const useLibraryTarget = (): UseLibraryTarget => {
  const { targetUsername, setTargetUsername } = use(Context);
  return [targetUsername, setTargetUsername];
};
