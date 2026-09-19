import { useApolloClient, useMutation } from '@apollo/client/react';
import cx from 'classnames';
import { Fragment, useCallback, useEffect, useMemo, useState } from 'react';

import { BookRequestRow } from '~/component/book-request-row';
import { Button, ConfirmModal, TextArea, TextInput, type PageActionItem } from '~/control';
import { useFragment } from '~/gql';
import type { BookRequestCreateMutation } from '~/gql/graphql';
import {
  BookRequestCreateDocument,
  BookRequestDeleteDocument,
  BookRequestRowFragment,
  MyBookRequestListDocument,
} from '~/graphql/book-request';
import { usePaginatedConnection } from '~/lib/use-paginated-connection';
import { unwrapResult } from '~/provider/apollo';

import { useStyle } from './style';

// `unwrapResult`'s `TPayload` sits in a position TypeScript cannot infer from
// the call, so it is named explicitly here, extracted from the generated
// union rather than hand-duplicated.
type BookRequestCreatePayload = Extract<
  BookRequestCreateMutation['bookRequestCreate'],
  { __typename: 'BookRequestCreatePayload' }
>;

interface BookRequestsContentProps {
  /**
   * This component's own PARENT (`AddRequestView`, `page/add/request`) always
   * passes `false` at its one production call site — this view is not even
   * mounted until the reader switches to it, which is the lazy-mount gate a
   * now-deleted `/user` card's collapsible `Card` used to provide. `skip`
   * stays a required, EXPLICIT prop regardless — rather than defaulting to
   * `false` internally — so this component's own tests can gate the query
   * directly instead of depending on a parent's mount timing as an implicit
   * contract. Mirrors `MyProgressContent`'s identical prop for the identical
   * reason.
   */
  skip: boolean;
  /**
   * Publishes this component's page-header actions — "Clear resolved" — for
   * the view above to hand to `<Page>` (`page/add/request.tsx` passes
   * `AddOutletContext`'s `setHeaderActions` straight through).
   *
   * Here rather than on that view for the same reason `UserRequestList`'s
   * identical prop gives: the rows it acts on and the mutation it runs are
   * both this component's. Publishes `undefined` on unmount, which is
   * `AddOutletContext`'s standing contract.
   */
  onHeaderActions?: (actions: PageActionItem[] | undefined) => void;
}

/**
 * The reader's own book requests: a create form above the reader's own list,
 * modelled on `MyProgressContent` — read that component's own doc comment
 * first, this is its closest sibling.
 *
 * **The form validates title/author client-side** (non-empty after
 * trimming) — the same rule the server's zod schema in
 * `bookRequestCreate`'s resolver applies — so an obviously-invalid request
 * never spends a round trip. `note` is sent trimmed but is allowed to be
 * empty; the server defaults it to `''` when omitted, matching this
 * component's own empty-string default.
 *
 * **On success, the form clears and this component imperatively refetches
 * `MyBookRequestListDocument`** via `client.refetchQueries({ include: [...] })`.
 * Plain normalization is NOT enough on its own: `BookRequestCreateDocument`
 * re-selects the full `BookRequestRowFragment` on the returned
 * `bookRequest`, which would keep an ALREADY-cached `BookRequest:<id>`
 * entity in sync, but a brand-new request has no existing connection edge
 * for normalization to attach to — Apollo cannot insert a new edge into an
 * already-cached `relayStylePagination` connection on its own. No
 * hand-rolled `cache.modify` insert either: the connection's cursor order
 * (newest `createdAt`, `id asc` tiebreaker) is not reproducible
 * client-side, so reproducing it optimistically risks a wrongly-ordered or
 * duplicated row for no real gain — creating a request is a rare,
 * interactive action over a small list, so a full refetch is cheap and
 * simply correct. (Task 6 of the add-page reorg dropped
 * `MyBookRequestCountDocument` from this refetch — the reader's collapsed
 * `/user` card whose subtitle it fed no longer exists, and no other query
 * this component touches needs it.)
 *
 * **`onDelete` (passed to `BookRequestRow`) runs `BookRequestDeleteDocument`,
 * evicts the returned `deletedId` from the cache, and — on a genuine
 * deletion — refetches the same document.** `bookRequestDelete` is NOT
 * a union (no failure a client renders differently — `null` covers both
 * "gone" and "not yours") so there is no `unwrapResult` call here, just a
 * null check. `cache.evict` on a `relayStylePagination`-held connection (see
 * `provider/apollo/cache.ts`'s `User.bookRequests` typePolicy, added
 * alongside this component) already makes `InMemoryCache` silently drop the
 * now-dangling edge the next time the connection is read — the same
 * mechanism `useDeleteProgress` documents for `Library.progress` — so the
 * list refetch here is belt-and-suspenders. A REJECTED `runDelete` (e.g. a
 * dropped connection) is caught into `deleteError` state and rendered above
 * the list, the same house pattern `handleSubmit` above uses for
 * `formError`.
 *
 * **Loading, first-page error, and empty states follow `MyProgressContent`'s
 * three-branch shape exactly** — but only for the LIST region below the
 * form: the form itself is not gated on any of those three states, so a
 * reader can compose a new request even while the list is loading, failed,
 * or empty.
 */
