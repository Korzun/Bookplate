import type { MockedResponse } from '@apollo/client/testing';
import { screen, within } from '@testing-library/react';
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
    // SCOPED to the card, via the same marker-`div` isolation the
    // email-disabled test below uses. A bare `findByText(/confirmed/i)` on
    // `screen` matched TWO nodes — this card's own `Confirmed` badge and the
    // `Email confirmed` success toast `ToastProvider` renders as a sibling —
    // and which of those was on screen depended on whether the toast had
    // auto-dismissed yet, so it failed only under full-suite load. Scoping
    // excludes the toast portal structurally, rather than relying on a
    // tighter regex that the next toast copy could collide with again.
    renderWithConfig(
      <div data-testid="card">
        <EmailSetting email="ann@example.com" emailVerifiedAt={null} />
      </div>,
      { mocks: [resendMock(), confirmMock('K7M2QX4P')] }
    );
    const card = within(screen.getByTestId('card'));
    await user.click(card.getByRole('button', { name: /resend/i }));
    await user.type(await card.findByPlaceholderText(/code/i), 'K7M2QX4P');
    await user.click(card.getByRole('button', { name: /confirm/i }));
    expect(await card.findByText(/confirmed/i)).toBeInTheDocument();
  });

  it('changes the address and warns that it needs confirming again', async () => {
    const user = userEvent.setup();
    const { container } = renderWithConfig(
      <EmailSetting email="old@example.com" emailVerifiedAt={new Date()} />,
      { mocks: [setEmailMock('new@example.com')] }
    );
    await user.click(screen.getByRole('button', { name: /change/i }));
    // Queried by `name` rather than placeholder: the edit field now carries a
    // label instead, matching the change-password card's fields (whose own
    // tests query the same way).
    const emailInput = container.querySelector('input[name="email"]') as HTMLInputElement;
    await user.clear(emailInput);
    await user.type(emailInput, 'new@example.com');
    await user.click(screen.getByRole('button', { name: /save/i }));
    expect(await screen.findByText(/not confirmed/i)).toBeInTheDocument();
  });

  it('renders nothing at all when email is disabled on this server', () => {
    // A text query (`queryByText(/email/i)`) is weaker than the spec's own
    // requirement: a future edit rendering an icon-only chip, a disabled
    // affordance, or an empty bordered card would pass that assertion while
    // still violating "render nothing at all". Wrapping in a marker `div`
    // isolates exactly what `EmailSetting` itself contributes from the
    // standing provider chrome `renderWithApollo` always mounts (`ToastProvider`
    // renders its own toast-list `div` unconditionally, so `container.firstChild`
    // is never literally `null` on this harness even when the component under
    // test renders nothing) — `toBeEmptyDOMElement()` on the marker asserts the
    // real property: zero DOM nodes contributed.
    renderWithConfig(
      <div data-testid="root">
        <EmailSetting email={null} emailVerifiedAt={null} />
      </div>,
      { emailEnabled: false }
    );
    expect(screen.getByTestId('root')).toBeEmptyDOMElement();
  });
});
