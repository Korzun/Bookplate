import { useApolloClient, useMutation } from '@apollo/client/react';
import { type ChangeEvent, useCallback, useId, useState } from 'react';
import { Link } from 'react-router';

import { Button, ConfirmModal, LinkExistingBookModal } from '~/control';
import { type FragmentType, useFragment } from '~/gql';
import type {
  BookRequestDeclineMutation,
  BookRequestFulfillMutation,
  BookRequestStatus,
} from '~/gql/graphql';
import {
  BookRequestDeclineDocument,
  BookRequestFulfillDocument,
  BookRequestRowFragment,
} from '~/graphql/book-request';
import { UserListDocument } from '~/graphql/user';
import { unwrapResult } from '~/provider/apollo';
import { useUploadQueue } from '~/provider/upload';
import { path } from '~/router';

import { Card } from '../card';
import { Tag } from '../tag';
import { useStyle } from './style';

const STATUS_LABEL: Record<BookRequestStatus, string> = {
  PENDING: 'Pending',
  FULFILLED: 'Fulfilled',
  DECLINED: 'Declined',
};

// `unwrapResult`'s `TPayload` sits in a position TypeScript cannot infer
// from the call, so it is named explicitly here, extracted from the
// generated union — same shape as `control/link-progress-modal`'s own note.
type BookRequestFulfillPayload = Extract<
  NonNullable<BookRequestFulfillMutation['bookRequestFulfill']>,
  { __typename: 'BookRequestFulfillPayload' }
>;
type BookRequestDeclinePayload = Extract<
  NonNullable<BookRequestDeclineMutation['bookRequestDecline']>,
  { __typename: 'BookRequestDeclinePayload' }
>;

interface BookRequestRowProps {
  /** A masked `BookRequestRowFragment` ref, unmasked inside this component. */
  request: FragmentType<typeof BookRequestRowFragment>;
  /**
   * Whether to render the admin's resolve actions (upload, link an existing
   * book, decline). `false` on the reader's own card — a reader can withdraw a
   * request but never resolve one.
   */
  canResolve: boolean;
  /**
   * Withdraw (pending) / clear (resolved). Offered ONLY on the reader's own
   * view — deleting a request belongs to whoever submitted it. The admin
   * resolves and never disposes. `bookRequestDelete` stays owner-or-admin
   * server-side; the admin is simply not offered it here.
   *
   * OPTIONAL because the admin's call site (`component/user-request-list`,
   * `canResolve`) has nothing to pass — it renders no delete control, so it
   * owns no delete mutation. The reader's call site
   * (`component/book-requests-content`, `canResolve={false}`) always passes it.
   * The button below renders only when `!canResolve`, so the two travel
   * together by construction.
   */
  onDelete?: (id: string) => void;
  /**
   * The owning reader's Library global id and username. Required whenever
   * `canResolve` is true — both halves are what `addFiles` captures on the
   * item so the bytes reach THIS reader's library whatever the global
   * library-switcher says, and `LinkExistingBookModal` roots its picker at
   * this exact library rather than the admin's own switcher selection.
   */
  target?: { libraryId: string; username: string };
}

