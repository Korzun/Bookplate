import { useContext } from 'react';

import { Context } from '../context';

export const useToast = (): ((message: string, type: 'success' | 'error' | 'info') => void) => {
  const { showToast } = useContext(Context);
  return showToast;
};
