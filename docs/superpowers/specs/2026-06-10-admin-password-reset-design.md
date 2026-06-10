# Design: Admin Password Reset

**Date:** 2026-06-10
**Status:** Approved

## Problem

After [splitting login and sync passwords](./2026-06-09-sync-password-split-design.md), every existing user's `passwordHash` was force-reset to `null`. There is currently no way for an admin to give a user a new login password short of deleting and re-creating their account (which also discards their reading progress and sync password). Admins need a way to set a new login password for any user directly.

## Solution

Add an admin-only "Reset password" action per user. The server generates a strong random password, hashes it, and stores it as the user's new `passwordHash`. The plaintext password is returned once to the admin to relay to the user. The user is required to change this password on their next login (`mustChangePassword` flag), after which the flag clears automatically.

## Data Model

```prisma
model User {
  username           String     @id
  passwordHash       String?    @map("password_hash")
  syncPassword       String?    @map("sync_password")
  mustChangePassword Boolean    @default(false) @map("must_change_password")
  progresses         Progress[]

  @@map("users")
}
```

### Migration

New migration `add_must_change_password`:

```sql
-- Add must_change_password flag to users.
-- Set to true when an admin resets a user's password; cleared when the
-- user successfully changes their own password.
ALTER TABLE "users" ADD COLUMN "must_change_password" BOOLEAN NOT NULL DEFAULT 0;
```

A simple `ALTER TABLE ADD COLUMN` with a constant default is valid SQLite and requires no table redefinition (see `0003_add_book_id_history_type` for precedent).

## Server

### `UserStore` changes (`app/server/services/user-store.ts`)

| Method | Change |
|--------|--------|
| `generateLoginPassword()` | New static — returns a 16-character random password drawn from an unambiguous alphanumeric charset (excludes `0`, `O`, `1`, `l`, `I`), using `crypto.randomInt` for unbiased selection |
| `resetPassword(username)` | New async — generates a password via `generateLoginPassword()`, hashes it with `hashLoginPassword()`, sets `passwordHash` and `mustChangePassword: true`. Returns the plaintext password, or `null` if the user doesn't exist |
| `changePassword(username, passwordHash)` | Updated — also sets `mustChangePassword: false` (clears the flag once the user sets their own password) |
| `getMustChangePassword(username)` | New async — returns the user's `mustChangePassword` flag (`false` if user not found), used at login to populate the session |

```typescript
const LOGIN_PASSWORD_CHARSET = 'ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz23456789';
const LOGIN_PASSWORD_LENGTH = 16;

static generateLoginPassword(): string {
  let password = '';
  for (let i = 0; i < LOGIN_PASSWORD_LENGTH; i++) {
    password += LOGIN_PASSWORD_CHARSET[crypto.randomInt(LOGIN_PASSWORD_CHARSET.length)];
  }
  return password;
}

async resetPassword(username: string): Promise<string | null> {
  const password = UserStore.generateLoginPassword();
  const passwordHash = await UserStore.hashLoginPassword(password);
  try {
    await this.prisma.user.update({
      where: { username },
      data: { passwordHash, mustChangePassword: true },
    });
    return password;
  } catch (e) {
    if (e instanceof Prisma.PrismaClientKnownRequestError && e.code === 'P2025') {
      return null;
    }
    throw e;
  }
}

async getMustChangePassword(username: string): Promise<boolean> {
  const row = await this.prisma.user.findUnique({
    where: { username },
    select: { mustChangePassword: true },
  });
  return row?.mustChangePassword ?? false;
}
```

### Session (`app/server/global.d.ts`)

Add `mustChangePassword?: boolean` to `SessionData`.

### Routes

**New: `POST /api/users/:username/reset-password`** (`routes/users.ts`, admin + sessionAuth, alongside the existing user management routes)

- Calls `userStore.resetPassword(username)`.
- `200 { password: string }` on success.
- `404 { error: 'User not found' }` if the user doesn't exist (this also naturally covers the admin's own username, which has no `User` row).

**`POST /api/login`** (`routes/ui.ts`)

- After a successful `validateUser`, set `req.session.mustChangePassword = await userStore.getMustChangePassword(username)`.
- The admin login branch is unaffected (admin has no `User` row; flag stays unset/false).

**`GET /api/me`**

- Response becomes `{ username, isAdmin, mustChangePassword: req.session.mustChangePassword ?? false }`.

**`PATCH /api/my/password`**

- After `changePassword` succeeds, set `req.session.mustChangePassword = false` (kept in sync with the DB update inside `changePassword`).

### New middleware: `requirePasswordChange`

Added to `routes/ui.ts`, applied to all routes. When `req.session.mustChangePassword` is true, blocks API requests except the two routes a user needs to recover:

