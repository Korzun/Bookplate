import { UserRow, UserRowFragment } from '~/component/user-row';
import { useFragment, type FragmentType } from '~/gql';

import { useStyle } from './style';

/**
 * The document's own row shape, not just the fragment ref: `UserRowFragment`
 * must NOT carry `library { id }` (see that fragment's own doc comment for
 * the cost reasoning — `Viewer.users`'s ×50 multiplier, and this project's
 * worst-measured legitimate query shape at 68.5% of the complexity budget).
 * `UserListDocument` (`~/graphql/user`) selects `library { id }` as a SIBLING
 * of the `...UserRowFragment` spread instead, and `page/user-list` passes
 * those rows straight through — so the runtime objects already carry it.
 * Widening this prop's TYPE to match (rather than the narrower
 * `FragmentType<typeof UserRowFragment>[]` it used to be) is what lets
 * `libraryId` reach `UserRow` below without adding a field anywhere or
 * moving any cost — mirrors how `component/library-switcher` already reads
 * the same `UserListDocument` rows.
 */
type UserListRow = FragmentType<typeof UserRowFragment> & { library: { id: string } };

interface UserListProps {
  users: UserListRow[];
  loading: boolean;
}

/**
 * Fetch-free: `page/user-list` composes `UserListDocument` from
 * `UserRowFragment` and passes the result straight through. `useFragment`
 * is called once, unconditionally, at the top of this body — purely to read
 * `id`/`username` for sorting and row keys; the ORIGINAL (still masked)
 * refs are what get handed to each `UserRow`, unchanged, since `useFragment`
 * is a type-only unmask (no runtime transform) and `UserRow` does its own
 * unconditional unmask of the exact same ref.
 *
 * A future `cache.modify` append (`UserRegister`'s create path) is not
 * guaranteed to land in username order, so this sorts where the list is
 * rendered rather than relying on the server's own ordering.
 */
export const UserList = ({ users: userRefs, loading }: UserListProps) => {
  const styles = useStyle();
  const unmaskedUsers = useFragment(UserRowFragment, userRefs);

  const sortedRows = userRefs
    .map((ref, index) => ({
      ref,
      id: unmaskedUsers[index].id,
      username: unmaskedUsers[index].username,
      libraryId: ref.library.id,
    }))
    .sort((rowA, rowB) => rowA.username.localeCompare(rowB.username));

  if (loading) return <p className={styles.loading}>Loading…</p>;

  return (
    <div className={styles.root}>
      {sortedRows.map((row) => (
        <UserRow key={row.id} user={row.ref} libraryId={row.libraryId} />
      ))}
    </div>
  );
};
