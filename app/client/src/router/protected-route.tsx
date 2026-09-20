import { Navigate, Outlet, useLocation } from 'react-router';

import { LoadingPage } from '../page';
import { useMustChangePassword, useMustSetEmail, useUsername } from '../provider/auth';
import * as path from './path-internal';

export const ProtectedRoute = () => {
  const [username, loading] = useUsername();
  const [mustChangePassword] = useMustChangePassword();
  const [mustSetEmail] = useMustSetEmail();
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
  // AFTER the password redirect, deliberately: a new account owes both, and
  // choosing a password comes first. Also mirrors the server, where
  // passwordChangeGate is mounted ahead of emailSetupGate, and the
  // `emailSetupAllowed` GraphQL scope requires `!mustChangePassword`.
  //
  // Gated on `!mustChangePassword`: without this guard, a viewer who owes
  // both lands on /password-reset via the block above, re-renders there,
  // and this block's own `mustSetEmail && pathname !== setEmail()` check
  // fires on that very pathname — bouncing them straight to /set-email,
  // whose redirect-back-on-mustChangePassword-owed-nothing case doesn't
  // exist, so the two blocks ping-pong forever.
  if (!mustChangePassword) {
    if (!mustSetEmail && location.pathname === path.setEmail()) {
      return <Navigate to={path.home()} replace />;
    }
    if (mustSetEmail && location.pathname !== path.setEmail()) {
      return <Navigate to={path.setEmail()} replace />;
    }
  }
  return <Outlet />;
};
