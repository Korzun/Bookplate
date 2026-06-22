import { Page } from '~/component';
import { BooksIcon, SpinnerIcon } from '~/icon';
import { useLibraryName } from '~/provider/config';

import { useStyle } from './style';

export const LoadingPage = () => {
  const styles = useStyle();
  const libraryName = useLibraryName();
  return (
    <Page type="minimal">
      <div className={styles.root}>
        <h1 className={styles.title}>
          <BooksIcon /> {libraryName}
        </h1>
        <SpinnerIcon role="status" aria-label="Loading" className={styles.spinner} />
      </div>
    </Page>
  );
};
