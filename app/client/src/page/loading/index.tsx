import { BrandLockup, Page } from '~/component';
import { SpinnerIcon } from '~/icon';

import { useStyle } from './style';

export const LoadingPage = () => {
  const styles = useStyle();
  return (
    <Page type="minimal">
      <div className={styles.root}>
        <BrandLockup />
        <SpinnerIcon role="status" aria-label="Loading" className={styles.spinner} />
      </div>
    </Page>
  );
};
