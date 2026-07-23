import { use } from 'react';

import { Context } from './context';

export { ConfigProvider } from './provider';
export { Context as ConfigContext } from './context';

export const useLibraryName = (): string => use(Context).libraryName;
