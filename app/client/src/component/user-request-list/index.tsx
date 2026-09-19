import { useApolloClient, useMutation } from '@apollo/client/react';
import cx from 'classnames';
import { Fragment, useCallback, useEffect, useMemo, useState } from 'react';

import { BookRequestRow } from '~/component/book-request-row';
import { Button, ConfirmModal, type PageActionItem } from '~/control';
import type { BookRequestDeclineMutation } from '~/gql/graphql';
import { BookRequestDeclineDocument, UserRequestListDocument } from '~/graphql/book-request';
import { UserListDocument } from '~/graphql/user';
import { usePaginatedConnection } from '~/lib/use-paginated-connection';
import { unwrapResult } from '~/provider/apollo';

import { useStyle } from './style';

interface UserRequestListProps {
  /**
   * The target user's Relay global id — `AddRequestView`'s own admin branch
   * resolves it via `useWithTargetUser().userId`, which matches the
   * (persistent, page-level) library switcher's selection against
   * `UserListDocument`.
   */
  userId: string;
  /**
   * This component's own PARENT (`AddRequestView`, `page/add/request.tsx`)
   * always passes `false` at its one production call site — this view is not
   * even mounted until an admin reaches `/add/request` with a library
   * selected, which is the lazy-mount gate a now-deleted `/users` card's
   * collapsible `Card` used to provide. There is no `Card`/collapse gate here
   * at all any more: the route itself is the gate. `skip` stays a required,
   * EXPLICIT prop regardless — rather than defaulting to `false` internally —
   * so this component's own tests can gate the query directly instead of
   * depending on a parent's mount timing as an implicit contract. Mirrors
   * `BookRequestsContent`'s identical prop for the identical reason.
   */
  skip: boolean;
  /**
   * Publishes this list's page-header actions — "Decline all" — for the view
   * above to hand to `<Page>` (`page/add/request.tsx` passes
   * `AddOutletContext`'s `setHeaderActions` straight through).
   *
   * The action lives HERE rather than on that view because both halves of it
   * are this component's: the rows it acts on, and the mutation it runs. The
   * view has neither, and threading them upward to build the action there
   * would mean exporting this list's state rather than its intent.
   *
   * Publishes `undefined` on unmount, which is `AddOutletContext`'s standing
   * contract — a view that leaves its actions published leaves them on the
   * other view's header.
   */
  onHeaderActions?: (actions: PageActionItem[] | undefined) => void;
}

