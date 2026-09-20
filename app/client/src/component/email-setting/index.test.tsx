import type { MockedResponse } from '@apollo/client/testing';
import { screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import type { ReactElement } from 'react';
import { describe, expect, it } from 'vitest';

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
import { ConfigContext } from '~/provider/config';
import { renderWithApollo } from '~/test-utils';

import { EmailSetting } from './index';

// `renderWithApollo` has no `emailEnabled` option of its own — the
// established pattern for varying `useEmailEnabled()` in a test is a thin
// local wrapper around `ConfigContext.Provider`, the same shape
// `page/login/index.test.tsx`'s own `renderWithConfig` already uses.
function renderWithConfig(
  ui: ReactElement,
  { mocks = [], emailEnabled = true }: { mocks?: MockedResponse[]; emailEnabled?: boolean } = {}
) {
  return renderWithApollo(
    <ConfigContext.Provider value={{ libraryName: 'Bookplate', emailEnabled }}>
      {ui}
    </ConfigContext.Provider>,
    { mocks }
  );
}

const resendMock = (): MockedResponse<ViewerResendEmailVerificationMutation> => ({
  request: { query: ViewerResendEmailVerificationDocument },
  result: {
    data: {
      __typename: 'Mutation',
      viewerResendEmailVerification: {
        __typename: 'ViewerResendEmailVerificationPayload',
        delivered: true,
      },
    },
  },
});

const confirmMock = (
  code: string
): MockedResponse<ViewerConfirmEmailMutation, ViewerConfirmEmailMutationVariables> => ({
  request: { query: ViewerConfirmEmailDocument, variables: { input: { code } } },
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

const setEmailMock = (
  email: string
): MockedResponse<ViewerSetEmailMutation, ViewerSetEmailMutationVariables> => ({
  request: { query: ViewerSetEmailDocument, variables: { input: { email } } },
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

describe('EmailSetting', () => {
  it('shows the address with a confirmed badge', () => {
    renderWithConfig(<EmailSetting email="ann@example.com" emailVerifiedAt={new Date()} />);
    expect(screen.getByText('ann@example.com')).toBeInTheDocument();
    expect(screen.getByText(/confirmed/i)).toBeInTheDocument();
  });

  it('offers a resend when the address is unconfirmed', async () => {
    const user = userEvent.setup();
    renderWithConfig(<EmailSetting email="ann@example.com" emailVerifiedAt={null} />, {
      mocks: [resendMock()],
    });
    expect(screen.getByText(/not confirmed/i)).toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: /resend/i }));
    expect(await screen.findByText(/check your inbox/i)).toBeInTheDocument();
  });

  it('accepts a code inline once one has been sent', async () => {
    const user = userEvent.setup();
    renderWithConfig(<EmailSetting email="ann@example.com" emailVerifiedAt={null} />, {
      mocks: [resendMock(), confirmMock('K7M2QX4P')],
    });
    await user.click(screen.getByRole('button', { name: /resend/i }));
    await user.type(await screen.findByPlaceholderText(/code/i), 'K7M2QX4P');
    await user.click(screen.getByRole('button', { name: /confirm/i }));
    expect(await screen.findByText(/confirmed/i)).toBeInTheDocument();
  });

  it('changes the address and warns that it needs confirming again', async () => {
    const user = userEvent.setup();
    renderWithConfig(<EmailSetting email="old@example.com" emailVerifiedAt={new Date()} />, {
      mocks: [setEmailMock('new@example.com')],
    });
    await user.click(screen.getByRole('button', { name: /change/i }));
    await user.clear(screen.getByPlaceholderText('Email address'));
    await user.type(screen.getByPlaceholderText('Email address'), 'new@example.com');
    await user.click(screen.getByRole('button', { name: /save/i }));
    expect(await screen.findByText(/not confirmed/i)).toBeInTheDocument();
  });

  it('renders nothing at all when email is disabled on this server', () => {
    renderWithConfig(<EmailSetting email={null} emailVerifiedAt={null} />, {
      emailEnabled: false,
    });
    expect(screen.queryByText(/email/i)).toBeNull();
  });
});
