import { useMutation } from '@apollo/client/react';
import { useCallback, useMemo, useState } from 'react';

import type { UserChangePasswordMutation } from '~/gql/graphql';
import { UserChangePasswordDocument } from '~/graphql/user';
import { logout as performLogout } from '~/lib/logout';
import { unwrapResult } from '~/provider/apollo';

// `unwrapResult`'s `TPayload` sits in a position TypeScript cannot infer from
// the call, so it is named explicitly here, extracted from the generated
// union rather than hand-duplicated.
type UserChangePasswordPayload = Extract<
  NonNullable<UserChangePasswordMutation['userChangePassword']>,
  { __typename: 'UserChangePasswordPayload' }
>;

export type ChangeMyPassword = (currentPassword: string, newPassword: string) => Promise<boolean>;
export type UseChangeMyPassword =
  | [ChangeMyPassword, false, false, false, undefined] // Initial
  | [ChangeMyPassword, true, false, false, undefined] // Changing
  | [ChangeMyPassword, false, true, false, undefined] // Changed successfully (logging out)
  | [ChangeMyPassword, false, false, true, undefined] // Unspecified error
  | [ChangeMyPassword, false, false, true, string]; // Specified error

/**
 * **The silent-logout contract.** `userChangePassword` revokes every one of
 * the caller's refresh tokens as its own side effect (server doc comment,
 * `change-password.ts`), and a GraphQL context has no `Response` to reissue
 * auth cookies on even if it wanted to. So a successful call here must never
 * "continue the session" — it logs the caller out and sends them to
 * `/login`, unconditionally.
 *
 * This calls the same shared `logout()` helper (`~/lib/logout`) that the
 * explicit "log out" button's `useLogout` hook delegates to — not the hook
 * itself, since this is already inside a hook and the two have nothing else
 * to share. That helper is unconditionally best-effort: it swallows a
 * failed `POST /api/auth/logout`, then arms the one-shot "skip the next
 * silent refresh" mark, clears the local token, and navigates to `/login`
 * regardless. That is exactly right here — the server has ALREADY revoked
 * every refresh token for this account before this code runs, so staying
 * logged in on a failed POST was never an option — and it is why this hook
 * has nothing left to do after the mutation succeeds but call it.
 *
 * **No client-side pre-check for empty fields.** The REST hook this replaces
 * short-circuited on `!currentPassword || !newPassword` with the same
 * message the server now returns as `InvalidInputError`. Per the precedent
 * set migrating `useResetUserPassword` (task 6), duplicate client-side
 * validation is dropped in favour of the server's typed error: both call
 * sites (`UserChangePassword`, `PasswordResetPage`) already disable their
 * submit button while any of the three fields is empty, so the removed
 * check could only ever fire on a submission the UI itself prevents — it
 * protected nothing a disabled button didn't already cover, and duplicating
 * the server's own validation message client-side is one more place for the
 * two to drift apart.
 *
 * `InvalidInputError` and `IncorrectPasswordError` both flow through
 * `unwrapResult`'s generic `error` branch into `errorMessage` as flat text —
 * see `graphql/user.ts`'s doc comment on `UserChangePasswordDocument` for why
 * `issues` is not selected: neither call site attaches a per-field error to
 * an individual input today, so there is nothing for a wider tuple to feed.
 * The two error kinds are still distinguishable to the user because their
 * messages differ ("Current password is incorrect" vs "Invalid input").
 * Importantly, either one sets `error` (not `okay`), so neither one triggers
 * the logout below — only the payload branch does.
 */
export const useChangeMyPassword = (): UseChangeMyPassword => {
  const [runChangePassword] = useMutation(UserChangePasswordDocument);
  const [loading, setLoading] = useState<boolean>(false);
  const [okay, setOkay] = useState<boolean>(false);
  const [error, setError] = useState<boolean>(false);
  const [errorMessage, setErrorMessage] = useState<string | undefined>();

  const changeMyPassword = useCallback(
    async (currentPassword: string, newPassword: string) => {
      try {
        setLoading(true);
        setOkay(false);
        setError(false);
        setErrorMessage(undefined);

        const { data } = await runChangePassword({
          variables: { input: { currentPassword, newPassword } },
        });

        const result = unwrapResult<UserChangePasswordPayload>(
          data?.userChangePassword,
          'UserChangePasswordPayload'
        );
        if (result.status === 'missing') {
          setError(true);
          setErrorMessage('Password change failed');
          return false;
        }
        if (result.status === 'error') {
          setError(true);
          setErrorMessage(result.message);
          return false;
        }

        setOkay(true);

        // Same best-effort teardown as the logout button, via the one shared
        // helper — the password has already changed by this point, so the
        // session must end whether or not the cookie clear succeeds.
        await performLogout();

        return true;
      } catch (err) {
        setError(true);
        setErrorMessage(err instanceof Error ? err.message : 'Password change failed');
        return false;
      } finally {
        setLoading(false);
      }
    },
    [runChangePassword]
  );

  return useMemo(
    () => [changeMyPassword, loading, okay, error, errorMessage] as UseChangeMyPassword,
    [changeMyPassword, loading, okay, error, errorMessage]
  );
};
