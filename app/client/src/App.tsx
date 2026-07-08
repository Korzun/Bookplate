import { buildProvidersTree } from './provider';
import { AuthProvider } from './provider/auth';
import { BookProvider } from './provider/book';
import { ConfigProvider } from './provider/config';
import { DeviceProvider } from './provider/device';
import { LibraryTargetProvider } from './provider/library-target';
import { ProgressProvider } from './provider/progress';
import { ThemeProvider } from './provider/theme';
import { ToastProvider } from './provider/toast';
import { UserProvider } from './provider/user';
import { AppRouter } from './router/';

const ProvidersTree = buildProvidersTree([
  [ConfigProvider],
  [ThemeProvider],
  [AuthProvider],
  [LibraryTargetProvider],
  [UserProvider],
  [DeviceProvider],
  [BookProvider],
  [ProgressProvider],
  [ToastProvider],
]);

export const App = () => (
  <ProvidersTree>
    <AppRouter />
  </ProvidersTree>
);
