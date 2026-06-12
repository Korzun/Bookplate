import { Page } from '~/component';
import { BooksIcon, SpinnerIcon } from '~/icon';

import { useStyle } from './style';

export const LoadingPage = () => {
  const styles = useStyle();
  return (
    <Page type="minimal">
      <div className={styles.root}>
        <h1 className={styles.title}>
          <BooksIcon /> HASS-ODPS
        </h1>
        <SpinnerIcon role="status" aria-label="Loading" className={styles.spinner} />
      </div>
    </Page>
  );
};
