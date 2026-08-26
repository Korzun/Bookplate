import { useQuery } from '@apollo/client/react';
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
import { usePrefetchOnIntent } from '~/lib/use-prefetch-on-intent';
import { useIsAdmin } from '~/provider/auth';
import {
  useBookValidation,
  useClearBookEditions,
  useDeleteBook,
  useDownloadBook,
  useRegenChapters,
  useValidateBook,
} from '~/provider/book';
import { useCurrentLibraryId } from '~/provider/library-target';
import { useToast } from '~/provider/toast';
import { path } from '~/router';
import { formatSize, hashString } from '~/utils';

import { buildBookActions } from './actions';
import { BookChaptersDocument, BookDetailDocument, BookLineageDocument } from './query';
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

  /**
   * The route composes its own reads (`./query.ts`) rather than going
   * through a provider hook — `useBookDetail` had exactly one caller, this
   * file, and the indirection bought nothing but a second place to keep the
   * `book` shape in sync.
   *
   * `node(id: $libraryId)` is the only single root that serves both a
   * non-admin's own library and an admin's selected one, so the query is
   * skipped outright until `useCurrentLibraryId` resolves, and `loading`
   * folds that bootstrap round trip in — a skipped `useQuery` reports
   * `loading: false` on its own, which would flash a false "Book not found."
   * for the whole `ViewerBootstrap` window.
   *
   * **`$bookId` is the ROUTE PARAM**, deliberately, for all three documents
   * below. A book's global id rotates: `applyEpubChanges` (accept / replace
   * / undo) and `bookRegenChapters` re-import the file and mint a new one.
   * Every such path navigates to the new id (`onReplaced(newId)` below), so
   * keying on the param means the variables move WITH the book instead of
   * going stale — a lazy query left on a stale `bookId` would silently
   * fetch a different book's chapters, with no error to notice.
   */
  const { libraryId, loading: libraryIdLoading } = useCurrentLibraryId();
  const variables = { libraryId: libraryId ?? '', bookId: id ?? '' };
  const {
    data,
    loading: bookLoading,
    error: bookError,
  } = useQuery(BookDetailDocument, { variables, skip: libraryId === undefined });
  const detailNode = data?.node;
  const book = detailNode?.__typename === 'Library' ? (detailNode.book ?? undefined) : undefined;
  const loading = bookLoading || libraryIdLoading;
  const error = bookError?.message;

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

  /**
   * The two LAZY splits. Each is gated on the SAME boolean that mounts its
   * modal below, so nothing is fetched for a modal a visitor never opens —
   * which is the entire point of the split (`./query.ts` for the per-field
   * disposition and the cache-identity contract).
   *
   * Composed HERE rather than inside the modals themselves: those are
   * `~/control` components, the shared layer, and a book-scoped query in
   * there would both invert the dependency direction and hand two
   * presentational modals a `useCurrentLibraryId` dependency. The route
   * already owns when they mount, so it can own the gate too — spec 3.1's
   * normal "the route composes the query" rule. (`MyProgressContent` is the
   * documented exception, and only because `Card` mounts it outside its
   * route's control.)
   *
   * `skip` is belt-and-braces with the `{open && …}` render gates: a
   * skipped hook cannot fetch even if a later refactor stops unmounting the
   * modal, and it is what the "does not fetch until the modal opens" tests
   * pin.
   *
   * **Both `error`s are forwarded, not discarded.** Before the split, a
   * failure to read `lineage` was a failed PAGE load ("Failed to load
   * book."). Split out and defaulted (`?? []`), the same failure would
   * instead render `BookLineageModal`'s EMPTY-lineage presentation — the
   * page asserting "this book has no edit history" when the truth is "we
   * could not find out". Empty is a meaningful answer there, so the two
   * must look different; each modal owns that distinction through its own
   * `error`/`chaptersError` prop.
   */
  const { data: chaptersData, error: chaptersError } = useQuery(BookChaptersDocument, {
    variables,
    skip: !progressModalOpen || libraryId === undefined,
  });
  const chaptersNode = chaptersData?.node;
  const chapters = chaptersNode?.__typename === 'Library' ? chaptersNode.book : null;

  const { data: lineageData, error: lineageError } = useQuery(BookLineageDocument, {
    variables,
    skip: !lineageModalOpen || libraryId === undefined,
  });
  const lineageNode = lineageData?.node;
  const lineageBook = lineageNode?.__typename === 'Library' ? lineageNode.book : null;

  /**
   * The other half of the split: fire each lazy query on hover/focus/touch
   * of its own action, ahead of the click that opens the modal. Apollo
   * dedupes the identical in-flight query, so the `useQuery` above usually
   * finds the data already arriving or cached by the time it mounts.
   *
   * `variables` is a fresh object literal per render, so `intentProps`'
   * identity churns every render — correctness is unaffected (the
   * freshness guard lives in a ref, keyed on the variables' VALUE), but do
   * not hang a `React.memo` off its identity.
   */
  const chaptersIntent = usePrefetchOnIntent(BookChaptersDocument, variables, {
    skip: libraryId === undefined,
  });
  const lineageIntent = usePrefetchOnIntent(BookLineageDocument, variables, {
    skip: libraryId === undefined,
  });

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
      value: (
        <ProgressIndicator
          value={book?.progress ? book.progress.percentage : 0}
          ariaLabel={book ? `Reading progress for ${book.title}` : 'Reading progress'}
          size={12}
        />
      ),
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
      onSetProgressIntent: chaptersIntent.intentProps,
      onEditMetadata: handleEditMetadata,
      onShowLineage: () => setLineageModalOpen(true),
      onShowLineageIntent: lineageIntent.intentProps,
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
          documentId={book.documentId}
          progressId={book.progress?.id}
          chapterCount={book.chapterCount}
          initialChapter={book.progress?.currentChapter ?? 0}
          // From `BookChaptersDocument`, not the eager read — both default
          // harmlessly (`[]`) for the beat before the lazy query lands,
          // which the hover prefetch usually removes entirely.
          chapterSpineMap={chapters?.chapterSpineMap}
          chapterNames={chapters?.chapterNames ?? []}
          chaptersError={chaptersError?.message}
          onClose={() => setProgressModalOpen(false)}
        />
      )}
      {lineageModalOpen && (
        <BookLineageModal
          isOpen
          bookId={book.id}
          documentId={book.documentId}
          bookTitle={book.title}
          // Both from `BookLineageDocument` — `addedAt` travels with
          // `lineage` because it is only ever read as that list's
          // oldest-row fallback timestamp.
          lineage={lineageBook?.lineage ?? []}
          addedAt={lineageBook?.addedAt ? new Date(lineageBook.addedAt).getTime() : undefined}
          error={lineageError?.message}
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
            // `newId` is `UploadReplaceModal`'s `onReplaced` — the Relay
            // GLOBAL id for the post-replace book (2026-08-13 final review,
            // C-2 — human ruling, Option 1, fixed). `commitReplacement`'s
            // response is `ReplacedBook = { id: string }`; the raw content
            // hash it used to also carry was dropped in Task 10. This page's
            // own `Library.book` read requires a global id, and now gets one.
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
          // I-2 (2026-08-13 final review): the modal's DEFAULT `intro` is
          // upload-flow copy ("...must be fixed before this EPUB can be
          // uploaded") — wrong for a book already in the library. This is
          // the same book-specific copy the pre-GraphQL REST page passed,
          // dropped as collateral during the rewrite to GraphQL.
          intro="EPUBCheck results for this book. Issues below the rejection threshold don't block anything, but you may want to fix them."
          onClose={() => setValidationModalOpen(false)}
        />
      )}
    </Page>
  );
};
