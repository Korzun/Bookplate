import cx from 'classnames';

import { useStyle } from './style';

interface TagProps {
  children: React.ReactNode;
  onClick?: () => void;
}

export const Tag = ({ children, onClick }: TagProps) => {
  const style = useStyle();
  return (
    <span
      className={cx(style.root, onClick !== undefined && style.clickable)}
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
