import { use, useMemo } from 'react';

import { Context } from '../context';

export type UseMustSetEmail = [boolean, boolean];
export const useMustSetEmail = (): UseMustSetEmail => {
  const { mustSetEmail, loading } = use(Context);
  return useMemo(() => [mustSetEmail, loading], [mustSetEmail, loading]);
};
