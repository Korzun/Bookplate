import { screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeAll, describe, expect, it } from 'vitest';

import { UserResetPasswordDocument } from '~/graphql/user';
import { renderWithApollo } from '~/test-utils';

import { ResetPasswordButton } from './index';

beforeAll(() => {
  HTMLDialogElement.prototype.showModal = () => {};
  HTMLDialogElement.prototype.close = () => {};
  Object.assign(navigator, { clipboard: { writeText: () => Promise.resolve() } });
});

const resetSuccessMock = {
  request: { query: UserResetPasswordDocument, variables: { input: { userId: 'u1' } } },
  result: {
    data: {
      __typename: 'Mutation' as const,
      userResetPassword: {
        __typename: 'UserResetPasswordPayload' as const,
        user: { __typename: 'User' as const, id: 'u1' },
        password: 'k4tWc9pLxQ2mAbCd',
      },
    },
  },
};

describe('ResetPasswordButton', () => {
  it('shows a confirm modal, then reveals the new password on confirm', async () => {
    const user = userEvent.setup();

    renderWithApollo(<ResetPasswordButton userId="u1" username="alice" />, {
      mocks: [resetSuccessMock],
    });

    await user.click(screen.getByRole('button', { name: 'Reset password' }));
    expect(screen.getByText(/Reset password for/)).toBeInTheDocument();

    // Both the trigger button and the modal's confirm button are labeled
    // "Reset password" — the confirm button is the last one in document order.
    const resetButtons = screen.getAllByRole('button', { name: 'Reset password', hidden: true });
    await user.click(resetButtons[resetButtons.length - 1]);

    await waitFor(() =>
      expect(
        screen.getByText((_, el) => el?.textContent === 'k4tWc9pLxQ2mAbCd')
      ).toBeInTheDocument()
    );
  });

  it('shows an error toast when the reset fails', async () => {
    const user = userEvent.setup();

    renderWithApollo(<ResetPasswordButton userId="u1" username="alice" />, {
      mocks: [
        {
          request: { query: UserResetPasswordDocument, variables: { input: { userId: 'u1' } } },
          result: { data: { __typename: 'Mutation' as const, userResetPassword: null } },
        },
      ],
    });

    await user.click(screen.getByRole('button', { name: 'Reset password' }));
    const resetButtons = screen.getAllByRole('button', { name: 'Reset password', hidden: true });
    await user.click(resetButtons[resetButtons.length - 1]);

    await waitFor(() => expect(screen.getByText(/Failed to reset password/)).toBeInTheDocument());
  });
});