export const BookRequestsContent = ({ skip, onHeaderActions }: BookRequestsContentProps) => {
  const styles = useStyle();
  const client = useApolloClient();
  const [runCreate, { loading: creating }] = useMutation(BookRequestCreateDocument);
  const [runDelete] = useMutation(BookRequestDeleteDocument);

  const [title, setTitle] = useState<string>('');
  const [author, setAuthor] = useState<string>('');
  const [note, setNote] = useState<string>('');
  const [formError, setFormError] = useState<string | undefined>(undefined);
  const [deleteError, setDeleteError] = useState<string | undefined>(undefined);
  const [isClearOpen, setClearOpen] = useState(false);
  const [clearing, setClearing] = useState(false);

  const { edges, loading, loadingMore, error, hasNextPage, loadMore } = usePaginatedConnection({
    document: MyBookRequestListDocument,
    variables: {},
    skip,
    select: (data) => data?.viewer.user?.bookRequests,
    resetKey: String(skip),
    loadMoreErrorMessage: 'Failed to load more requests',
  });
  const rows = edges.map((edge) => edge.node);
  // ONE unconditional `useFragment` call over the whole array, in this
  // component's own body — the shape `nav/index.tsx` and `useWithTargetUser`
  // already use for `UserRowFragment`, and not the thing `page/library`'s note
  // warns about: these rows are all `BookRequest`, so there is no
  // heterogeneous iteration and no conditional hook. It is read for ONE fact,
  // `status`, which the rows themselves need anyway. Selecting `status` a
  // second time as a sibling of the spread would have put a scalar inside a
  // 20-wide connection for the cost model to price, to learn what the document
  // already fetches.
  const unmasked = useFragment(BookRequestRowFragment, rows);
  // RESOLVED, never pending: fulfilled or declined is answered, and clearing
  // it drops history. A pending request is somebody's outstanding ask, and the
  // reader has a per-row Withdraw for those.
  const resolvedIds = rows
    .filter((_, index) => unmasked[index].status !== 'PENDING')
    .map((row) => row.id);

  const handleTitleChange = useCallback(
    (newValue: string | undefined) => setTitle(newValue ?? ''),
    []
  );
  const handleAuthorChange = useCallback(
    (newValue: string | undefined) => setAuthor(newValue ?? ''),
    []
  );
  const handleNoteChange = useCallback(
    (newValue: string | undefined) => setNote(newValue ?? ''),
    []
  );

  const handleSubmit = useCallback(
    async (event: React.FormEvent) => {
      event.preventDefault();
      setFormError(undefined);

      const trimmedTitle = title.trim();
      const trimmedAuthor = author.trim();
      const missing: string[] = [];
      if (trimmedTitle === '') missing.push('Title');
      if (trimmedAuthor === '') missing.push('Author');
      if (missing.length > 0) {
        setFormError(`${missing.join(' and ')} ${missing.length > 1 ? 'are' : 'is'} required`);
        return;
      }

      try {
        const { data } = await runCreate({
          variables: { input: { title: trimmedTitle, author: trimmedAuthor, note: note.trim() } },
        });

        const result = unwrapResult<BookRequestCreatePayload>(
          data?.bookRequestCreate,
          'BookRequestCreatePayload'
        );
        if (result.status === 'missing') {
          setFormError('Failed to submit request');
          return;
        }
        if (result.status === 'error') {
          setFormError(result.message);
          return;
        }

        setTitle('');
        setAuthor('');
        setNote('');
        await client.refetchQueries({
          include: [MyBookRequestListDocument],
        });
      } catch (err) {
        setFormError(err instanceof Error ? err.message : 'Failed to submit request');
      }
    },
    [title, author, note, runCreate, client]
  );

  // The mutation and its cache eviction, once, for both the per-row Clear/
  // Withdraw and the "Clear resolved" batch below — the eviction is the part
  // that must not drift between them (see this component's doc comment for
  // what it does to the held connection). Returns the id the server says it
  // deleted, or `undefined` for the "gone, or never yours" null.
  const deleteRequest = useCallback(
    async (id: string) => {
      const { data } = await runDelete({
        variables: { id },
        update: (cache, { data: mutationData }) => {
          const deletedId = mutationData?.bookRequestDelete?.deletedId;
          if (!deletedId) return;
          cache.evict({ id: cache.identify({ __typename: 'BookRequest', id: deletedId }) });
          cache.gc();
        },
      });
      return data?.bookRequestDelete?.deletedId ?? undefined;
    },
    [runDelete]
  );

  const handleDelete = useCallback(
    (id: string) => {
      setDeleteError(undefined);
      void (async () => {
        try {
          if (await deleteRequest(id)) {
            await client.refetchQueries({
              include: [MyBookRequestListDocument],
            });
          }
        } catch (err) {
          setDeleteError(err instanceof Error ? err.message : 'Failed to delete request');
        }
      })();
    },
    [deleteRequest, client]
  );

  const handleOpenClear = useCallback(() => {
    setDeleteError(undefined);
    setClearOpen(true);
  }, []);
  const handleCancelClear = useCallback(() => setClearOpen(false), []);

  const handleConfirmClear = useCallback(async () => {
    setClearing(true);
    setDeleteError(undefined);
    try {
      // SEQUENTIAL, stopping at the first failure, the same shape "Decline
      // all" uses: what is left simply stays in the list, which is a state the
      // reader can already read and retry from, rather than a half-applied
      // batch whose shape they have to work out.
      for (const id of resolvedIds) {
        await deleteRequest(id);
      }
      setClearOpen(false);
      await client.refetchQueries({ include: [MyBookRequestListDocument] });
    } catch (err) {
      setDeleteError(err instanceof Error ? err.message : 'Failed to clear requests');
    } finally {
      setClearing(false);
    }
    // `resolvedIds` is a fresh array every render; its VALUE is what this
    // depends on, so an unrelated re-render does not rebuild the callback and,
    // through the memo below, republish the actions.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [resolvedIds.join('\u0000'), deleteRequest, client]);

  // MEMOIZED for the reason `page/add/upload.tsx` spells out at its own copy
  // of this effect: a fresh array every render would republish every render.
  const headerActions = useMemo<PageActionItem[]>(
    () => [
      {
        label: 'Clear resolved',
        onClick: handleOpenClear,
        // Published disabled rather than withheld — an action that greys out
        // reads better than one that comes and goes, and the trigger staying
        // put is what keeps the toggle beside it still.
        disabled: resolvedIds.length === 0,
        // These rows go for good, exactly as the row's own Clear button (also
        // `danger`) sends one.
        danger: true,
      },
    ],
    [handleOpenClear, resolvedIds.length]
  );
  useEffect(() => {
    onHeaderActions?.(headerActions);
    return () => onHeaderActions?.(undefined);
  }, [headerActions, onHeaderActions]);

  let list: React.ReactNode;
  if (loading) {
    list = <div className={styles.message}>Loading...</div>;
  } else if (error && rows.length === 0) {
    list = <div className={cx(styles.message, styles.error)}>Error loading requests</div>;
  } else if (rows.length === 0) {
    list = <div className={styles.message}>No requests yet</div>;
  } else {
    list = (
      <Fragment>
        {rows.map((row) => (
          <BookRequestRow key={row.id} request={row} canResolve={false} onDelete={handleDelete} />
        ))}
        {hasNextPage && (
          <Button type="link" onClick={loadMore} loading={loadingMore}>
            Load more
          </Button>
        )}
        {error && rows.length > 0 && (
          <div className={cx(styles.message, styles.error)}>
            Failed to load more requests
            <Button type="link" onClick={loadMore}>
              Retry
            </Button>
          </div>
        )}
      </Fragment>
    );
  }

  return (
    <div className={styles.root}>
      <form className={styles.form} onSubmit={handleSubmit}>
        <TextInput name="title" label="Title" value={title} onChange={handleTitleChange} />
        <TextInput name="author" label="Author" value={author} onChange={handleAuthorChange} />
        <TextArea name="note" label="Note" value={note} onChange={handleNoteChange} />
        {formError && <div className={cx(styles.message, styles.error)}>{formError}</div>}
        <Button type="primary" radius="card" submit loading={creating}>
          Request
        </Button>
      </form>
      {deleteError && <div className={cx(styles.message, styles.error)}>{deleteError}</div>}
      {list}
      {/* The per-row Clear fires straight away; a whole page of them asks
          first. One request is a decision the reader can see the shape of —
          "clear all nine" is not, and none of it comes back. */}
      <ConfirmModal
        isOpen={isClearOpen}
        title={
          resolvedIds.length === 1
            ? 'Clear the resolved request'
            : `Clear ${resolvedIds.length} resolved requests`
        }
        confirmText="Clear resolved"
        danger
        loading={clearing}
        onCancel={handleCancelClear}
        onConfirm={() => void handleConfirmClear()}
      >
        <div className={styles.message}>Requests you are still waiting on are not affected.</div>
      </ConfirmModal>
    </div>
  );
};
