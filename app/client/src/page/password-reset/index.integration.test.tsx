import { screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { UserChangePasswordDocument } from '~/graphql/user';
import { renderWithApollo } from '~/test-utils';

import { PasswordResetPage } from './index';

// Corrected in the end-of-project doc sweep; the previous version of this
// header was wrong twice over and worth recording, because both errors are
// the kind that make a test look stronger than it is.
//
// 1. It said this file "deliberately does NOT mock `~/provider/user` the way
//    index.test.tsx does". `~/provider/user` no longer exists (Task 2
//    dissolved it) and `index.test.tsx` never mocked it: that file already
//    renders the REAL page over the REAL hook with a `UserChangePassword`
//    mock, exactly as this one does. The two files are near-duplicates
//    today. This one is kept for its no-other-mocks-in-scope framing below,
//    not because the other is a stubbed weaker cousin.
//
// 2. It claimed `MockLink` "throws on any unmatched request", so a
//    newly-grown `useQuery` dependency would fail this test the moment it
//    fired unmocked. MEASURED false — see `test-utils.tsx`'s standing note:
//    MockLink `console.warn`s and errors ASYNCHRONOUSLY, and nothing
//    promotes that to a failure. A new `useQuery` on this page would NOT
//    redden this file on its own. What this file does still prove is the
//    positive path: the page renders and completes a password change with
//    only the mutation mock in scope.
//
// The framing that survives: the forced-reset page is where `ProtectedRoute`
// sends every `mustChangePassword` viewer, and it is the one path in the app
// that must render and submit with no prior GraphQL query of any kind —
// every `Query` field is gated on `authenticated`, which is false for a
// forced-reset viewer. (That claim used to cite `use-change-my-password.ts`
// and its test; Task 2 dissolved `provider/user` and inlined the mutation —
// the reasoning now lives on `./index.tsx`'s own doc comment and on
// `graphql/user.ts`'s `UserChangePasswordDocument`.)
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
