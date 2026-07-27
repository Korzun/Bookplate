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
  /** Overrides the overflow trigger's label (default "More…") on the desktop
   * action bar — e.g. "Actions" when every action lives in the menu. */
  actionsLabel?: string;
  footerActions?: FooterAction[];
}>;

export const Page = ({
  children,
  type = PageType.default as PageTypeValue,
  back,
  headerActions,
  actionsLabel,
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
        {hasHeaderActions && <PageActionsBar items={headerActions} actionsLabel={actionsLabel} />}
        {children}
        {footerActions !== undefined && footerActions.length > 0 && (
          <PageFooterActions items={footerActions} />
        )}
      </main>
    </Fragment>
  );
};
