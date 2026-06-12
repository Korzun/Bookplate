import { BrowserRouter, Navigate, Route, Routes } from 'react-router-dom';

import {
  BookEditPage,
  BookPage,
  LibraryPage,
  LoginPage,
  PasswordResetPage,
  SeriesPage,
  UploadPage,
  UserListPage,
  UserPage,
} from '~/page';

import * as path from './path-internal';
import * as pathKey from './path-key-internal';
import { ProtectedRoute } from './protected-route';
import { UnprotectedRoute } from './unprotected-route';

export const AppRouter = () => {
  return (
    <BrowserRouter>
      <Routes>
        <Route element={<UnprotectedRoute />}>
          <Route path={path.login()} element={<LoginPage />} />
        </Route>

        <Route element={<ProtectedRoute />}>
          <Route path={path.library()} element={<LibraryPage />} />
          <Route path={path.upload()} element={<UploadPage />} />
          <Route path={path.series(pathKey.seriesName)} element={<SeriesPage />} />
          <Route path={path.book(pathKey.bookId)} element={<BookPage />} />
          <Route path={path.bookEdit(pathKey.bookId)} element={<BookEditPage />} />
          <Route path={path.user()} element={<UserPage />} />
          <Route path={path.userList()} element={<UserListPage />} />
          <Route path={path.passwordReset()} element={<PasswordResetPage />} />
          <Route path="*" element={<Navigate to={path.library()} replace />} />
        </Route>
      </Routes>
    </BrowserRouter>
  );
};
