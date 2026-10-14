import { use } from 'react';

import { Context } from './context';

export { ConfigProvider } from './provider';
export { Context as ConfigContext } from './context';

export const useLibraryName = (): string => use(Context).libraryName;
export const useEmailEnabled = (): boolean => use(Context).emailEnabled;
export const useOnboardingEnabled = (): boolean => use(Context).onboardingEnabled;
