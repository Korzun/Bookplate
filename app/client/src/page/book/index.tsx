import { useCallback, useMemo, useState } from 'react';
import { useNavigate, useParams } from 'react-router';

import { Card, Page, ProgressIndicator, Tag, MetadataList, type Metadata } from '~/component';
import {
  BookLineageModal,
  ConfirmModal,
  SetProgressModal,
  UploadReplaceModal,
  ValidationDetailModal,
  type PageActionItem,
} from '~/control';
import { useFragment } from '~/gql';
import type { ValidationFragmentFragment } from '~/gql/graphql';
import { ValidationFragment } from '~/graphql/book';
import { AlertOctagonIcon, DeviceIcon } from '~/icon';
import type { Severity, ValidationMessage } from '~/lib/severity';
import { useAuthorizedSrc } from '~/lib/use-authorized-src';
import { useIsAdmin } from '~/provider/auth';
import {
  useBookDetail,
  useBookValidation,
  useClearBookEditions,
  useDeleteBook,
  useDownloadBook,
  useRegenChapters,
  useValidateBook,
} from '~/provider/book';
import { useToast } from '~/provider/toast';
import { path } from '~/router';
import { formatSize, hashString } from '~/utils';

import { buildBookActions } from './actions';
import { useStyle } from './style';

/**
 * `counts` on `ValidationFragment` is a LIST (`{ severity count }[]`) — the
 * server shape, one entry per severity that actually occurred. The modal
 * (`ValidationDetailModal`, still shared with `page/upload` and the replace
 * flow, both on the REST-shaped record until a later step) takes
 * `Record<Severity, number>`. `SeverityCounts`' own `orderSeverityCounts`
 * reads `counts[severity] ?? 0`, so a partial record — every severity NOT in
 * the list is simply absent here — is safe to hand it; the cast matches the
 * same `Object.fromEntries(...) as Record<Severity, number>` idiom the
 * server's own `validation-store.ts` uses for the identical shape.
 */
function toValidationCounts(
  counts: ValidationFragmentFragment['counts']
): Record<Severity, number> {
  return Object.fromEntries(counts.map((c) => [c.severity, c.count])) as Record<Severity, number>;
}

/**
 * `ValidationMessage.id` is `node.code` (e.g. `"PKG-003"`), not `node.seq` —
 * matching REST's own `validation-store.ts` (`id: m.code`) byte-for-byte, so
 * a message keeps the same rendered id it always had. `location` collapses
 * the fragment's flat `path`/`line`/`column` into the modal's nested shape,
 * `undefined` when `path` is null (REST's own `m.path != null` check).
 *
 * `segments` (task 12b): the schema now exposes `ValidationMessage.segments`
 * (`message-segment/model.ts`), resolved server-side through the SAME
 * `splitSubjects` helper REST used, so this is a straight pass-through, not
 * a client-side reconstruction. This closes the narrowing the doc comment
 * here used to describe — quoted subjects render monospaced again, and the
 * modal's `m.segments ?? [{ text: m.message }]` fallback is no longer the
 * live path for THIS caller (`page/upload` and the replace flow still build
 * `ValidationMessage`s without `segments`, by design — see the modal's own
 * prop type; that fallback still matters for them).
 */
function toValidationMessages(
  edges: ValidationFragmentFragment['messages']['edges']
): ValidationMessage[] {
  return edges.map(({ node }) => ({
    id: node.code,
    severity: node.severity,
    message: node.message,
    segments: node.segments.map((s) => ({ text: s.text, subject: s.subject })),
    location:
      node.path != null
        ? { path: node.path, line: node.line ?? undefined, column: node.column ?? undefined }
        : undefined,
  }));
}

