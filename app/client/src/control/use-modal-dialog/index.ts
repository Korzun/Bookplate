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
 * Backdrop clicks are handled here too — a modal `<dialog>` shown via
 * `showModal()` never light-dismisses on its own. A click only counts as a
 * backdrop click when the press AND the release both landed on the `<dialog>`
 * element itself (the backdrop is the dialog's own box; its content sits in a
 * child). The browser fires `click` on the common ancestor of the mousedown
 * and mouseup targets, so a text selection dragged out of an input and
 * released over the backdrop also clicks the `<dialog>` — and must not close
 * it. Modals keep their own `onClick` only to stop the click bubbling to a
 * clickable ancestor; they no longer decide dismissal.
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
    let pressedOnBackdrop = false;
    const handleMouseDown = (event: MouseEvent) => {
      pressedOnBackdrop = event.target === element;
    };
    const handleClick = (event: MouseEvent) => {
      const releasedOnBackdrop = event.target === element;
      const isBackdropClick = pressedOnBackdrop && releasedOnBackdrop;
      pressedOnBackdrop = false;
      if (isBackdropClick && canDismiss) {
        onDismiss();
      }
    };
    element.addEventListener('cancel', handleCancel);
    element.addEventListener('mousedown', handleMouseDown);
    element.addEventListener('click', handleClick);
    return () => {
      element.removeEventListener('cancel', handleCancel);
      element.removeEventListener('mousedown', handleMouseDown);
      element.removeEventListener('click', handleClick);
    };
  }, [onDismiss, canDismiss]);

  return ref;
}