/**
 * An admin's view of ANOTHER user's book requests, mounted by the admin
 * branch of `AddRequestView` (`page/add/request.tsx`) — structurally a copy
 * of `UserRowContent`'s progress-list half (read that component's own doc
 * comment first): `usePaginatedConnection` over `Query.user(id: $userId) {
 * bookRequests }`, not `viewer.user.bookRequests` — the target is a
 * different user's requests, and `AddRequestView` resolves their `userId` via
 * `useWithTargetUser()`, which matches the (persistent, page-level) library
 * switcher's selected Library global id against `UserListDocument`.
 * `Query.user(id:)` is admin-only, which is correct here: this list renders
 * only for admins.
 *
 * **A SEPARATE document from `UserProgressListDocument`** (`component/
 * user-row-content`) because the two lists page independently — a `Load
 * more` on one must not affect the other's cursor. Declared HERE, not on
 * `page/user-list`, for the SAME reason `UserProgressListDocument` is: this
 * component has NO `Card` collapse gate — that gate belonged to the deleted
 * `/users` card mount. The gate now is the Upload/Request TOGGLE itself:
 * `AddRequestView` is not even mounted until an admin switches to `/add/
 * request`, so this component, and the query it owns, is never even MOUNTED
 * until then. Hoisting it to `page/user-list` (a per-VIEWER route) would
 * fetch it for EVERY user on EVERY visit, under `Viewer.users`'s ×50 cost
 * multiplier — a severe cost regression, not just an architectural one.
 *
 * `first: 20` on `UserRequestListDocument` is a LITERAL, not a variable, for
 * the same pricing reason `MyBookRequestListDocument` gives (`graphql/
 * book-request.ts`): the cost model prices a variable page size at the
 * field's `maxSize`, not the value passed.
 *
 * Rows are `BookRequestRow` with `canResolve` and a `target` — the
 * requesting reader's Library global id and username, off this SAME query's
 * `user.library.id`/`user.username` (`UserRequestListDocument`, Task 14) —
 * `undefined` until the first page resolves. `BookRequestRow`'s own upload
 * control captures BOTH halves on the queue item at add time
 * (`addFiles(files, { target, fulfillsRequestId })`), so the bytes land in
 * THIS reader's library and the queue can close THIS request, whatever the
 * admin's global library switcher currently points at — the same "root at
 * the TARGET user, not the admin's own selection" shape `UserRowContent`
 * already follows for `LinkProgressModal`'s `libraryId`. `onDelete` runs
 * `BookRequestDeleteDocument`, evicts the returned `deletedId` from the
 * cache (which already drops the now-dangling edge from this list's own
 * `relayStylePagination`-held connection — `provider/apollo/cache.ts`'s
 * `User.bookRequests` typePolicy, same mechanism `BookRequestsContent`
 * documents), and refetches `UserListDocument` (`~/graphql/user`) — the
 * query `page/user-list` mounts, which carries `UserRowFragment`'s
 * `pendingBookRequestCount` badge. That count is a server-computed
 * `t.relationCount` with no client-visible increment/decrement, so without
 * this refetch a cleared/withdrawn request would leave the badge stale.
 * `refetchQueries({ include: [...] })` only refetches ACTIVE queries, so
 * this is harmless even if, say, `page/user-list` is not currently mounted.
 *
 * **Error-surfacing policy** — identical split to `UserRowContent` and
 * `BookRequestsContent`, both implemented by `usePaginatedConnection`: a
 * first-page failure is `useQuery`'s own `error`, with `rows` empty (the
 * empty-error state). A `fetchMore` failure is caught locally and surfaced
 * through the same `error` field, with `rows` left untouched (existing rows
 * survive, offer a retry). `handleDelete`'s own failure (a rejected
 * `runDelete`, e.g. a dropped connection) is a THIRD, separate case: caught
 * locally into `deleteError` state and rendered above the rows, mirroring
 * `BookRequestsContent`'s `handleSubmit` pattern for the identical mutation.
 */
// `unwrapResult`'s `TPayload` sits in a position TypeScript cannot infer from
// the call, so it is named explicitly — same shape as `book-request-row`'s own
// copy of this note, for the same mutation.
type BookRequestDeclinePayload = Extract<
  NonNullable<BookRequestDeclineMutation['bookRequestDecline']>,
  { __typename: 'BookRequestDeclinePayload' }
>;

