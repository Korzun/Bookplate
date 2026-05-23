import { createContext } from 'react';

import type { ProgressList, UserProgressList } from './type';

export type ProgressContext = {
  progressList: ProgressList;
  loadingByUsername: Record<string, boolean>;
  errorByUsername: Record<string, string | undefined>;
  setProgressForUsername: (username: string, data: UserProgressList) => void;
  setLoadingForUsername: (username: string, loading: boolean) => void;
  setErrorForUsername: (username: string, error: string | undefined) => void;
};

export const Context = createContext<ProgressContext>({
  progressList: {},
  loadingByUsername: {},
  errorByUsername: {},
  setProgressForUsername: () => {},
  setLoadingForUsername: () => {},
  setErrorForUsername: () => {},
});
