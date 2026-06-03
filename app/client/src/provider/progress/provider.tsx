import { useCallback, useState, type ReactNode } from 'react';

import { Context } from './context';
import type { ProgressList, UserProgressList } from './type';

export type ProgressProviderProps = { children: ReactNode };
export const ProgressProvider = ({ children }: ProgressProviderProps) => {
  const [progressList, setProgressListRaw] = useState<ProgressList>({});
  const [loadingByUsername, setLoadingByUsernameRaw] = useState<Record<string, boolean>>({});
  const [errorByUsername, setErrorByUsernameRaw] = useState<Record<string, string | undefined>>({});

  const setProgressForUsername = useCallback((username: string, data: UserProgressList) => {
    setProgressListRaw((prev) => ({ ...prev, [username]: data }));
  }, []);

  const setLoadingForUsername = useCallback((username: string, loading: boolean) => {
    setLoadingByUsernameRaw((prev) => ({ ...prev, [username]: loading }));
  }, []);

  const setErrorForUsername = useCallback((username: string, error: string | undefined) => {
    setErrorByUsernameRaw((prev) => ({ ...prev, [username]: error }));
  }, []);

  const renameProgressKey = useCallback((oldId: string, newId: string) => {
    setProgressListRaw((prev) => {
      const next = { ...prev };
      for (const username of Object.keys(next)) {
        const userProgress = next[username];
        if (userProgress && oldId in userProgress) {
          const { [oldId]: oldEntry, ...rest } = userProgress;
          next[username] = { ...rest, [newId]: { ...oldEntry, document: newId } };
        }
      }
      return next;
    });
  }, []);

  return (
    <Context.Provider
      value={{
        progressList,
        loadingByUsername,
        errorByUsername,
        setProgressForUsername,
        setLoadingForUsername,
        setErrorForUsername,
        renameProgressKey,
      }}
    >
      {children}
    </Context.Provider>
  );
};
