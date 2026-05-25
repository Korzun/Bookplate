import { type ReactNode, useCallback, useEffect, useMemo, useState } from 'react';

import { Context, AuthContext } from './context';

export type AuthProviderProps = { children: ReactNode };
export const AuthProvider = ({ children }: AuthProviderProps) => {
  const [username, setUsername] = useState<AuthContext['username']>();
  const [isAdmin, setIsAdmin] = useState<AuthContext['isAdmin']>(false);
  const [loading, setLoading] = useState<AuthContext['loading']>(true);
  const [error, setError] = useState<AuthContext['error']>(false);
  const [errorMessage, setErrorMessage] = useState<AuthContext['errorMessage']>();

  const fetchMe = useCallback(async () => {
    try {
      setLoading(true);
      setError(false);
      setErrorMessage(undefined);
      const response = await fetch('/api/me');
      if (!response.ok) {
        throw new Error('Not authenticated');
      }
      const currentUser = await (response.json() as Promise<{
        username: string;
        isAdmin: boolean;
      }>);
      setUsername(currentUser.username);
      setIsAdmin(currentUser.isAdmin);
    } catch (error) {
      setUsername(undefined);
      setIsAdmin(false);
      setError(true);
      if (error instanceof Error) {
        setErrorMessage(error.message);
      }
    } finally {
      setLoading(false);
    }
  }, []);
  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect
    fetchMe();
  }, [fetchMe]);

  const state = useMemo(
    () =>
      ({
        username,
        setUsername,
        isAdmin,
        setIsAdmin,
        refetch: fetchMe,
        loading,
        error,
        errorMessage,
      }) as AuthContext,
    [username, isAdmin, loading, error, errorMessage, fetchMe]
  );

  return <Context.Provider value={state}>{children}</Context.Provider>;
};
