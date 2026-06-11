import { useEffect } from 'react';

import { CheckIcon, XIcon } from '~/icon';

import { useStyle } from './style';

interface Props {
  id: number;
  message: string;
  type: 'success' | 'error';
  isDismissing: boolean;
  duration: number;
  onDismiss: (id: number) => void;
  onRemove: (id: number) => void;
}

export const Toast = ({
  id,
  message,
  type,
  isDismissing,
  duration,
  onDismiss,
  onRemove,
}: Props) => {
  const styles = useStyle();

  useEffect(() => {
    if (isDismissing) return;
    const timer = setTimeout(() => onDismiss(id), duration);
    return () => clearTimeout(timer);
  }, [isDismissing, id, onDismiss, duration]);

  return (
    <div
      className={isDismissing ? `${styles.toast} ${styles.toastExiting}` : styles.toast}
      onAnimationEnd={isDismissing ? () => onRemove(id) : undefined}
      role="status"
      aria-live={type === 'error' ? 'assertive' : 'polite'}
      aria-atomic="true"
    >
      <span className={type === 'success' ? styles.iconSuccess : styles.iconError}>
        {type === 'success' ? (
          <CheckIcon width={16} height={16} />
        ) : (
          <XIcon width={16} height={16} />
        )}
      </span>
      {message}
    </div>
  );
};
