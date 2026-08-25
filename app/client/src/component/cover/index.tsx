import { useAuthorizedSrc } from '~/lib/use-authorized-src';

import { useStyle } from './style';

interface CoverProps {
  /**
   * An already-scoped image URL — the REST cover route with `?user=`/`v=` and
   * any width already applied — or `null` to render a ghost placeholder.
   *
   * This component never builds that URL. Since the GraphQL migration it does
   * not need to: the URL arrives fully formed as `Book.thumbnailUrl`, built
   * server-side, and the caller's only decision is `hasCover ? thumbnailUrl :
   * null` (see `component/cover-stack`, the sole production caller). The
   * client-side builder this prop used to co-exist with, `lib/cover-url.ts`,
   * was deleted by step 10 — there is no second source left to pick between.
   * `useAuthorizedSrc` below still turns the URL into an authorized blob.
   */
  src: string | null;
  title?: string;
  sequence: 1 | 2 | 3;
  width: number;
  height: number;
}

export function Cover({ src, title, sequence, width, height }: CoverProps) {
  const style = useStyle({ sequence, height, width, isGhost: !src });
  const authorizedSrc = useAuthorizedSrc(src);

  return src ? (
    <img src={authorizedSrc} alt={title ?? ''} className={`${style.layer} ${style.coverImg}`} />
  ) : (
    <div className={`${style.layer} ${style.ghost}`} />
  );
}
