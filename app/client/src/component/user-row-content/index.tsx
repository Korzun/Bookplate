import cx from 'classnames';
import { ReactNode } from 'react';

import { useUserProgressList } from '~/provider/progress';

import { UserProgressRow } from '../user-progress-row';
import { useStyle } from './style';

interface UserRowContentProps {
  username: string;
}

export const UserRowContent = ({ username }: UserRowContentProps) => {
  const styles = useStyle();

  const [userProgressList, loading, error] = useUserProgressList(username);

  if (loading) {
    return <div className={styles.message}>Loading...</div>;
  }
  if (error) {
    return <div className={cx(styles.message, styles.error)}>Error loading user progress</div>;
  }
  if (userProgressList === undefined || Object.keys(userProgressList).length === 0) {
    return <div className={styles.message}>No progress synced</div>;
  }
  return Object.values(userProgressList ?? {}).map((progress) => (
    <UserProgressRow key={progress.document} bookId={progress.document} username={username} />
  )) as ReactNode[];
};
