import type { MockedResponse } from '@apollo/client/testing';
import { screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';

import type {
  ViewerConfirmEmailMutation,
  ViewerConfirmEmailMutationVariables,
  ViewerResendEmailVerificationMutation,
  ViewerSetEmailMutation,
  ViewerSetEmailMutationVariables,
} from '~/gql/graphql';
import {
  ViewerConfirmEmailDocument,
  ViewerResendEmailVerificationDocument,
  ViewerSetEmailDocument,
} from '~/graphql/email';
import * as apiFetch from '~/lib/api-fetch';
import { renderWithApollo } from '~/test-utils';

import { SetEmailPage } from './index';

const setEmailMock = (
  email: string
): MockedResponse<ViewerSetEmailMutation, ViewerSetEmailMutationVariables> => ({
  request: {
    query: ViewerSetEmailDocument,
    variables: { input: { email } },
  },
  result: {
    data: {
      __typename: 'Mutation',
      viewerSetEmail: {
        __typename: 'ViewerSetEmailPayload',
        email,
        delivered: true,
      },
    },
  },
});

const confirmEmailMock = (
  code: string
): MockedResponse<ViewerConfirmEmailMutation, ViewerConfirmEmailMutationVariables> => ({
  request: {
    query: ViewerConfirmEmailDocument,
    variables: { input: { code } },
  },
  result: {
    data: {
      __typename: 'Mutation',
      viewerConfirmEmail: {
        __typename: 'ViewerConfirmEmailPayload',
        email: 'ann@example.com',
      },
    },
  },
});

// `delivered: false`, deliberately — the initial `setEmailMock` above already
// toasts a `delivered: true` "Check your inbox" message, which would make a
// `delivered: true` resend indistinguishable from that leftover toast and
// defeat the point of the test below.
const resendMock = (): MockedResponse<ViewerResendEmailVerificationMutation> => ({
  request: { query: ViewerResendEmailVerificationDocument },
  result: {
    data: {
      __typename: 'Mutation',
      viewerResendEmailVerification: {
        __typename: 'ViewerResendEmailVerificationPayload',
        delivered: false,
      },
    },
  },
});

const resendNetworkErrorMock = (): MockedResponse<ViewerResendEmailVerificationMutation> => ({
  request: { query: ViewerResendEmailVerificationDocument },
  error: new Error('network down'),
});

const emailInUseMock = (
  email: string
): MockedResponse<ViewerSetEmailMutation, ViewerSetEmailMutationVariables> => ({
  request: {
    query: ViewerSetEmailDocument,
    variables: { input: { email } },
  },
  result: {
    data: {
      __typename: 'Mutation',
      viewerSetEmail: {
        __typename: 'EmailInUseError',
        message: 'That address is already in use',
      },
    },
  },
});

describe('SetEmailPage', () => {
  it('saves an address and then asks for the code', async () => {
    const user = userEvent.setup();
    renderWithApollo(<SetEmailPage />, { mocks: [setEmailMock('ann@example.com')] });

    await user.type(screen.getByPlaceholderText('Email address'), 'ann@example.com');
    await user.click(screen.getByRole('button', { name: /send/i }));

    expect(await screen.findByPlaceholderText(/code/i)).toBeInTheDocument();
  });

  it('refreshes the access token after confirming, so the gate lifts at once', async () => {
    const user = userEvent.setup();
    const refresh = vi.fn().mockResolvedValue(true);
    vi.spyOn(apiFetch, 'refreshAccessToken').mockImplementation(refresh);
    renderWithApollo(<SetEmailPage />, {
      mocks: [setEmailMock('ann@example.com'), confirmEmailMock('K7M2QX4P')],
    });

    await user.type(screen.getByPlaceholderText('Email address'), 'ann@example.com');
    await user.click(screen.getByRole('button', { name: /send/i }));
    await user.type(await screen.findByPlaceholderText(/code/i), 'K7M2QX4P');
    await user.click(screen.getByRole('button', { name: /confirm/i }));

    // Without this the viewer stays gated for up to 15 minutes on a claim that is
    // already stale. Note it does NOT log out — unlike the forced-password page,
    // nothing here revokes a refresh token.
    await waitFor(() => expect(refresh).toHaveBeenCalled());
  });

  it('shows the error message when the address is already in use', async () => {
    const user = userEvent.setup();
    renderWithApollo(<SetEmailPage />, { mocks: [emailInUseMock('shared@example.com')] });

    await user.type(screen.getByPlaceholderText('Email address'), 'shared@example.com');
    await user.click(screen.getByRole('button', { name: /send/i }));

    expect(await screen.findByText(/already in use/i)).toBeInTheDocument();
  });

  // Minor (whole-branch review): `onClick={() => void runResend()}` discarded
  // the mutation's result outright — no toast on success, cooldown or
  // failure, so "Resend code" silently did nothing from the caller's point of
  // view. Mirrors `component/email-setting`'s own resend handler, which
  // already unwraps the result and toasts it.
  it('shows a toast when resending the code, mirroring the settings card', async () => {
    const user = userEvent.setup();
    renderWithApollo(<SetEmailPage />, {
      mocks: [setEmailMock('ann@example.com'), resendMock()],
    });

    await user.type(screen.getByPlaceholderText('Email address'), 'ann@example.com');
    await user.click(screen.getByRole('button', { name: /send/i }));
    await user.click(await screen.findByRole('button', { name: /resend/i }));

    expect(await screen.findByText(/could not send the email/i)).toBeInTheDocument();
  });

  // Final touch-up (whole-branch review): `handleResend` had no `try/catch`,
  // unlike `component/email-setting`'s equivalent it mirrors — an Apollo
  // throw on a network failure produced an unhandled promise rejection and
  // STILL showed no toast, the exact silent failure the resend-toast minor
  // above existed to fix.
  it('shows an error toast when resending throws, rather than failing silently', async () => {
    const user = userEvent.setup();
    renderWithApollo(<SetEmailPage />, {
      mocks: [setEmailMock('ann@example.com'), resendNetworkErrorMock()],
    });

    await user.type(screen.getByPlaceholderText('Email address'), 'ann@example.com');
    await user.click(screen.getByRole('button', { name: /send/i }));
    await user.click(await screen.findByRole('button', { name: /resend/i }));

    expect(await screen.findByText(/could not resend the code/i)).toBeInTheDocument();
  });

  it('prefills the code from the ?code= query parameter', async () => {
    renderWithApollo(<SetEmailPage />, {
      mocks: [],
      initialEntries: ['/set-email?code=K7M2QX4P'],
    });
    expect(await screen.findByDisplayValue('K7M2QX4P')).toBeInTheDocument();
  });
});
