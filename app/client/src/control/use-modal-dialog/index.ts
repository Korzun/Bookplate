import { useEffect, useRef } from 'react';

/**
 * Drives a native `<dialog>` from an `isOpen` flag and wires up ESC-to-dismiss.
 *
 * The dialog stays fully controlled: pressing Escape fires the `cancel` event,
 * which we intercept — calling `preventDefault()` so the browser never closes
 * the dialog behind React's back — and route through `onDismiss` so the
 * `isOpen` prop remains the single source of truth.
 *
 * When `canDismiss` is false the Escape press is swallowed, so a modal whose
 * only exit is gated (a countdown, an in-flight request) can't be escaped —
 * matching a disabled confirm/done button.
 *
 * Modals still handle backdrop clicks themselves; a modal `<dialog>` shown via
 * `showModal()` never light-dismisses on its own, so the two paths don't overlap.
 */
export function useModalDialog(isOpen: boolean, onDismiss: () => void, canDismiss = true) {
  const ref = useRef<HTMLDialogElement>(null);

  useEffect(() => {
    const element = ref.current;
    if (!element) {
      return;
    }
    if (isOpen) {
      element.showModal();
    } else {
      element.close();
    }
  }, [isOpen]);

  useEffect(() => {
    const element = ref.current;
    if (!element) {
      return;
    }
    const handleCancel = (event: Event) => {
      // Keep React in control of open/closed; never let the UA close it for us.
      event.preventDefault();
      if (canDismiss) {
        onDismiss();
      }
    };
    element.addEventListener('cancel', handleCancel);
    return () => element.removeEventListener('cancel', handleCancel);
  }, [onDismiss, canDismiss]);

  return ref;
}
