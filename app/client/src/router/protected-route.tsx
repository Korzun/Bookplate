import { Navigate, Outlet, useLocation } from 'react-router-dom';

import { useMustChangePassword, useUsername } from '../provider/auth';

import * as path from './path-internal';

export const ProtectedRoute = () => {
  const [username, loading] = useUsername();
  const [mustChangePassword] = useMustChangePassword();
  const location = useLocation();
  if (loading === true) {
    return <div>loading...</div>;
  }
  if (!username) {
    return <Navigate to={path.login()} state={{ from: location }} replace />;
  }
  if (mustChangePassword && location.pathname !== path.user()) {
    return <Navigate to={path.user()} replace />;
  }
  return <Outlet />;
};
