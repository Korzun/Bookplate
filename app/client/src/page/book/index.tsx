import { useCallback, useMemo, useState } from 'react';
import { useNavigate, useParams } from 'react-router';

import { Card, Page, ProgressIndicator, Tag, MetadataList, type Metadata } from '~/component';
import {
  BookLineageModal,
  ConfirmModal,
  SetProgressModal,
  UploadReplaceModal,
  type PageActionItem,
} from '~/control';
import { AlertOctagonIcon, DeviceIcon } from '~/icon';
import { coverUrl } from '~/lib/cover-url';
import { useAuthorizedSrc } from '~/lib/use-authorized-src';
import { useIsAdmin } from '~/provider/auth';
import {
  useBook,
  useClearBookEditions,
  useDeleteBook,
  useDownloadBook,
  useRegenChapters,
  useValidateBook,
} from '~/provider/book';
import { useWithTargetUser } from '~/provider/library-target';
import { useMyProgress } from '~/provider/progress';
import { useToast } from '~/provider/toast';
import { path } from '~/router';
import { formatSize, hashString } from '~/utils';

import { buildBookActions } from './actions';
import { useStyle } from './style';

export const BookPage = () => {
  const styles = useStyle();

  const { id } = useParams<{ id: string }>();
  const navigate = useNavigate();
  const [isAdmin] = useIsAdmin();
  const withTargetUser = useWithTargetUser();

  const [book, loading, error] = useBook(id!, true);
  // `book?.id`, NOT the raw `id` URL param: since the grid (task 8) started
  // navigating here with a Book's Relay global id, `id` can be that global
  // id, while `useMyProgressList`'s map is keyed by `p.document` — the
  // RAW local id (`use-fetch-my-progress-list.ts`) — the same raw id
  // `/api/books/:id` (task 13) always resolves to and returns as `book.id`,
  // regardless of which id form was requested. Indexing on `id!` directly
  // would silently miss for every global-id visit: 0% progress shown for a
  // book the viewer is actually partway through, and `SetProgressModal`
  // below would open at chapter 0 instead of their real chapter. `book?.id`
  // is `undefined` until `useBook` resolves, which `useMyProgress` treats
  // as "not loaded yet" rather than "no progress" — see its own doc comment.
  const [progress] = useMyProgress(book?.id);
  const [progressModalOpen, setProgressModalOpen] = useState(false);
  const [lineageModalOpen, setLineageModalOpen] = useState(false);
  const [replaceModalOpen, setReplaceModalOpen] = useState(false);

  const [regenChapters, regenLoading] = useRegenChapters();
  const [deleteBook, deleting] = useDeleteBook();
  const [deleteModalOpen, setDeleteModalOpen] = useState(false);
  const [clearBookEditions, clearingEditions] = useClearBookEditions();
  const [clearEditionsModalOpen, setClearEditionsModalOpen] = useState(false);
  const [downloadBook] = useDownloadBook();
  const [validateBook, validating] = useValidateBook();
  const showToast = useToast();

  const handleDeleteConfirm = useCallback(async () => {
    setDeleteModalOpen(false);
    await deleteBook(id!);
    navigate(path.home());
  }, [deleteBook, id, navigate]);

  const handleClearEditionsConfirm = useCallback(async () => {
    setClearEditionsModalOpen(false);
    const cleared = await clearBookEditions(id!);
    if (cleared === undefined) {
      showToast('Failed to clear device editions', 'error');
      return;
    }
    showToast(`Cleared ${cleared} device edition${cleared === 1 ? '' : 's'}`, 'success');
  }, [clearBookEditions, id, showToast]);

  const handleDownload = useCallback(async () => {
    const ok = await downloadBook(id!);
    if (!ok) showToast('Download failed', 'error');
  }, [downloadBook, id, showToast]);

  // `useValidateBook` (task 9) now resolves a MASKED `ValidationFragment`
  // ref, not a REST `ValidationReport` — it normalizes the fresh result
  // straight onto the cached `Book` entity (see that hook's own doc
  // comment), so this handler no longer needs the resolved value to show
  // anything itself. Opening a detail view after Validate is task 11's job
  // (wiring `ValidationDetailModal` to `useBookValidation`'s cache-hit
  // read, per the 2026-08-13 plan amendment) — until then this only
  // toasts pass/fail, a documented, deliberate, transient narrowing of the
  // action (same shape as task 6's per-row-progress shim: minimal, noted,
  // closed by the next task).
  const handleValidate = useCallback(async () => {
    const result = await validateBook(id!);
    if (!result) {
      showToast('Validation failed', 'error');
      return;
    }
    showToast('Validation complete', 'success');
  }, [validateBook, id, showToast]);

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

  const deviceEditionCount = book.deviceEditionCount ?? 0;
  const actions: PageActionItem[] = buildBookActions(
    {
      chapterCount: book.chapterCount,
      deviceEditionCount,
      regenLoading,
      validating,
      editingBlocked: book.valid !== true,
    },
    {
      onSetProgress: () => setProgressModalOpen(true),
      onEditMetadata: handleEditMetadata,
      onShowLineage: () => setLineageModalOpen(true),
      onRegenChapters: () => void regenChapters(book.id),
      onClearEditions: () => setClearEditionsModalOpen(true),
      onValidate: () => void handleValidate(),
      onUploadReplace: () => setReplaceModalOpen(true),
      onDownloadBook: () => void handleDownload(),
      onDeleteBook: () => setDeleteModalOpen(true),
    }
  );

  return (
    <Page
      back={book.series.length > 0 ? path.series(book.series) : path.library()}
      headerActions={actions}
    >
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
      {lineageModalOpen && (
        <BookLineageModal
          isOpen
          bookId={book.id}
          addedAt={book.addedAt ? new Date(book.addedAt).getTime() : undefined}
          onClose={() => setLineageModalOpen(false)}
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
        This action will delete <span className={styles.deleteBook}>{book.title}</span> and its file
        from this library, along with any synced progress, and{' '}
        <span className={styles.deleteUndone}>can not be undone</span>.
      </ConfirmModal>
      <ConfirmModal
        icon={DeviceIcon}
        isOpen={clearEditionsModalOpen}
        onCancel={() => setClearEditionsModalOpen(false)}
        onConfirm={handleClearEditionsConfirm}
        title="Clear device editions?"
        confirmText="Clear editions"
        loading={clearingEditions}
      >
        All cached device editions for this book will be removed. They&apos;ll be regenerated the
        next time each device downloads it.
      </ConfirmModal>
      {replaceModalOpen && (
        <UploadReplaceModal
          isOpen
          bookId={book.id}
          bookTitle={book.title}
          onClose={() => setReplaceModalOpen(false)}
          onReplaced={(newId) => {
            setReplaceModalOpen(false);
            navigate(path.book(newId));
          }}
        />
      )}
    </Page>
  );
};
