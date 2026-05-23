import { useEffect } from 'react';

import { CheckIcon, XIcon } from '~/icon';

import { useStyle } from './style';

interface Props {
  message: string;
  type: 'success' | 'error';
  onDismiss: () => void;
  duration?: number;
}

export const Toast = ({ message, type, onDismiss, duration = 4000 }: Props) => {
  const styles = useStyle();

  useEffect(() => {
    const timer = setTimeout(onDismiss, duration);
    return () => clearTimeout(timer);
  }, [onDismiss, duration]);

  return (
    <div className={styles.toast}>
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
