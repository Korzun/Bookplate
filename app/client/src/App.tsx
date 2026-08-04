import { buildProvidersTree } from './provider';
import { ApolloRoot } from './provider/apollo';
import { AuthProvider } from './provider/auth';
import { BookProvider } from './provider/book';
import { ConfigProvider } from './provider/config';
import { DeviceProvider } from './provider/device';
import { LibraryTargetProvider } from './provider/library-target';
import { ProgressProvider } from './provider/progress';
import { ThemeProvider } from './provider/theme';
import { ToastProvider } from './provider/toast';
import { UploadProvider } from './provider/upload';
import { UserProvider } from './provider/user';
import { AppRouter } from './router/';

// `ApolloRoot` is first, so it renders outermost — `buildProvidersTree` nests
// each subsequent entry inside the previous one.
const ProvidersTree = buildProvidersTree([
  [ApolloRoot],
  [ConfigProvider],
  [ThemeProvider],
  [AuthProvider],
  [LibraryTargetProvider],
  [UserProvider],
  [DeviceProvider],
  [BookProvider],
  [UploadProvider],
  [ProgressProvider],
  [ToastProvider],
]);

export const App = () => (
  <ProvidersTree>
    <AppRouter />
  </ProvidersTree>
);
