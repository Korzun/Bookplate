import { buildProvidersTree } from './provider';
import { AuthProvider } from './provider/auth';
import { BookProvider } from './provider/book';
import { ProgressProvider } from './provider/progress';
import { ThemeProvider } from './provider/theme';
import { UserProvider } from './provider/user';
import { AppRouter } from './router/';

const ProvidersTree = buildProvidersTree([
  [ThemeProvider],
  [AuthProvider],
  [UserProvider],
  [BookProvider],
  [ProgressProvider],
]);

export const App = () => (
  <ProvidersTree>
    <AppRouter />
  </ProvidersTree>
);
