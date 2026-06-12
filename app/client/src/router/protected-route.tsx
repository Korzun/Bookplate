import { Navigate, Outlet, useLocation } from 'react-router-dom';

import { LoadingPage } from '../page';
import { useMustChangePassword, useUsername } from '../provider/auth';

import * as path from './path-internal';

export const ProtectedRoute = () => {
  const [username, loading] = useUsername();
  const [mustChangePassword] = useMustChangePassword();
  const location = useLocation();
  if (!username && loading === true) {
    return <LoadingPage />;
  }
  if (!username) {
    return <Navigate to={path.login()} state={{ from: location }} replace />;
  }
  if (!mustChangePassword && location.pathname === path.passwordReset()) {
    return <Navigate to={path.home()} replace />;
  }
  if (mustChangePassword && location.pathname !== path.passwordReset()) {
    return <Navigate to={path.passwordReset()} replace />;
  }
  return <Outlet />;
};
