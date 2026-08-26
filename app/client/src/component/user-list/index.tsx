import { UserRow, UserRowFragment } from '~/component/user-row';
import { useFragment, type FragmentType } from '~/gql';

import { useStyle } from './style';

interface UserListProps {
  users: FragmentType<typeof UserRowFragment>[];
  loading: boolean;
}

/**
 * Fetch-free: `page/user-list` composes `UserListDocument` from
 * `UserRowFragment` and passes the result straight through. `useFragment`
 * is called once, unconditionally, at the top of this body — with an ARRAY
 * of refs, one of the masking helper's supported overloads — purely to read
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
    }))
    .sort((rowA, rowB) => rowA.username.localeCompare(rowB.username));

  if (loading) return <p className={styles.loading}>Loading…</p>;

  return (
    <div className={styles.root}>
      {sortedRows.map((row) => (
        <UserRow key={row.id} user={row.ref} />
      ))}
    </div>
  );
};
