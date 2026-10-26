import { type ReactNode, useCallback, useLayoutEffect, useReducer, useRef } from 'react';

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

  // The container is a MANUAL popover so toasts render in the top layer: a
  // `<dialog>` opened with `showModal()` sits above every z-index on the page,
  // and only another top-layer element can appear over it. Top-layer elements
  // stack in the order they were shown, so the popover is opened the moment
  // the first toast appears (after whatever modal is up) and closed once the
  // last one has left — showing it once at mount would leave it under any
  // modal opened later.
  //
  // The attribute is set only where the API exists. A browser without it
  // would ignore the attribute anyway, but jsdom is the odd case: it ships the
  // user-agent rule that hides `[popover]` until it is open while implementing
  // none of the methods that open it, so an unconditional attribute would hide
  // every toast under test. Detected at render, not module load, so a test can
  // still install the API before rendering.
  const containerRef = useRef<HTMLDivElement>(null);
  const supportsPopover =
    typeof HTMLElement !== 'undefined' && typeof HTMLElement.prototype.showPopover === 'function';
  const hasToasts = toasts.length > 0;
  const popoverOpenRef = useRef(false);
  useLayoutEffect(() => {
    const element = containerRef.current;
    if (!element || !supportsPopover || hasToasts === popoverOpenRef.current) return;
    try {
      if (hasToasts) element.showPopover();
      else element.hidePopover();
      popoverOpenRef.current = hasToasts;
    } catch {
      // Detached from the document mid-transition — nothing to do.
    }
  }, [hasToasts, supportsPopover]);

  return (
    <Context.Provider value={{ showToast }}>
      {children}
      <div
        ref={containerRef}
        popover={supportsPopover ? 'manual' : undefined}
        className={styles.container}
      >
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
