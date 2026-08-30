import { Link } from 'react-router';

import { Button } from '~/control';
import { type FragmentType, useFragment } from '~/gql';
import type { BookRequestStatus } from '~/gql/graphql';
import { BookRequestRowFragment } from '~/graphql/book-request';

import { Tag } from '../tag';
import { useStyle } from './style';

const STATUS_LABEL: Record<BookRequestStatus, string> = {
  PENDING: 'Pending',
  FULFILLED: 'Fulfilled',
  DECLINED: 'Declined',
};

interface BookRequestRowProps {
  /** A masked `BookRequestRowFragment` ref, unmasked inside this component. */
  request: FragmentType<typeof BookRequestRowFragment>;
  /**
   * Whether to render the admin's resolve actions (upload, link an existing
   * book, decline). `false` on the reader's own card — a reader can withdraw a
   * request but never resolve one. Task 14 fills these in behind this prop;
   * this component leaves the seam but does not build them yet.
   */
  canResolve: boolean;
  /** Withdraw / clear. Both surfaces offer this; the server is owner-or-admin. */
  onDelete: (id: string) => void;
}

/**
 * One request row, shared by the reader's own card (`component/
 * book-requests-content`, `canResolve={false}`) and the admin's per-user list
 * (Task 13, `canResolve={true}`). Fetch-free: `useFragment` is called exactly
 * once, unconditionally, in this component's own body, mirroring
 * `UserProgressRow`/`MyProgressRow` — the parent's `usePaginatedConnection`
 * read hands down a masked ref rather than unmasking centrally in a `.map()`.
 *
 * `book` on a FULFILLED request is nullable for two reasons that render
 * differently: not fulfilled yet (never reaches this branch), and the book it
 * WAS fulfilled with has since been deleted (`onDelete: SetNull` server-side).
 * The second case renders "Added to your library" with no link — that is the
 * correct rendering, not an error state.
 *
 * Delete is a plain callback prop, not an owned mutation: this row does not
 * know whether it is being withdrawn (PENDING) or cleared (resolved) in terms
 * of server semantics — both routes through the same owner-or-admin
 * `bookRequestDelete` — so the mutation itself, and its cache eviction, live
 * on the content component that owns the list (`BookRequestsContent`).
 */
export const BookRequestRow = ({
  request,
  canResolve: _canResolve,
  onDelete,
}: BookRequestRowProps) => {
  const styles = useStyle();
  const row = useFragment(BookRequestRowFragment, request);

  const handleDelete = () => onDelete(row.id);

  return (
    <div className={styles.root}>
      <div className={styles.header}>
        <span className={styles.title}>{row.title}</span>
        <Tag size="sm">{STATUS_LABEL[row.status]}</Tag>
      </div>
      <div className={styles.author}>by {row.author}</div>
      {row.note !== '' && <div className={styles.note}>{row.note}</div>}
      {row.status === 'FULFILLED' && (
        <div className={styles.resolution}>
          {row.book ? (
            <Link to={`/book/${row.book.id}`}>Added to your library — {row.book.title}</Link>
          ) : (
            'Added to your library'
          )}
        </div>
      )}
      {row.status === 'DECLINED' && row.declineReason !== '' && (
        <div className={styles.resolution}>{row.declineReason}</div>
      )}
      <Button type="link" danger onClick={handleDelete}>
        {row.status === 'PENDING' ? 'Withdraw' : 'Clear'}
      </Button>
    </div>
  );
};
