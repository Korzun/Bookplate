import { coverUrl } from '~/lib/cover-url';
import { useAuthorizedSrc } from '~/lib/use-authorized-src';
import { useWithTargetUser } from '~/provider/library-target';

import { useStyle } from './style';

interface CoverProps {
  bookId: string | null;
  title?: string;
  sequence: 1 | 2 | 3;
  width: number;
  height: number;
  thumbnailWidth?: number;
  version?: string | number;
}

export function Cover({
  bookId,
  title,
  sequence,
  width,
  height,
  thumbnailWidth,
  version,
}: CoverProps) {
  const withTargetUser = useWithTargetUser();
  const style = useStyle({ sequence, height, width, isGhost: !bookId });
  const url = bookId ? withTargetUser(coverUrl(bookId, { width: thumbnailWidth, version })) : null;
  const src = useAuthorizedSrc(url);

  return bookId ? (
    <img src={src} alt={title ?? ''} className={`${style.layer} ${style.coverImg}`} />
  ) : (
    <div className={`${style.layer} ${style.ghost}`} />
  );
}
