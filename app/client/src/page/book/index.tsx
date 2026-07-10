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
import {
  BackButton,
  Button,
  ConfirmModal,
  DeleteBookButton,
  PageActionsMenu,
  RegenChaptersButton,
  SetProgressModal,
  type PageActionItem,
} from '~/control';
import { AlertOctagonIcon } from '~/icon';
import { coverUrl } from '~/lib/cover-url';
import { useAuthorizedSrc } from '~/lib/use-authorized-src';
import { useIsAdmin } from '~/provider/auth';
import { useBook, useDeleteBook, useRegenChapters } from '~/provider/book';
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

  const [regenChapters, regenLoading] = useRegenChapters();
  const [deleteBook, deleting] = useDeleteBook();
  const [deleteModalOpen, setDeleteModalOpen] = useState(false);

  const handleDeleteConfirm = useCallback(async () => {
    setDeleteModalOpen(false);
    await deleteBook(id!);
    navigate(path.home());
  }, [deleteBook, id, navigate]);

  const handleEditMetadata = useCallback(
    () => navigate(path.bookEdit(book?.id ?? '')),
    [book, navigate]
  );

  const handleSeriesNavigate = useCallback(() => {
    if (book?.series) {
      navigate(path.series(book.series));
    }
  }, [book, navigate]);

  const handleSubjectNavigate = useCallback(
    (subject: string) => navigate(path.library({ subject })),
    [navigate]
  );

  const handleAuthorNavigate = useCallback(
    () => navigate(path.library({ author: book?.author ?? '' })),
    [book, navigate]
  );

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
  if (book !== undefined && book.publishDate) {
    const formatted = new Date(book.publishDate).toLocaleDateString('en-US', {
      year: 'numeric',
      month: 'long',
      day: 'numeric',
      timeZone: 'UTC',
    });
    metadata.push({ title: 'published', value: formatted });
  }
  if (book !== undefined) {
    metadata.push({ title: 'size', value: formatSize(book.size) });
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
    book?.hasCover ? withTargetUser(coverUrl(book.id, { width: 160, version: book.mtime })) : null
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

  const actionItems: PageActionItem[] = [];
  if (book.chapterCount > 0) {
    actionItems.push({ label: 'Set progress', onClick: () => setProgressModalOpen(true) });
  }
  actionItems.push({
    label: 'Regen chapters',
    onClick: () => void regenChapters(book.id),
    disabled: regenLoading,
  });
  actionItems.push({ label: 'Edit metadata', onClick: handleEditMetadata });
  actionItems.push({
    label: 'Delete book',
    onClick: () => setDeleteModalOpen(true),
    danger: true,
  });

  return (
    <Page>
      <div className={styles.topInset} aria-hidden="true" />
      <BackButton to={book.series.length > 0 ? path.series(book.series) : path.library()} />
      <PageActionsMenu items={actionItems} />
      <Card>
        <div className={styles.cardContainer}>
          <div className={styles.detail}>
            {book.hasCover ? (
              <img
                className={styles.coverImg}
                src={coverSrc}
                alt={book.title}
                width={160}
                height={240}
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
              {book.author.length > 0 && (
                <div
                  className={styles.author}
                  onClick={handleAuthorNavigate}
                  role="button"
                  tabIndex={0}
                  onKeyDown={(e) => {
                    if (e.key === 'Enter' || e.key === ' ') {
                      e.preventDefault();
                      handleAuthorNavigate();
                    }
                  }}
                >
                  {book.author}
                </div>
              )}
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
              <Tag key={subject + index} onClick={() => handleSubjectNavigate(subject)}>
                {subject}
              </Tag>
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
      <ConfirmModal
        icon={AlertOctagonIcon}
        isOpen={deleteModalOpen}
        onCancel={() => setDeleteModalOpen(false)}
        onConfirm={handleDeleteConfirm}
        danger
        title="Delete book permanently?"
        confirmText="Delete"
        loading={deleting}
      >
        This action will delete {book.title} and its file from this library, along with any synced
        progress, and can not be undone.
      </ConfirmModal>
    </Page>
  );
};
