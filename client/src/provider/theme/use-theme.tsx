import { useTheme as useJssTheme } from 'react-jss';

import type { Theme } from './theme';

export function useTheme(): Theme {
  return useJssTheme<Theme>();
}