export const BookPage = () => {
  const styles = useStyle();

  const { id } = useParams<{ id: string }>();
  const navigate = useNavigate();
  const [isAdmin] = useIsAdmin();

  const { book, loading, error, refetch } = useBookDetail(id!);
  const { validation: lazyValidation, load: loadValidation } = useBookValidation(book?.id ?? '');
  // `useFragment` is an identity cast (Global Constraints — masking is
  // compile-time only here), but called unconditionally before either early
  // return below anyway, the same discipline `page/series` follows for its
  // own `useFragment` call.
  const unmaskedValidation = useFragment(ValidationFragment, lazyValidation);

  const [progressModalOpen, setProgressModalOpen] = useState(false);
  const [lineageModalOpen, setLineageModalOpen] = useState(false);
  const [replaceModalOpen, setReplaceModalOpen] = useState(false);
  const [validationModalOpen, setValidationModalOpen] = useState(false);

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
    await deleteBook(book?.id ?? '');
    navigate(path.home());
  }, [deleteBook, book, navigate]);

  const handleClearEditionsConfirm = useCallback(async () => {
    setClearEditionsModalOpen(false);
    const cleared = await clearBookEditions(book?.id ?? '');
    if (cleared === undefined) {
      showToast('Failed to clear device editions', 'error');
      return;
    }
    showToast(`Cleared ${cleared} device edition${cleared === 1 ? '' : 's'}`, 'success');
  }, [clearBookEditions, book, showToast]);

  const handleDownload = useCallback(async () => {
    const ok = await downloadBook(book?.id ?? '');
    if (!ok) showToast('Download failed', 'error');
  }, [downloadBook, book, showToast]);

  /**
   * Closes the debt Task 9 left open: `validateBook`'s resolved (masked)
   * `ValidationFragment` ref is no longer just toasted as a blanket
   * "Validation complete" regardless of outcome — a book that FAILS
   * validation now looks nothing like one that passes, because this opens
   * `ValidationDetailModal` for BOTH, and the modal itself renders the real
   * pass/fail difference (an empty "No validation issues found" state vs a
   * real message list).
   *
   * `loadValidation()` — NOT reading `result` directly — is the single path
   * that populates `ValidationDetailModal`'s data, the same lazy
   * `useBookValidation` read a future "open validation report" entry point
   * (not wired yet — there is only this one trigger today) would also use.
   * `Validation.id` is byte-identical to the owning Book's global id
   * (`graphql/book.ts`), so `bookValidate`'s payload has already normalized
   * onto the exact `Validation` entity `BookValidationDocument` reads —
   * `loadValidation()` here is a CACHE HIT with no network round trip, only
   * a fresh reactive read of what the mutation just wrote. Asserted directly
   * in this file's test ("opens the validation modal ... with no
   * BookValidationDocument mock in the list").
   */
  const handleValidate = useCallback(async () => {
    const result = await validateBook(book?.id ?? '');
    if (!result) {
      showToast('Validation failed', 'error');
      return;
    }
    loadValidation();
    setValidationModalOpen(true);
  }, [validateBook, book, showToast, loadValidation]);

  const handleEditMetadata = useCallback(
    () => navigate(path.bookEdit(book?.id ?? '')),
    [book, navigate]
  );

  const handleSeriesNavigate = useCallback(() => {
    if (book?.series) {
      navigate(path.series(book.series.name));
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
      value: <ProgressIndicator value={book?.progress ? book.progress.percentage : 0} size={12} />,
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

  const coverSrc = useAuthorizedSrc(book?.hasCover ? book.coverUrl : null);

  if (loading) {
    return (
      <Page>
        <Card>
          <p className={styles.loading}>Loading…</p>
        </Card>
      </Page>
    );
  }

  // Checked BEFORE the not-found branch below — see `page/series`' own doc
  // comment on the same ordering: a transport failure also leaves `book`
  // `undefined`, and OR-ing it into "Book not found." would misreport a
  // network failure as the book genuinely not existing.
  if (error !== undefined) {
    return (
      <Page>
        <Card>
          <p className={styles.notFound}>Failed to load book.</p>
        </Card>
      </Page>
    );
  }

  if (book === undefined) {
    return (
      <Page>
        <Card>
          <p className={styles.notFound}>Book not found.</p>
        </Card>
      </Page>
    );
  }

  const actions: PageActionItem[] = buildBookActions(
    {
      chapterCount: book.chapterCount,
      deviceEditionCount: book.deviceEditionCount,
      regenLoading,
      validating,
      editingBlocked: book.validation?.valid !== true,
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
      back={book.series !== null ? path.series(book.series.name) : path.library()}
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
                {book.series !== null && (
                  <span className={styles.series} onClick={handleSeriesNavigate}>
                    ({book.series.name}
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
          initialChapter={book.progress?.currentChapter ?? 0}
          chapterSpineMap={book.chapterSpineMap}
          chapterNames={book.chapterNames ?? []}
          onClose={() => setProgressModalOpen(false)}
          onSaved={refetch}
        />
      )}
      {lineageModalOpen && (
        <BookLineageModal
          isOpen
          bookId={book.id}
          documentId={book.documentId}
          bookTitle={book.title}
          lineage={book.lineage}
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
      {validationModalOpen && unmaskedValidation && (
        <ValidationDetailModal
          isOpen
          filename={book.title}
          counts={toValidationCounts(unmaskedValidation.counts)}
          messages={toValidationMessages(unmaskedValidation.messages.edges)}
          threshold={unmaskedValidation.threshold}
          onClose={() => setValidationModalOpen(false)}
        />
      )}
    </Page>
  );
};
