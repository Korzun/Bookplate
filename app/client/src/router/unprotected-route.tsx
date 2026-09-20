import { Navigate, Outlet, useLocation } from 'react-router';

import { useUsername } from '../provider/auth';
import * as path from './path-internal';

export const UnprotectedRoute = () => {
  const [username, loading] = useUsername();
  const location = useLocation();
  if (loading === true) {
    return <div>loading...</div>;
  }
  // `from` is the FULL location `ProtectedRoute` redirected here with
  // (`state={{ from: location }}`) — pathname AND search. Rebuilding the
  // destination from `pathname` alone (I2, whole-branch review) silently
  // dropped a `?code=` a second time: an emailed verification link
  // (`/set-email?code=...`) followed while signed out bounces through here
  // on the way back from `/login`, and the code must survive both hops for
  // the link to land anywhere useful.
  const from = location.state?.from;
  const destination = from ? `${from.pathname}${from.search ?? ''}` : path.home();
  return username ? <Navigate to={destination} replace /> : <Outlet />;
};
