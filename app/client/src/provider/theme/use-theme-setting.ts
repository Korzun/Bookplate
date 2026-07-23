import { use } from 'react';

import { Context, type ThemeSetting } from './context';

export type UseThemeSetting = [ThemeSetting, (setting: ThemeSetting) => void];

export const useThemeSetting = (): UseThemeSetting => {
  const { setting, setSetting } = use(Context);
  return [setting, setSetting];
};