/**
 * One request row, shared by the reader's own card (`component/
 * book-requests-content`, `canResolve={false}`) and the admin's per-user list
 * (`component/user-request-list`, `canResolve={true}`). Fetch-free: `useFragment`
 * is called exactly once, unconditionally, in this component's own body,
 * mirroring `UserProgressRow`/`MyProgressRow` — the parent's
 * `usePaginatedConnection` read hands down a masked ref rather than unmasking
 * centrally in a `.map()`.
 *
 * `book` on a FULFILLED request is nullable for two reasons that render
 * differently: not fulfilled yet (never reaches this branch), and the book it
 * WAS fulfilled with has since been deleted (`onDelete: SetNull` server-side).
 * The second case renders "Added to your library" with no link — that is the
 * correct rendering, not an error state.
 *
 * The fulfilled link goes through `path.book(id)` (`~/router`), not a
 * hand-rolled `/book/${id}` template: the registered route is
 * `${path.library()}/book/:bookId` (`router/component.tsx`), so a bare
 * `/book/<id>` matches no route and falls through to the `*` catch-all,
 * which redirects to the library. `path.book` also runs the id through
 * `encodeURIComponent` — a Relay global id is base64 and can contain `+`
 * or `/`, both of which need escaping in a URL path segment.
 *
 * Delete is a plain callback prop, not an owned mutation: this row does not
 * know whether it is being withdrawn (PENDING) or cleared (resolved) in terms
 * of server semantics — both routes through the same owner-or-admin
 * `bookRequestDelete` — so the mutation itself, and its cache eviction, live
 * on the content component that owns the list (`BookRequestsContent`/
 * `UserRequestList`).
 *
 * **Resolve actions (`canResolve && status === 'PENDING'`) — Approach B, end
 * to end:**
 *
 * - **Upload EPUB**: a plain `<input type="file">`, calling
 *   `addFiles(files, { target, fulfillsRequestId: row.id })`. Both halves of
 *   `options` matter: `target` is what makes the bytes land in the
 *   REQUESTING reader's library no matter what the admin's global library
 *   switcher currently points at (`provider/upload/hook/use-upload-transport.ts`'s
 *   `AddFileOptions.target`); `fulfillsRequestId` is what makes Task 11's
 *   queue effect fire `bookRequestFulfill` once the item lands
 *   (`provider/upload/hook/use-upload-queue.ts`). This row fires NO mutation
 *   itself for that path — the queue owns it.
 * - **Link existing book**: opens `LinkExistingBookModal` rooted at
 *   `target.libraryId`, and runs `BookRequestFulfillDocument` directly with
 *   the picked book's GLOBAL id the instant it is picked. This is both the
 *   recovery path when auto-fulfil failed (see "didn't close" below) and the
 *   route for an admin who uploaded the book before ever opening the
 *   request.
 * - **Decline**: a small reason prompt (`ConfirmModal` with a labelled
 *   textarea), then `BookRequestDeclineDocument`. The reason is trimmed and
 *   omitted from the variables entirely when empty — "optional" is what an
 *   ABSENT `reason` argument means server-side
 *   (`graphql/schema/book-request/mutation/decline.ts`'s `args.reason ?? ''`).
 *
 * **Link and Decline both refetch `UserListDocument`** (`~/graphql/user`) on
 * success — the same `pendingBookRequestCount` staleness `user-request-list`'s
 * `handleDelete` already documents: that field is a server-computed
 * `t.relationCount` with no client-visible decrement, so without the refetch
 * the admin's "N pending" badge would read stale immediately after the
 * feature's own headline action. The auto-fulfil path refetches too, from
 * `use-upload-queue.ts`'s queue effect, for the same reason.
 *
 * **This row's own live queue item** is found by `fulfillsRequestId ===
 * row.id` among `useUploadQueue().items`, searching from the END: `addFiles`
 * APPENDS to the item list, so a retried upload leaves the FIRST attempt's
 * item in the array too, and a forward `.find` would keep rendering its
 * stale error forever. Rendered from the most recent match: a progress line
 * while queued/uploading; `errorMessage`, or a summary of
 * the EPUB `validation` failure, on `error`; on `done`, a link to the new
 * book (`queueItem.bookGlobalId`) plus, when `proposals.length > 0`, a
 * suggestion COUNT that links out to `/upload` for the full review.
 *
 * **Fix review deliberately does NOT live here** — see this migration's
 * task-14 brief preamble. The upload queue's pending-fix merge
 * (`use-upload-queue.ts`'s `byBook` join) is rooted on the ADMIN's global
 * library switcher (`useCurrentLibraryId()`), so a book uploaded into
 * bob's library while the switcher points at alice has no pending-fix row to
 * merge against here — querying per-item to work around that would be a
 * second, per-row round trip for every row on this list, just to reproduce
 * what `/upload` already shows for free. So this row reads only the
 * suggestion COUNT off `TransportItem.proposals` (via the merged
 * `UploadItem`), which the transport already stores from the upload
 * response, and links to `/upload` for the actual Apply/Dismiss controls.
 *
 * **"Uploaded, but the request didn't close."** renders beside Link existing
 * book whenever the queue item landed (`status === 'done'`) but the request
 * itself is still `PENDING` — the queue's own `bookRequestFulfill` call
 * either failed, or has not round-tripped back into this row's props yet.
 * Either way, Link existing book (pointed straight at the just-uploaded
 * book) is the recovery path — no retry button re-fires the same fire-once
 * queue effect from here.
 */
