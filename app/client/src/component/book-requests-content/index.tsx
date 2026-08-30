import { useApolloClient, useMutation } from '@apollo/client/react';
import cx from 'classnames';
import { Fragment, useCallback, useState } from 'react';

import { BookRequestRow } from '~/component/book-request-row';
import { Button, TextArea, TextInput } from '~/control';
import type { BookRequestCreateMutation } from '~/gql/graphql';
import {
  BookRequestCreateDocument,
  BookRequestDeleteDocument,
  MyBookRequestCountDocument,
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
   * This component's own PARENT (`BookRequests`) always passes `false` at its
   * one production call site — `BookRequests` never mounts this component
   * while `Card` is collapsed (`Card` does not render its children into the
   * tree at all while collapsed). `skip` stays a required, EXPLICIT prop
   * regardless — rather than defaulting to `false` internally — so this
   * component's own tests can gate the query directly instead of depending on
   * `Card`'s mount timing as an implicit contract. Mirrors
   * `MyProgressContent`'s identical prop for the identical reason.
   */
  skip: boolean;
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
 * both `MyBookRequestListDocument` and `MyBookRequestCountDocument`** via
 * `client.refetchQueries({ include: [...] })`. Plain normalization is NOT
 * enough on its own: `BookRequestCreateDocument` re-selects the full
 * `BookRequestRowFragment` on the returned `bookRequest`, which would keep
 * an ALREADY-cached `BookRequest:<id>` entity in sync, but a brand-new
 * request has no existing connection edge for normalization to attach to —
 * Apollo cannot insert a new edge into an already-cached
 * `relayStylePagination` connection on its own. No hand-rolled
 * `cache.modify` insert either: the connection's cursor order (newest
 * `createdAt`, `id asc` tiebreaker) is not reproducible client-side, so
 * reproducing it optimistically risks a wrongly-ordered or duplicated
 * row for no real gain — creating a request is a rare, interactive action
 * over a small list, so a full refetch is cheap and simply correct.
 * `refetchQueries({ include: [...] })` only refetches ACTIVE queries (a
 * no-op if nothing is currently watching a given document), so this is
 * harmless to call even when, say, `MyBookRequestCountDocument`'s only
 * mount site (`BookRequests`) happens not to be on screen.
 *
 * **`onDelete` (passed to `BookRequestRow`) runs `BookRequestDeleteDocument`,
 * evicts the returned `deletedId` from the cache, and — on a genuine
 * deletion — refetches the same two documents.** `bookRequestDelete` is NOT
 * a union (no failure a client renders differently — `null` covers both
 * "gone" and "not yours") so there is no `unwrapResult` call here, just a
 * null check. `cache.evict` on a `relayStylePagination`-held connection (see
 * `provider/apollo/cache.ts`'s `User.bookRequests` typePolicy, added
 * alongside this component) already makes `InMemoryCache` silently drop the
 * now-dangling edge the next time the connection is read — the same
 * mechanism `useDeleteProgress` documents for `Library.progress` — so the
 * list refetch here is belt-and-suspenders. The COUNT refetch is not:
 * `pendingBookRequestCount` is a server-computed `t.relationCount` with no
 * client-visible increment/decrement, so without this refetch a withdrawn
 * or cleared request would leave the card's subtitle stale.
 *
 * **Loading, first-page error, and empty states follow `MyProgressContent`'s
 * three-branch shape exactly** — but only for the LIST region below the
 * form: the form itself is not gated on any of those three states, so a
 * reader can compose a new request even while the list is loading, failed,
 * or empty.
 */
export const BookRequestsContent = ({ skip }: BookRequestsContentProps) => {
  const styles = useStyle();
  const client = useApolloClient();
  const [runCreate, { loading: creating }] = useMutation(BookRequestCreateDocument);
  const [runDelete] = useMutation(BookRequestDeleteDocument);

  const [title, setTitle] = useState<string>('');
  const [author, setAuthor] = useState<string>('');
  const [note, setNote] = useState<string>('');
  const [formError, setFormError] = useState<string | undefined>(undefined);

  const { edges, loading, loadingMore, error, hasNextPage, loadMore } = usePaginatedConnection({
    document: MyBookRequestListDocument,
    variables: {},
    skip,
    select: (data) => data?.viewer.user?.bookRequests,
    resetKey: String(skip),
    loadMoreErrorMessage: 'Failed to load more requests',
  });
  const rows = edges.map((edge) => edge.node);

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
          include: [MyBookRequestListDocument, MyBookRequestCountDocument],
        });
      } catch (err) {
        setFormError(err instanceof Error ? err.message : 'Failed to submit request');
      }
    },
    [title, author, note, runCreate, client]
  );

  const handleDelete = useCallback(
    (id: string) => {
      void (async () => {
        const { data } = await runDelete({
          variables: { id },
          update: (cache, { data: mutationData }) => {
            const deletedId = mutationData?.bookRequestDelete?.deletedId;
            if (!deletedId) return;
            cache.evict({ id: cache.identify({ __typename: 'BookRequest', id: deletedId }) });
            cache.gc();
          },
        });
        if (data?.bookRequestDelete?.deletedId) {
          await client.refetchQueries({
            include: [MyBookRequestListDocument, MyBookRequestCountDocument],
          });
        }
      })();
    },
    [runDelete, client]
  );

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
      {list}
    </div>
  );
};
