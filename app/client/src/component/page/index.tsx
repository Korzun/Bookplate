import { PropsWithChildren, useEffect } from 'react';
import { Fragment } from 'react/jsx-runtime';

import {
  BackButton,
  PageActionsBar,
  PageActionsMenu,
  PageFooterActions,
  type FooterAction,
  type PageActionItem,
} from '~/control';
import { useLibraryName } from '~/provider/config';

import { useStyle, PageType, PageTypeValue } from './style';

type PageProps = PropsWithChildren<{
  type?: PageTypeValue;
  back?: string;
  headerActions?: PageActionItem[];
  footerActions?: FooterAction[];
}>;

export const Page = ({
  children,
  type = PageType.default as PageTypeValue,
  back,
  headerActions,
  footerActions,
}: PageProps) => {
  const styles = useStyle();
  const libraryName = useLibraryName();

  useEffect(() => {
    document.title = libraryName;
  }, [libraryName]);

  const hasHeaderActions = headerActions !== undefined && headerActions.length > 0;
  const showTopInset = back !== undefined || hasHeaderActions;

  return (
    <Fragment>
      <main className={styles[type]}>
        {back !== undefined && <BackButton to={back} />}
        {hasHeaderActions && <PageActionsMenu items={headerActions} />}
        {showTopInset && <div className={styles.topInset} aria-hidden="true" />}
        {hasHeaderActions && <PageActionsBar items={headerActions} />}
        {children}
        {footerActions !== undefined && footerActions.length > 0 && (
          <PageFooterActions items={footerActions} />
        )}
      </main>
    </Fragment>
  );
};
