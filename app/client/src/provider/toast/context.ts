import { createContext } from 'react';

export type ToastContext = {
  showToast: (message: string, type: 'success' | 'error' | 'info') => void;
};

export const Context = createContext<ToastContext>({
  showToast: () => {},
});
