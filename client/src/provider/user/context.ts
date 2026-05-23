import { createContext } from 'react';

import { UserList } from './type';

export type UserContext = {
  userList: UserList;
  loading: boolean;
  error: string | undefined;
  setUserList: (updater: (prev: UserList) => UserList) => void;
  setLoading: (loading: boolean) => void;
  setError: (error: string | undefined) => void;
};

export const Context = createContext<UserContext>({
  userList: {},
  loading: false,
  error: undefined,
  setUserList: () => {},
  setLoading: () => {},
  setError: () => {},
});
