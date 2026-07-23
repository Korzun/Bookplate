import cx from 'classnames';

import { useStyle } from './style';

interface TagProps {
  children: React.ReactNode;
  onClick?: () => void;
  /** `sm` renders a compact chip that fits within a normal text line height. */
  size?: 'sm' | 'md';
}

export const Tag = ({ children, onClick, size = 'md' }: TagProps) => {
  const style = useStyle();
  return (
    <span
      className={cx(
        style.root,
        size === 'sm' && style.sm,
        onClick !== undefined && style.clickable
      )}
      onClick={onClick}
      role={onClick !== undefined ? 'button' : undefined}
      tabIndex={onClick !== undefined ? 0 : undefined}
      onKeyDown={
        onClick !== undefined
          ? (e) => {
              if (e.key === 'Enter' || e.key === ' ') {
                e.preventDefault();
                onClick();
              }
            }
          : undefined
      }
    >
      {children}
    </span>
  );
};