export const BookRequestRow = ({ request, canResolve, onDelete, target }: BookRequestRowProps) => {
  const styles = useStyle();
  const row = useFragment(BookRequestRowFragment, request);
  const uploadInputId = useId();
  const client = useApolloClient();

  const { items, addFiles } = useUploadQueue();
  // The LAST match, not the first: `addFiles` APPENDS to the queue's item
  // list (`use-upload-transport.ts`'s `[...prev, ...newItems]`), so a failed
  // upload followed by a retry leaves BOTH items in `items`, both carrying
  // this same `fulfillsRequestId`. `.find` on the plain array would keep
  // rendering the FIRST attempt's stale error forever; reversing first tracks
  // whichever attempt is most recent. (`Array.prototype.findLast` would say
  // this more directly, but this repo's `lib` target is ES2022, one short of
  // ES2023's `findLast`.)
  const queueItem = items
    .slice()
    .reverse()
    .find((item) => item.fulfillsRequestId === row.id);

  const [runFulfill] = useMutation(BookRequestFulfillDocument);
  const [runDecline] = useMutation(BookRequestDeclineDocument);

  const [isPickerOpen, setPickerOpen] = useState(false);
  const [fulfillError, setFulfillError] = useState<string | undefined>();

  const [isDeclineOpen, setDeclineOpen] = useState(false);
  const [declineReason, setDeclineReason] = useState('');
  const [declining, setDeclining] = useState(false);
  const [declineError, setDeclineError] = useState<string | undefined>();

  const handleDelete = () => onDelete?.(row.id);

  const handleUploadChange = useCallback(
    (event: ChangeEvent<HTMLInputElement>) => {
      const files = event.target.files;
      if (files && files.length > 0) {
        addFiles(files, { target, fulfillsRequestId: row.id });
      }
      event.target.value = '';
    },
    [addFiles, target, row.id]
  );

  const handleOpenPicker = useCallback(() => {
    setFulfillError(undefined);
    setPickerOpen(true);
  }, []);
  const handleClosePicker = useCallback(() => setPickerOpen(false), []);

  const handlePick = useCallback(
    async (bookGlobalId: string) => {
      setPickerOpen(false);
      setFulfillError(undefined);
      try {
        const { data } = await runFulfill({ variables: { id: row.id, bookId: bookGlobalId } });
        const outcome = unwrapResult<BookRequestFulfillPayload>(
          data?.bookRequestFulfill,
          'BookRequestFulfillPayload'
        );
        if (outcome.status === 'missing') {
          setFulfillError('Failed to link this book');
        } else if (outcome.status === 'error') {
          setFulfillError(outcome.message);
        } else {
          // `pendingBookRequestCount` (`UserRowFragment`) is a server-computed
          // `t.relationCount` with no client-visible decrement — same doc
          // comment as `user-request-list`'s `handleDelete`. Without this
          // refetch, resolving a request here leaves the admin's "N pending"
          // badge stale until a full reload.
          await client.refetchQueries({ include: [UserListDocument] });
        }
      } catch (err) {
        setFulfillError(err instanceof Error ? err.message : 'Failed to link this book');
      }
    },
    [runFulfill, row.id, client]
  );

  const handleOpenDecline = useCallback(() => {
    setDeclineReason('');
    setDeclineError(undefined);
    setDeclineOpen(true);
  }, []);
  const handleCancelDecline = useCallback(() => setDeclineOpen(false), []);

  const handleConfirmDecline = useCallback(async () => {
    setDeclining(true);
    setDeclineError(undefined);
    try {
      const trimmed = declineReason.trim();
      const { data } = await runDecline({
        variables: { id: row.id, reason: trimmed === '' ? undefined : trimmed },
      });
      const outcome = unwrapResult<BookRequestDeclinePayload>(
        data?.bookRequestDecline,
        'BookRequestDeclinePayload'
      );
      if (outcome.status === 'missing') {
        setDeclineError('Failed to decline request');
        return;
      }
      if (outcome.status === 'error') {
        setDeclineError(outcome.message);
        return;
      }
      setDeclineOpen(false);
      // Same stale-badge reason `handlePick` refetches for above.
      await client.refetchQueries({ include: [UserListDocument] });
    } catch (err) {
      setDeclineError(err instanceof Error ? err.message : 'Failed to decline request');
    } finally {
      setDeclining(false);
    }
  }, [runDecline, row.id, declineReason, client]);

  const suggestionCount = queueItem?.proposals?.length ?? 0;
  const uploadedButNotClosed = queueItem?.status === 'done' && row.status === 'PENDING';

  /**
   * The card's FOOTER, split left/right: the dismissive action on the left, the
   * resolving actions on the right.
   *
   * The two audiences get disjoint sets, which is the whole point — the admin
   * RESOLVES (upload / link / decline) and the reader DISPOSES (withdraw while
   * pending, clear once answered). Neither ever sees the other's controls, so
   * the reader's single control takes the same left slot Decline occupies.
   */
  const footer = canResolve ? (
    row.status === 'PENDING' ? (
      <div className={styles.footerBar}>
        <Button type="text" danger onClick={handleOpenDecline}>
          Decline
        </Button>
        <div className={styles.footerRight}>
          <label htmlFor={uploadInputId} className={styles.uploadLabel}>
            Upload EPUB
          </label>
          <input
            id={uploadInputId}
            className={styles.hiddenInput}
            type="file"
            accept=".epub"
            onChange={handleUploadChange}
          />
          <Button type="default" onClick={handleOpenPicker}>
            Link existing book
          </Button>
        </div>
      </div>
    ) : undefined
  ) : (
    <div className={styles.footerBar}>
      <Button type="link" danger onClick={handleDelete}>
        {row.status === 'PENDING' ? 'Withdraw' : 'Clear'}
      </Button>
    </div>
  );

  return (
    <>
      {/* No `title`, `subTitle` or `headerAction`: `Card` renders no header at
          all when given none of them, which is what keeps the request's own
          identity in the body where the rest of this list reads it. */}
      <Card size="small" footer={footer}>
        <div className={styles.identity}>
          <div className={styles.identityText}>
            <div className={styles.title}>{row.title}</div>
            <div className={styles.author}>by {row.author}</div>
          </div>
          <Tag size="sm">{STATUS_LABEL[row.status]}</Tag>
        </div>
        {row.note !== '' && <div className={styles.note}>{row.note}</div>}
        {row.status === 'FULFILLED' && (
          <div className={styles.resolution}>
            {row.book ? (
              <Link to={path.book(row.book.id)}>Added to your library — {row.book.title}</Link>
            ) : (
              'Added to your library'
            )}
          </div>
        )}
        {row.status === 'DECLINED' && row.declineReason !== '' && (
          <div className={styles.resolution}>{row.declineReason}</div>
        )}

        {(queueItem?.status === 'queued' || queueItem?.status === 'uploading') && (
          <div className={styles.resolution}>Uploading…</div>
        )}
        {queueItem?.status === 'error' && (
          <div className={styles.error}>
            {queueItem.errorMessage ??
              queueItem.validation?.messages[0]?.message ??
              'Upload failed'}
          </div>
        )}
        {queueItem?.status === 'done' && queueItem.bookGlobalId && (
          <div className={styles.resolution}>
            <Link to={path.book(queueItem.bookGlobalId)}>Uploaded — {queueItem.fileName}</Link>
            {suggestionCount > 0 && (
              <span className={styles.suggestions}>
                {suggestionCount} suggestion{suggestionCount === 1 ? '' : 's'} —{' '}
                <Link to={path.add()}>review in Upload</Link>
              </span>
            )}
          </div>
        )}
        {/* A message, not an action, so it sits in the body rather than the
            footer — it reports what happened to an upload already started. */}
        {uploadedButNotClosed && (
          <div className={styles.notClosed}>Uploaded, but the request didn&apos;t close.</div>
        )}
        {fulfillError && <div className={styles.error}>{fulfillError}</div>}
      </Card>

      {canResolve && row.status === 'PENDING' && target && (
        <LinkExistingBookModal
          isOpen={isPickerOpen}
          libraryId={target.libraryId}
          onPick={(bookGlobalId) => void handlePick(bookGlobalId)}
          onClose={handleClosePicker}
        />
      )}

      {canResolve && row.status === 'PENDING' && (
        <ConfirmModal
          isOpen={isDeclineOpen}
          title="Decline request"
          confirmText="Confirm"
          loading={declining}
          onCancel={handleCancelDecline}
          onConfirm={() => void handleConfirmDecline()}
        >
          <label className={styles.reasonLabel}>
            Reason (optional)
            <textarea
              className={styles.reasonInput}
              value={declineReason}
              onChange={(e) => setDeclineReason(e.target.value)}
            />
          </label>
          {declineError && <div className={styles.error}>{declineError}</div>}
        </ConfirmModal>
      )}
    </>
  );
};
