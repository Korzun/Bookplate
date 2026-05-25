import cx from 'classnames';
import { ReactNode } from 'react';

import { useMyProgressList } from '~/provider/progress';

import { MyProgressRow } from '../my-progress-row';

import { useStyle } from './style';

export const MyProgressContent = () => {
  const styles = useStyle();

  const [myProgressList, loading, error] = useMyProgressList();

  if (loading) {
    return <div className={styles.message}>Loading...</div>;
  }
  if (error) {
    return <div className={cx(styles.message, styles.error)}>Error loading progress</div>;
  }
  if (myProgressList === undefined || Object.keys(myProgressList).length === 0) {
    return <div className={styles.message}>No progress synced</div>;
  }
  return Object.values(myProgressList ?? {}).map((progress) => (
    <MyProgressRow key={progress.document} bookId={progress.document} />
  )) as ReactNode[];
};
