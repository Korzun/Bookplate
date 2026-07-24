import { Navigate, Outlet, useLocation } from 'react-router';

import { useUsername } from '../provider/auth';
import * as path from './path-internal';

export const UnprotectedRoute = () => {
  const [username, loading] = useUsername();
  const location = useLocation();
  if (loading === true) {
    return <div>loading...</div>;
  }
  const destination = location.state?.from?.pathname ?? path.home();
  return username ? <Navigate to={destination} replace /> : <Outlet />;
};
