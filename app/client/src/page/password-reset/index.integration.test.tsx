import { screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { UserChangePasswordDocument } from '~/graphql/user';
import { renderWithApollo } from '~/test-utils';

import { PasswordResetPage } from './index';

// Deliberately does NOT mock `~/provider/user` the way index.test.tsx does —
// that file replaces the module wholesale, so it never actually exercises
// `useChangeMyPassword` or Apollo at all. This file renders the REAL page
// over the REAL hook, with ONLY the `UserChangePassword` mutation mock in
// scope.
//
// The forced-reset page is where `ProtectedRoute` sends every
// `mustChangePassword` viewer, and it is the one path in the app that must
// render and submit with no prior GraphQL query of any kind: every `Query`
// field is gated on `authenticated`, which is false for a forced-reset
// viewer (see `use-change-my-password.ts`'s doc comment and
// `use-change-my-password.test.tsx:200-218`). `MockLink` throws on any
// unmatched request (see `device-form/index.test.tsx`'s `captureVariables`
// comment for the same property), so if the page or the hook ever grows a
// `useQuery` dependency, this test fails the moment that query fires with no
// mock to satisfy it — a regression the mocked-hook test cannot catch.
describe('PasswordResetPage (real Apollo hook, no query mocks in scope)', () => {
  beforeEach(() => {
    Object.defineProperty(window, 'location', {
      value: { href: '' },
      writable: true,
      configurable: true,
    });
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    localStorage.clear();
  });

  it('completes a real password change with no other GraphQL mock in scope', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({ ok: true }));
    const user = userEvent.setup();

    renderWithApollo(<PasswordResetPage />, {
      mocks: [
        {
          request: {
            query: UserChangePasswordDocument,
            variables: { input: { currentPassword: 'old', newPassword: 'newpass' } },
          },
          result: {
            data: {
              __typename: 'Mutation' as const,
              userChangePassword: {
                __typename: 'UserChangePasswordPayload' as const,
                user: { __typename: 'User' as const, id: 'u1' },
              },
            },
          },
        },
      ],
    });

    await user.type(screen.getByPlaceholderText('Current Password'), 'old');
    await user.type(screen.getByPlaceholderText('New Password'), 'newpass');
    await user.type(screen.getByPlaceholderText('Confirm New Password'), 'newpass');
    await user.click(screen.getByRole('button', { name: 'Change password' }));

    await waitFor(() => expect(window.location.href).toBe('/login'));
  });
});
