import { PropsWithChildren } from 'react';

import { useStyle } from './style';

export type MetadataProps = PropsWithChildren<{ title: string }>;
export const Metadata = ({ children, title }: MetadataProps) => {
  const styles = useStyle();

  return (
    <div className={styles.root}>
      <div className={styles.title}>{title}:</div>
      <div className={styles.value}>{children}</div>
    </div>
  );
};