export const UserRequestList = ({ userId, skip, onHeaderActions }: UserRequestListProps) => {
  const styles = useStyle();

  const { data, edges, loading, error, hasNextPage, loadMore, loadingMore } =
    usePaginatedConnection({
      document: UserRequestListDocument,
      variables: { userId },
      skip,
      select: (d) => d?.user?.bookRequests,
      resetKey: `${userId}:${skip}`,
      loadMoreErrorMessage: 'Failed to load more requests',
    });
  const rows = edges.map((edge) => edge.node);
  // `id` is a SIBLING of the fragment spread in `UserRequestListDocument`, not
  // part of the masked fragment, so it reads without unmasking — the same
  // reason the row `key` below can use it.
  const ids = rows.map((row) => row.id);
  const libraryId = data?.user?.library?.id;
  const username = data?.user?.username;
  const target =
    libraryId !== undefined && username !== undefined ? { libraryId, username } : undefined;

  const client = useApolloClient();
  const [runDecline] = useMutation(BookRequestDeclineDocument);
  const [isDeclineAllOpen, setDeclineAllOpen] = useState(false);
  const [declineAllReason, setDeclineAllReason] = useState('');
  const [decliningAll, setDecliningAll] = useState(false);
  const [declineAllError, setDeclineAllError] = useState<string | undefined>();

  const handleOpenDeclineAll = useCallback(() => {
    setDeclineAllReason('');
    setDeclineAllError(undefined);
    setDeclineAllOpen(true);
  }, []);
  const handleCancelDeclineAll = useCallback(() => setDeclineAllOpen(false), []);

  const handleConfirmDeclineAll = useCallback(async () => {
    setDecliningAll(true);
    setDeclineAllError(undefined);
    try {
      const trimmed = declineAllReason.trim();
      // SEQUENTIAL, and it stops at the first failure. There are at most ten
      // of these (the server's open-request cap), so the serial cost is not
      // the point — a half-applied batch is. Stopping leaves the rest PENDING,
      // which is the state the list already shows and the admin can retry from;
      // carrying on past an error would leave them guessing which ones took.
      for (const id of ids) {
        const { data: declineData } = await runDecline({
          variables: { id, reason: trimmed === '' ? undefined : trimmed },
        });
        const outcome = unwrapResult<BookRequestDeclinePayload>(
          declineData?.bookRequestDecline,
          'BookRequestDeclinePayload'
        );
        if (outcome.status === 'missing') {
          setDeclineAllError('Failed to decline requests');
          return;
        }
        if (outcome.status === 'error') {
          setDeclineAllError(outcome.message);
          return;
        }
      }
      setDeclineAllOpen(false);
      // The same stale-badge refetch every other resolve path runs, and for
      // the same reason: `pendingBookRequestCount` is a server-computed
      // `t.relationCount` with no client-visible decrement, so the "N pending"
      // badge would otherwise survive the one action that empties the queue.
      await client.refetchQueries({ include: [UserListDocument] });
    } catch (err) {
      setDeclineAllError(err instanceof Error ? err.message : 'Failed to decline requests');
    } finally {
      setDecliningAll(false);
    }
    // `ids` is a fresh array every render; `ids.join()` is the VALUE the batch
    // actually depends on, so a re-render that changes nothing does not rebuild
    // this callback (and, through the memo below, republish the actions).
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [ids.join('\u0000'), declineAllReason, runDecline, client]);

  // MEMOIZED for the reason `page/add/upload.tsx` spells out at its own copy of
  // this effect: a fresh array every render would republish on every render and
  // loop forever.
  const headerActions = useMemo<PageActionItem[]>(
    () => [
      {
        label: 'Decline all',
        onClick: handleOpenDeclineAll,
        // Published disabled rather than withheld: the header row is held open
        // either way (`component/page`), and an action that greys out reads
        // better than one that comes and goes.
        disabled: ids.length === 0,
        danger: true,
      },
    ],
    [handleOpenDeclineAll, ids.length]
  );
  useEffect(() => {
    onHeaderActions?.(headerActions);
    return () => onHeaderActions?.(undefined);
  }, [headerActions, onHeaderActions]);

  // Rendered alongside every branch below, including the empty and error ones:
  // it is `<dialog>`-backed and closed until asked for, and keeping it outside
  // the row branch means an in-flight batch cannot be unmounted mid-way by the
  // list re-rendering into another state.
  const declineAllModal = (
    <ConfirmModal
      isOpen={isDeclineAllOpen}
      title={ids.length === 1 ? 'Decline the request' : `Decline all ${ids.length} requests`}
      confirmText="Decline all"
      // Turning every request down at once is the most destructive thing this
      // page offers; `ConfirmModal` forwards this to its confirm button.
      danger
      loading={decliningAll}
      onCancel={handleCancelDeclineAll}
      onConfirm={() => void handleConfirmDeclineAll()}
    >
      <label className={styles.reasonLabel}>
        Reason (optional)
        <textarea
          className={styles.reasonInput}
          value={declineAllReason}
          onChange={(e) => setDeclineAllReason(e.target.value)}
        />
      </label>
      {declineAllError && <div className={styles.error}>{declineAllError}</div>}
    </ConfirmModal>
  );

  if (loading) {
    return <div className={styles.message}>Loading...</div>;
  }
  // A first-page failure (no rows loaded yet) is the empty-error state. A
  // `fetchMore` failure with existing rows falls through to the list below,
  // which renders its own inline retry instead of replacing the rows.
  if (error && rows.length === 0) {
    return <div className={cx(styles.message, styles.error)}>Error loading requests</div>;
  }
  if (rows.length === 0) {
    return <div className={styles.message}>No requests yet</div>;
  }

  return (
    <Fragment>
      {declineAllModal}
      {rows.map((row) => (
        <BookRequestRow key={row.id} request={row} canResolve target={target} />
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
};
