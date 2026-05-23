import { PropsWithChildren } from 'react';
import { Fragment } from 'react/jsx-runtime';

import { Header } from '../header';

import { useStyle, PageType, PageTypeValue } from './style';

type PageProps = PropsWithChildren<{ type?: PageTypeValue }>;
export const Page = ({ children, type = PageType.default as PageTypeValue }: PageProps) => {
  const styles = useStyle();

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
      {type !== PageType.minimal && <Header />}
      <main className={styles[type]}>{children}</main>
    </Fragment>
  );
};
