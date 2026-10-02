import { BrowserRouter, Navigate, Route, Routes } from 'react-router';

import {
  AddLayout,
  AddRequestView,
  AddUploadView,
  BookEditPage,
  BookPage,
  DeviceListPage,
  ForgotPasswordPage,
  LibraryPage,
  LoginPage,
  PasswordResetPage,
  ResetPasswordPage,
  SeriesPage,
  SetEmailPage,
  UserListPage,
  UserPage,
} from '~/page';

import { NavLayout } from './nav-layout';
import * as path from './path-internal';
import * as pathKey from './path-key-internal';
import { ProtectedRoute } from './protected-route';
import { ScrollRestoration } from './scroll-restoration';
import { UnprotectedRoute } from './unprotected-route';

export const AppRouter = () => {
  return (
    <BrowserRouter>
      <ScrollRestoration />
      <Routes>
        <Route element={<UnprotectedRoute />}>
          <Route path={path.login()} element={<LoginPage />} />
          <Route path={path.forgotPassword()} element={<ForgotPasswordPage />} />
          <Route path={path.resetPasswordByEmail()} element={<ResetPasswordPage />} />
        </Route>

        <Route element={<ProtectedRoute />}>
          {/* Nav-bearing routes share one persistent <Nav /> via NavLayout. */}
          <Route element={<NavLayout />}>
            <Route path={path.library()} element={<LibraryPage />} />
            {/* One PATHLESS layout for two sibling destinations. Upload and
                Request are separate nav items now, but they still share the
                admin "Select a library" gate, the `<Page>` shell and the
                header-actions channel that `AddLayout` provides — a layout
                route keeps all three without either view knowing the other
                exists. */}
            <Route element={<AddLayout />}>
              <Route path={path.add()} element={<AddUploadView />} />
              <Route path={path.request()} element={<AddRequestView />} />
            </Route>
            {/* The URL Request used to live at. Without this the catch-all
                below would bounce an old bookmark to the library, which reads
                as "the feature is gone" rather than "it moved". */}
            <Route
              path={path.legacyAddRequest()}
              element={<Navigate to={path.request()} replace />}
            />
            <Route path={path.series(pathKey.seriesName)} element={<SeriesPage />} />
            <Route path={path.book(pathKey.bookId)} element={<BookPage />} />
            <Route path={path.bookEdit(pathKey.bookId)} element={<BookEditPage />} />
            <Route path={path.user()} element={<UserPage />} />
            <Route path={path.userList()} element={<UserListPage />} />
            <Route path={path.devices()} element={<DeviceListPage />} />
            <Route path="*" element={<Navigate to={path.library()} replace />} />
          </Route>
          {/* Password reset and set-email are both nav-less (minimal page). */}
          <Route path={path.passwordReset()} element={<PasswordResetPage />} />
          <Route path={path.setEmail()} element={<SetEmailPage />} />
        </Route>
      </Routes>
    </BrowserRouter>
  );
};
