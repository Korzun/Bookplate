import { useMyProgressList } from '~/provider/progress';

import { Card } from '../card';
import { MyProgressContent } from '../my-progress-content';

import { useStyle } from './style';

export const MyProgress = () => {
  const styles = useStyle();
  const [progressList] = useMyProgressList();
  const syncedCount = progressList ? Object.keys(progressList).length : 0;

  return (
    <Card
      title="Progress"
      subTitle={
        progressList ? `${syncedCount} book${syncedCount === 1 ? '' : 's'} synced` : undefined
      }
    >
      <div className={styles.content}>
        <MyProgressContent />
      </div>
    </Card>
  );
};
