import { useQuery } from '@apollo/client/react';

import { Page, UserList, UserRegister } from '~/component';
import { UserListDocument } from '~/graphql/user';
import { useIsAdmin } from '~/provider/auth';

/**
 * Composes `UserListDocument` (`~/graphql/user` — a leaf module, since that
 * document has multiple readers beyond this route; see its own doc comment)
 * with `component/user-row`'s colocated `UserRowFragment` spread — one
 * request per screen, authored by the components that use the data.
 */
export const UserListPage = () => {
  const [isAdmin] = useIsAdmin();
  const { data, loading } = useQuery(UserListDocument, { skip: !isAdmin });

  return (
    <Page>
      <UserRegister />
      <UserList users={data?.viewer.users ?? []} loading={loading} />
    </Page>
  );
};
