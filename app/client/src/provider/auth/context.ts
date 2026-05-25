import { createContext } from 'react';

interface AuthContextMutators {
  setUsername: (username: string) => void;
  setIsAdmin: (isAdmin: boolean) => void;
  refetch: () => Promise<void>;
}

export type AuthContext = AuthContextMutators &
  (
    | { username: string; isAdmin: boolean; loading: false; error: false; errorMessage: undefined }
    | {
        username: string | undefined;
        isAdmin: boolean;
        loading: true;
        error: boolean;
        errorMessage: undefined;
      }
    | {
        username: undefined;
        isAdmin: false;
        loading: false;
        error: true;
        errorMessage: string | undefined;
      }
    | { username: undefined; isAdmin: false; loading: false; error: true; errorMessage: string }
  );

export const Context = createContext<AuthContext>({
  username: undefined,
  setUsername: () => {},
  isAdmin: false,
  setIsAdmin: () => {},
  refetch: () => Promise.resolve(),
  loading: true,
  error: false,
  errorMessage: undefined,
});
