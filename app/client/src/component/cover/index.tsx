import { useAuthorizedSrc } from '~/lib/use-authorized-src';

import { useStyle } from './style';

interface CoverProps {
  bookId: string | null;
  title?: string;
  sequence: 1 | 2 | 3;
  width: number;
  height: number;
  thumbnailWidth?: number;
}

export function Cover({ bookId, title, sequence, width, height, thumbnailWidth }: CoverProps) {
  const style = useStyle({ sequence, height, width, isGhost: !bookId });
  const url = bookId
    ? thumbnailWidth
      ? `/api/books/${encodeURIComponent(bookId)}/cover?width=${thumbnailWidth}`
      : `/api/books/${encodeURIComponent(bookId)}/cover`
    : null;
  const src = useAuthorizedSrc(url);

  return bookId ? (
    <img src={src} alt={title ?? ''} className={`${style.layer} ${style.coverImg}`} />
  ) : (
    <div className={`${style.layer} ${style.ghost}`} />
  );
}
