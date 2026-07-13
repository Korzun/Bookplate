import { type ReactNode, useCallback, useReducer, useRef } from 'react';

import { Context } from './context';
import { toastReducer } from './reducer';
import { useStyle } from './style';
import { Toast } from './toast';

const TOAST_DURATION = 4000;

type ToastProviderProps = {
  children: ReactNode;
  maxToasts?: number;
};

export const ToastProvider = ({ children, maxToasts = 3 }: ToastProviderProps) => {
  const styles = useStyle();
  const [toasts, dispatch] = useReducer(toastReducer, []);
  const nextId = useRef(0);

  const showToast = useCallback(
    (message: string, type: 'success' | 'error' | 'info') => {
      const id = nextId.current++;
      dispatch({ type: 'add', id, message, toastType: type, maxToasts });
    },
    [maxToasts]
  );

  const handleDismiss = useCallback((id: number) => {
    dispatch({ type: 'dismiss', id });
  }, []);

  const handleRemove = useCallback((id: number) => {
    dispatch({ type: 'remove', id });
  }, []);

  return (
    <Context.Provider value={{ showToast }}>
      {children}
      <div className={styles.container}>
        {toasts.map((toast) => (
          <Toast
            key={toast.id}
            id={toast.id}
            message={toast.message}
            type={toast.type}
            isDismissing={toast.isDismissing}
            duration={TOAST_DURATION}
            onDismiss={handleDismiss}
            onRemove={handleRemove}
          />
        ))}
      </div>
    </Context.Provider>
  );
};
