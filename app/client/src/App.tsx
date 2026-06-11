import { buildProvidersTree } from './provider';
import { AuthProvider } from './provider/auth';
import { BookProvider } from './provider/book';
import { LibraryTargetProvider } from './provider/library-target';
import { ProgressProvider } from './provider/progress';
import { ThemeProvider } from './provider/theme';
import { ToastProvider } from './provider/toast';
import { UserProvider } from './provider/user';
import { AppRouter } from './router/';

const ProvidersTree = buildProvidersTree([
  [ThemeProvider],
  [AuthProvider],
  [LibraryTargetProvider],
  [UserProvider],
  [BookProvider],
  [ProgressProvider],
  [ToastProvider],
]);

export const App = () => (
  <ProvidersTree>
    <AppRouter />
  </ProvidersTree>
);
