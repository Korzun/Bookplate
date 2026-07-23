import { use, useMemo } from 'react';

import { Context } from '../context';

export type UseMustChangePassword = [boolean, boolean];
export const useMustChangePassword = (): UseMustChangePassword => {
  const { mustChangePassword, loading } = use(Context);
  return useMemo(() => [mustChangePassword, loading], [mustChangePassword, loading]);
};
