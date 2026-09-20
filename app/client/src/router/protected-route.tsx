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
  // `emailSetupAllowed` GraphQL scope requires `!mustChangePassword`. This
  // ordering is load-bearing on three surfaces (this route, the server's gate
  // mount order, and `emailSetupAllowed`), and it applies REGARDLESS of the
  // `?code=` handling below — a pending password change wins even when the
  // viewer followed an emailed verification link (I2, whole-branch review).
  //
  // Gated on `!mustChangePassword`: without this guard, a viewer who owes
  // both lands on /password-reset via the block above, re-renders there,
  // and this block's own `mustSetEmail && pathname !== setEmail()` check
  // fires on that very pathname — bouncing them straight to /set-email,
  // whose redirect-back-on-mustChangePassword-owed-nothing case doesn't
  // exist, so the two blocks ping-pong forever.
  //
  // `hasEmailCode` (I2): the verification email always links to
  // `/set-email?code=...` (`services/mail-template.ts`), but `mustSetEmail`
  // only tracks an UNSET address — changing an address from the settings
  // card writes it immediately, so that viewer is never gated, and their
  // emailed link would otherwise always bounce home before the code field
  // ever rendered. A `?code=` lets `/set-email` render for a non-gated
  // viewer too, so the link lands somewhere useful either way.
  const hasEmailCode = new URLSearchParams(location.search).has('code');
  if (!mustChangePassword) {
    if (!mustSetEmail && location.pathname === path.setEmail() && !hasEmailCode) {
      return <Navigate to={path.home()} replace />;
    }
    if (mustSetEmail && location.pathname !== path.setEmail()) {
      return <Navigate to={path.setEmail()} replace />;
    }
  }
  return <Outlet />;
};
