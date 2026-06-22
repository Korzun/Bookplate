import { useContext } from 'react';

import { Context } from './context';

export { ConfigProvider } from './provider';
export { Context as ConfigContext } from './context';

export const useLibraryName = (): string => useContext(Context).libraryName;
