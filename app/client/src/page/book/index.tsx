import { useCallback, useMemo, useState } from 'react';
import { useNavigate, useParams } from 'react-router-dom';

import {
  Card,
  Page,
  ProgressIndicator,
  Tag,
  MetadataList,
  BookLineageCard,
  type Metadata,
} from '~/component';
import { Button, DeleteBookButton, RegenChaptersButton, SetProgressModal } from '~/control';
import { useAuthorizedSrc } from '~/lib/use-authorized-src';
import { useIsAdmin } from '~/provider/auth';
import { useBook } from '~/provider/book';
import { useWithTargetUser } from '~/provider/library-target';
import { useMyProgress } from '~/provider/progress';
import { path } from '~/router';
import { formatSize, hashString } from '~/utils';

import { useStyle } from './style';

export const BookPage = () => {
  const styles = useStyle();

  const { id } = useParams<{ id: string }>();
  const navigate = useNavigate();
  const [isAdmin] = useIsAdmin();
  const withTargetUser = useWithTargetUser();

  const [book, loading, error] = useBook(id!, true);
  const [progress] = useMyProgress(id!);
  const [progressModalOpen, setProgressModalOpen] = useState(false);

  const handleEditMetadata = useCallback(
    () => navigate(path.bookEdit(book?.id ?? '')),
    [book, navigate]
  );

  const handleSeriesNavigate = useCallback(() => {
    if (book?.series) {
      navigate(path.series(book.series));
    }
  }, [book, navigate]);

  // Metadata
  const metadata: Metadata[] = [];
  if (!isAdmin) {
    metadata.push({
      title: 'progress',
      value: <ProgressIndicator value={progress ? progress.percentage : 0} size={12} />,
    });
  }
  if (book !== undefined && book.chapterCount > 0) {
    metadata.push({ title: 'chapters', value: book.chapterCount.toString() });
  }
  if (book !== undefined && book.pageCount > 0) {
    metadata.push({ title: 'pages', value: book.pageCount.toString() });
  }
  if (book !== undefined && book.publisher) {
    metadata.push({ title: 'publisher', value: book.publisher });
  }
  if (book !== undefined) {
    metadata.push({ title: 'size', value: formatSize(book.size) });
  }
  if (book !== undefined && book.publishDate) {
    metadata.push({ title: 'published', value: book.publishDate });
  }

  // Description
  const description = useMemo(() => {
    if (book?.description === undefined) {
      return [];
    }
    return book.description
      .replace(/<\/?[^>]+(>|$)/g, '')
      .split(/\r?\n/)
      .filter((paragraph) => paragraph.trim())
      .map((paragraph) => <p key={hashString(paragraph.trim())}>{paragraph.trim()}</p>);
  }, [book]);

  const coverSrc = useAuthorizedSrc(
    book?.hasCover
      ? withTargetUser(`/api/books/${encodeURIComponent(book.id)}/cover?width=170`)
      : null
  );

  if (loading) {
    return (
      <Page>
        <Card>
          <p className={styles.loading}>Loading…</p>
        </Card>
      </Page>
    );
  }

  if (error) {
    return (
      <Page>
        <Card>
          <p className={styles.notFound}>Book not found.</p>
        </Card>
      </Page>
    );
  }

  return (
    <Page>
      <Card>
        <div className={styles.cardContainer}>
          <div className={styles.detail}>
            {book.hasCover ? (
              <img
                className={styles.coverImg}
                src={coverSrc}
                alt={book.title}
                width={80}
                height={118}
              />
            ) : (
              <div className={styles.coverPlaceholder} />
            )}
            <div className={styles.info}>
              <div className={styles.titleContainer}>
                <h1 className={styles.title}>{book.title}</h1>
                {book.series.length > 0 && (
                  <span className={styles.series} onClick={handleSeriesNavigate}>
                    ({book.series}
                    {book.seriesIndex > 0 ? ` #${book.seriesIndex}` : ''})
                  </span>
                )}
              </div>
              {book.author.length > 0 && <div className={styles.author}>{book.author}</div>}
            </div>
          </div>
          <div className={styles.metadata}>
            <MetadataList metadata={metadata} />
          </div>
        </div>
      </Card>
      <Card title="Description">
        <div className={styles.description}>{description}</div>
      </Card>
      <Card title="Subjects">
        {book.subjects.length > 0 && (
          <div className={styles.subjects}>
            {book.subjects.map((subject, index) => (
              <Tag key={subject + index}>{subject}</Tag>
            ))}
          </div>
        )}
      </Card>
      <BookLineageCard
        bookId={book.id}
        addedAt={book.addedAt ? new Date(book.addedAt).getTime() : undefined}
      />
      <div className={styles.buttonContainer}>
        {book.chapterCount > 0 && (
          <Button onClick={() => setProgressModalOpen(true)}>Set progress</Button>
        )}
        <div className={styles.spacer} />
        <RegenChaptersButton bookId={book.id} />
        <Button onClick={handleEditMetadata}>Edit metadata</Button>
        <DeleteBookButton bookId={book.id} />
      </div>
      {progressModalOpen && (
        <SetProgressModal
          isOpen
          bookId={book.id}
          chapterCount={book.chapterCount}
          initialChapter={progress?.currentChapter ?? 0}
          chapterSpineMap={book.chapterSpineMap ?? []}
          chapterNames={book.chapterNames ?? []}
          onClose={() => setProgressModalOpen(false)}
        />
      )}
    </Page>
  );
};
