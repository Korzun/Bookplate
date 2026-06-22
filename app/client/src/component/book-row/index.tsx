import cx from 'classnames';
import { useCallback } from 'react';
import { useNavigate } from 'react-router-dom';

import { coverUrl } from '~/lib/cover-url';
import { useAuthorizedSrc } from '~/lib/use-authorized-src';
import { useBook } from '~/provider/book';
import { useWithTargetUser } from '~/provider/library-target';
import { useMyProgress } from '~/provider/progress';
import { path } from '~/router';

import { Card } from '../card';

import { useStyle } from './style';

interface BookRowProps {
  asCard?: boolean;
  bookId: string;
  showAuthor?: boolean;
}

export function BookRow({ asCard = true, bookId, showAuthor = true }: BookRowProps) {
  const styles = useStyle();
  const navigate = useNavigate();
  const withTargetUser = useWithTargetUser();

  const [book, loading, error] = useBook(bookId);
  const [progress] = useMyProgress(bookId);

  const handleNavigate = useCallback(() => {
    if (!book) {
      return;
    }
    navigate(path.book(book.id));
  }, [book, navigate]);

  const coverSrc = useAuthorizedSrc(
    book?.hasCover ? withTargetUser(coverUrl(book.id, { width: 88, version: book.mtime })) : null
  );

  if (loading) {
    const loadingContent = <div className={styles.root}>Loading...</div>;
    return asCard ? <Card size="small">{loadingContent}</Card> : loadingContent;
  }

  if (error) {
    const errorContent = <div className={styles.root}>Error loading book</div>;
    return asCard ? <Card size="small">{errorContent}</Card> : errorContent;
  }

  const meta: string[] = [];
  if (showAuthor && book.author) {
    meta.push(book.author);
  }
  if (book.seriesIndex > 0) {
    meta.push(`Book ${book.seriesIndex}`);
  }
  if (progress) {
    if (progress.percentage < 1) {
      meta.push(`${(progress.percentage * 100).toFixed(0)}%`);
    } else {
      meta.push(`Completed`);
    }
  }

  const content = (
    <div
      className={cx(styles.root, { [styles.navigate]: !asCard })}
      onClick={!asCard ? handleNavigate : undefined}
    >
      <div className={styles.cover}>
        {book.hasCover ? (
          <img src={coverSrc} alt={book.title} className={styles.coverImg} />
        ) : (
          <div className={styles.coverPlaceholder} />
        )}
      </div>
      <div className={styles.info}>
        <div className={styles.title}>{book.title}</div>
        <div className={styles.meta}>{meta.join(' · ')}</div>
      </div>
    </div>
  );

  return asCard ? (
    <Card size="small" onClick={handleNavigate}>
      {content}
    </Card>
  ) : (
    content
  );
}
