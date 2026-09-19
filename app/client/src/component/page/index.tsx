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
  /**
   * The page's own chrome for the header row — the row the desktop actions bar
   * occupies, which every default page holds open whether or not it has
   * actions (see `style.ts`).
   *
   * `page/library` passes its `<SearchBar />` here rather than rendering it as
   * the first child: as a child it would sit BELOW the reserved row, starting
   * the one page anyone lands on first lower than every other page. In the
   * slot it lines up with every other page's actions instead.
   */
  header?: React.ReactNode;
  footerActions?: FooterAction[];
}>;

export const Page = ({
  children,
  type = PageType.default as PageTypeValue,
  back,
  headerActions,
  actionsLabel,
  header,
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
        {/* Rendered for every default page, EMPTY INCLUDED — holding the row
            open is what keeps pages with and without actions starting their
            content at the same height. A minimal page (login, loading, the
            forced password change) has no nav, no actions and nothing to line
            up with, so it gets no row. */}
        {type === PageType.default && (
          <header className={styles.headerRow}>
            {hasHeaderActions && (
              <PageActionsBar items={headerActions} actionsLabel={actionsLabel} />
            )}
            {header}
          </header>
        )}
        {children}
        {footerActions !== undefined && footerActions.length > 0 && (
          <PageFooterActions items={footerActions} />
        )}
      </main>
    </Fragment>
  );
};
