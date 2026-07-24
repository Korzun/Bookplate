import cx from 'classnames';
import {
  ReactNode,
  RefObject,
  useCallback,
  useEffect,
  useLayoutEffect,
  useRef,
  useState,
} from 'react';
import { createPortal } from 'react-dom';

import { useStyle } from './style';

type Position = { top: number; left: number; width: number };

type Props = {
  /** Element the popover aligns to (positioned directly beneath it). */
  anchorRef: RefObject<HTMLElement | null>;
  /** Whether the popover is rendered. */
  open: boolean;
  children: ReactNode;
  className?: string;
  /** Vertical gap between the anchor and the popover, in pixels. */
  gap?: number;
  /** Match the popover width to the anchor width (default true). */
  matchWidth?: boolean;
  /**
   * Called on a pointer-down outside both the anchor and the popover content.
   * Omit to opt out of outside-close handling.
   */
  onClose?: () => void;
};

/**
 * Renders `children` in a portal on `document.body`, positioned with `fixed`
 * coordinates directly under `anchorRef`. This lets dropdowns escape ancestors
 * that clip overflow (e.g. cards with rounded corners) without those ancestors
 * having to opt out of clipping.
 */
export const Popover = ({
  anchorRef,
  open,
  children,
  className,
  gap = 4,
  matchWidth = true,
  onClose,
}: Props) => {
  const style = useStyle();
  const contentRef = useRef<HTMLDivElement>(null);
  const [position, setPosition] = useState<Position | null>(null);

  const updatePosition = useCallback(() => {
    const anchor = anchorRef.current;
    if (!anchor) return;
    const rect = anchor.getBoundingClientRect();
    setPosition({ top: rect.bottom + gap, left: rect.left, width: rect.width });
  }, [anchorRef, gap]);

  useLayoutEffect(() => {
    if (!open) return;
    updatePosition();
    const handle = () => updatePosition();
    // Capture-phase scroll so nested scroll containers reposition too.
    window.addEventListener('scroll', handle, true);
    window.addEventListener('resize', handle);
    return () => {
      window.removeEventListener('scroll', handle, true);
      window.removeEventListener('resize', handle);
    };
  }, [open, updatePosition]);

  useEffect(() => {
    if (!open || !onClose) return;
    const handleMouseDown = (event: MouseEvent) => {
      const target = event.target as Node;
      if (anchorRef.current?.contains(target)) return;
      if (contentRef.current?.contains(target)) return;
      onClose();
    };
    document.addEventListener('mousedown', handleMouseDown);
    return () => document.removeEventListener('mousedown', handleMouseDown);
  }, [open, onClose, anchorRef]);

  if (!open || !position) return null;

  return createPortal(
    <div
      ref={contentRef}
      className={cx(style.popover, className)}
      style={{
        top: position.top,
        left: position.left,
        width: matchWidth ? position.width : undefined,
      }}
    >
      {children}
    </div>,
    document.body
  );
};
