import { PropsWithChildren, useEffect } from 'react';
import { Fragment } from 'react/jsx-runtime';

import { useLibraryName } from '~/provider/config';

import { useStyle, PageType, PageTypeValue } from './style';

type PageProps = PropsWithChildren<{ type?: PageTypeValue }>;
export const Page = ({ children, type = PageType.default as PageTypeValue }: PageProps) => {
  const styles = useStyle();
  const libraryName = useLibraryName();

  useEffect(() => {
    document.title = libraryName;
  }, [libraryName]);

  return (
    <Fragment>
      <main className={styles[type]}>{children}</main>
    </Fragment>
  );
};
