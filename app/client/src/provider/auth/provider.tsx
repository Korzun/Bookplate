import { type ReactNode, useCallback, useEffect, useMemo, useState } from 'react';

import { Context, AuthContext } from './context';

export type AuthProviderProps = { children: ReactNode };
export const AuthProvider = ({ children }: AuthProviderProps) => {
  const [username, setUsername] = useState<AuthContext['username']>();
  const [isAdmin, setIsAdmin] = useState<AuthContext['isAdmin']>(false);
  const [mustChangePassword, setMustChangePassword] =
    useState<AuthContext['mustChangePassword']>(false);
  const [loading, setLoading] = useState<AuthContext['loading']>(true);
  const [error, setError] = useState<AuthContext['error']>(false);
  const [errorMessage, setErrorMessage] = useState<AuthContext['errorMessage']>();

  const fetchMe = useCallback(async () => {
    try {
      const response = await fetch('/api/me');
      if (!response.ok) {
        throw new Error('Not authenticated');
      }
      const currentUser = await (response.json() as Promise<{
        username: string;
        isAdmin: boolean;
        mustChangePassword: boolean;
      }>);
      setUsername(currentUser.username);
      setIsAdmin(currentUser.isAdmin);
      setMustChangePassword(currentUser.mustChangePassword);
    } catch (error) {
      setUsername(undefined);
      setIsAdmin(false);
      setMustChangePassword(false);
      setError(true);
      if (error instanceof Error) {
        setErrorMessage(error.message);
      }
    } finally {
      setLoading(false);
    }
  }, []);
  const refetch = useCallback(async () => {
    setLoading(true);
    setError(false);
    setErrorMessage(undefined);
    await fetchMe();
  }, [fetchMe]);
  useEffect(() => {
    const load = async () => {
      await fetchMe();
    };
    void load();
  }, [fetchMe]);

  const state = useMemo(
    () =>
      ({
        username,
        setUsername,
        isAdmin,
        setIsAdmin,
        mustChangePassword,
        setMustChangePassword,
        refetch,
        loading,
        error,
        errorMessage,
      }) as AuthContext,
    [username, isAdmin, mustChangePassword, loading, error, errorMessage, refetch]
  );

  return <Context.Provider value={state}>{children}</Context.Provider>;
};
