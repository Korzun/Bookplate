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
      <svg className={styles.noise} aria-hidden="true">
        <filter id="page-noise">
          <feTurbulence
            type="fractalNoise"
            baseFrequency="0.75"
            numOctaves="4"
            stitchTiles="stitch"
          />
          <feColorMatrix type="saturate" values="0" />
        </filter>
        <rect width="100%" height="100%" filter="url(#page-noise)" />
      </svg>
      <main className={styles[type]}>{children}</main>
    </Fragment>
  );
};
