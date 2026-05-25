import { Navigate, Outlet, useLocation } from 'react-router-dom';

import { useUsername } from '../provider/auth';

import * as path from './path-internal';

export const ProtectedRoute = () => {
  const [username, loading] = useUsername();
  const location = useLocation();
  if (loading === true) {
    return <div>loading...</div>;
  }
  return username ? <Outlet /> : <Navigate to={path.login()} state={{ from: location }} replace />;
};
