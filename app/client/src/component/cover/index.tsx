import { useAuthorizedSrc } from '~/lib/use-authorized-src';

import { useStyle } from './style';

interface CoverProps {
  /**
   * An already-scoped image URL (REST cover route, `?user=`/`v=` and any
   * width already applied by the caller), or `null` to render a ghost
   * placeholder. This component no longer builds that URL itself — see
   * `component/cover-stack`'s doc comment for why: it now has two sources
   * (a server-built `Book.thumbnailUrl` off GraphQL, and `coverUrl()` +
   * `withTargetUser()` off REST), and picking between them is the caller's
   * job, exactly the split `BookRow`/`BookRowFromEntry` already established.
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
