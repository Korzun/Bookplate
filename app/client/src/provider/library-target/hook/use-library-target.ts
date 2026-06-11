import { useContext } from 'react';

import { Context } from '../context';

export type UseLibraryTarget = [string | undefined, (username: string | undefined) => void];

export const useLibraryTarget = (): UseLibraryTarget => {
  const { targetUsername, setTargetUsername } = useContext(Context);
  return [targetUsername, setTargetUsername];
};
