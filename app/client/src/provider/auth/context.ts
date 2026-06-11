import { createContext } from 'react';

export interface AuthContext {
  /** Set iff a valid, unexpired token is present. */
  username: string | undefined;
  /** Surrogate user ID from the token's sub claim. Unset for the admin. */
  userId: string | undefined;
  isAdmin: boolean;
  mustChangePassword: boolean;
  /** True only during the mount-time silent-refresh attempt. */
  loading: boolean;
}

export const Context = createContext<AuthContext>({
  username: undefined,
  userId: undefined,
  isAdmin: false,
  mustChangePassword: false,
  loading: true,
});