```typescript
function requirePasswordChange(req: Request, res: Response, next: NextFunction): void {
  if (!req.session.mustChangePassword) {
    next();
    return;
  }
  if (req.path === '/api/me' || req.path === '/api/my/password' || !req.path.startsWith('/api/')) {
    next();
    return;
  }
  res.status(403).json({ error: 'Password change required' });
}
```

- Non-API paths (SPA shell, `/assets/*`) pass through so the client can load and render the change-password prompt.
- `/api/me` and `/api/my/password` pass through so the client can read the flag and submit a new password.
- All other `/api/*` routes are blocked with `403` while the flag is set.

**Placement:** register `router.use(requirePasswordChange)` immediately after the `GET /api/me` route (after line 113) and before `GET /api/config`. `/login`, `/api/login`, `/logout`, and `/api/me` are all defined earlier in the file and are therefore unaffected by registration order; every route defined afterward (including `/api/my/password`, `/assets`, and the SPA catch-all) passes through the middleware and relies on its path checks.

## Client

### Auth provider (`provider/auth`)

- `AuthContext` gains `mustChangePassword: boolean` / `setMustChangePassword`, populated from `/api/me` in `AuthProvider`.
- New hook `useMustChangePassword()` mirrors `useIsAdmin()`.

### Route guard (`router/protected-route.tsx`)

```tsx
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
```

### User page (`page/user`)

- New `style.ts` adds a `banner` style (danger-accented, using `theme.color.danger`/`theme.color.border.danger`, matching existing danger styling conventions).
- When `mustChangePassword` is true, render a banner above `UserChangePassword`: "You must change your password before continuing."
- While `mustChangePassword` is true, hide `SyncPassword` and `MyProgress` (both call `/api/*` endpoints blocked by `requirePasswordChange`) — show only the banner and `UserChangePassword` until the flag clears.
- After a successful self-service password change (`useChangeMyPassword` → `okay`), call `useAuthRefresh()`'s `refetch()` so `mustChangePassword` clears and the banner/hidden cards/redirect lift immediately.

### Admin: Reset password UI

**New hook** `useResetUserPassword()` in `provider/user/hook/use-reset-user-password.ts`:

```typescript
export type ResetUserPassword = (username: string) => Promise<string | null>;
export type UseResetUserPassword =
  | [ResetUserPassword, false, false, undefined] // Initial/ready
  | [ResetUserPassword, true, false, undefined]  // Reset in progress
  | [ResetUserPassword, false, true, undefined]  // Unspecified error
  | [ResetUserPassword, false, true, string];    // Specified error
```

POSTs `/api/users/:username/reset-password`; returns the generated password on success (`null` on error).

**`UserRow`** (`component/user-row`): add a "Reset password" button (`type="link"`) next to "Delete user".

1. Click → `ConfirmModal`:
   > **Reset password for `<username>`?**
   > This generates a new login password and signs them in fresh — they'll be required to change it on their next login. The new password will be shown once; make sure to copy it before closing.
   >
   > [Cancel] [Reset password]
2. On confirm → call `resetUserPassword(username)`.
3. On success → open `PasswordResultModal` displaying the generated password with a **Copy** button (`navigator.clipboard.writeText`, "Copied!" feedback like `SyncPassword`) and a single **Done** button to dismiss.
4. On error → `Toast` with error message.

**New component** `PasswordResultModal` (`control/password-result-modal`): a focused, single-purpose dialog for one-time secret reveal — title, body text, monospace password display, Copy button, Done button. Built on the same `<dialog>`/style conventions as `ConfirmModal` but with a single dismiss action (no cancel/confirm pair).

## Testing

- **Server:** `UserStore.generateLoginPassword` (length/charset), `resetPassword` (sets hash + flag, returns plaintext, `null` for unknown user), `getMustChangePassword`, `changePassword` clears flag. Route tests for `POST /api/users/:username/reset-password` (200/404/403 non-admin), login setting session flag, `/api/me` exposing it, `requirePasswordChange` blocking/allowing the right paths.
- **Client:** `useResetUserPassword` hook test, `UserRow` reset flow (confirm → reveal → copy), `ProtectedRoute` redirect when `mustChangePassword`, `UserPage` banner + clearing after password change.

## Out of Scope

- Admin-specified (custom) passwords — always system-generated.
- Password complexity requirements for self-service changes (unchanged from existing behavior).
- Rate-limiting or audit logging of resets.
- Invalidating the affected user's currently active session — a reset changes `passwordHash` and sets `mustChangePassword`, but an existing logged-in session is unaffected until its next `/api/login`.
