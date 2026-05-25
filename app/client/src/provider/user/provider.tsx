import { useCallback, useState, type ReactNode } from 'react';

import { Context } from './context';
import { UserList } from './type';

export type UserProviderProps = { children: ReactNode };
export const UserProvider = ({ children }: UserProviderProps) => {
  const [userList, setUserListRaw] = useState<UserList>({});
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | undefined>();

  const setUserList = useCallback(
    (updater: (prev: UserList) => UserList) => setUserListRaw(updater),
    []
  );

  return (
    <Context.Provider value={{ userList, loading, error, setUserList, setLoading, setError }}>
      {children}
    </Context.Provider>
  );
};
