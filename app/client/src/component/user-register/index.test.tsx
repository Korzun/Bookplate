import type { ApolloClient } from '@apollo/client';
import type { MockedResponse } from '@apollo/client/testing';
import { screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it } from 'vitest';

import { UserRowFragment } from '~/component/user-row';
import { useFragment } from '~/gql';
import type { UserRegisterMutation, UserRegisterMutationVariables } from '~/gql/graphql';
import { UserRegisterDocument } from '~/graphql/user';
import { UserListDocument } from '~/graphql/user';
import { ConfigContext } from '~/provider/config';
import { renderWithApollo } from '~/test-utils';

import { UserRegister } from './index';

beforeEach(() => {
  HTMLDialogElement.prototype.showModal = () => {};
  HTMLDialogElement.prototype.close = () => {};
});

const registerSuccessMock = (
  username: string,
  password: string | null,
  { email, onboardingEmailSent = false }: { email?: string; onboardingEmailSent?: boolean } = {}
): MockedResponse<UserRegisterMutation, UserRegisterMutationVariables> => ({
  request: {
    query: UserRegisterDocument,
    variables: { input: email === undefined ? { username } : { username, email } },
  },
  result: {
    data: {
      __typename: 'Mutation',
      userRegister: {
        __typename: 'UserRegisterPayload',
        user: {
          __typename: 'User',
          id: 'u-new',
          username,
          pendingBookRequestCount: 0,
          email: email ?? null,
          emailVerifiedAt: null,
          library: { __typename: 'Library', id: 'lib-new' },
        },
        password,
        onboardingEmailSent,
      },
    },
  },
});

const conflictMock = (
  username: string
): MockedResponse<UserRegisterMutation, UserRegisterMutationVariables> => ({
  request: { query: UserRegisterDocument, variables: { input: { username } } },
  result: {
    data: {
      __typename: 'Mutation',
      userRegister: {
        __typename: 'UsernameAlreadyExistsError',
        message: 'Username already exists',
      },
    },
  },
});

/** Seeds an empty `UserList` read, mirroring the cache state before any user
 * exists — the append's starting point. */
const seedEmptyUserList = (client: ApolloClient) =>
  client.writeQuery({
    query: UserListDocument,
    data: { __typename: 'Query', viewer: { __typename: 'Viewer', users: [] } },
  });

function renderForm(mocks: MockedResponse[] = [], { onboardingEnabled = false } = {}) {
  const rendered = renderWithApollo(
    <ConfigContext.Provider
      value={{ libraryName: 'Bookplate', emailEnabled: true, onboardingEnabled }}
    >
      <UserRegister />
    </ConfigContext.Provider>,
    { mocks }
  );
  seedEmptyUserList(rendered.client);
  const usernameInput = rendered.container.querySelector(
    'input[name="username"]'
  ) as HTMLInputElement;
  const emailInput = rendered.container.querySelector(
    'input[name="email"]'
  ) as HTMLInputElement | null;
  return { ...rendered, usernameInput, emailInput };
}

describe('UserRegister', () => {
  it('renders the card titled "Register new user"', () => {
    renderForm();
    expect(screen.getByText('Register new user')).toBeInTheDocument();
  });

  it('keeps Register disabled until the username has at least 6 characters', async () => {
    const user = userEvent.setup();
    const { usernameInput } = renderForm();
    const button = screen.getByRole('button', { name: 'Register' });

    expect(button).toBeDisabled();
    await user.type(usernameInput, 'abc');
    expect(button).toBeDisabled();
    await user.type(usernameInput, 'def'); // now "abcdef" (6 chars)
    expect(button).toBeEnabled();
  });

  it('registers via the form and shows the password result', async () => {
    const user = userEvent.setup();
    const { usernameInput } = renderForm([registerSuccessMock('bobuser', 'newpassword')]);

    await user.type(usernameInput, 'bobuser');
    await user.click(screen.getByRole('button', { name: 'Register' }));

    await waitFor(() => expect(screen.getByText('newpassword')).toBeInTheDocument());
  });

  // The task's real content: a returned entity does not insert itself into a
  // list, so this proves the `cache.modify` append actually ran, by reading
  // the cache directly rather than re-mocking UserList.
  it('appends the registered user to a subsequent UserList cache read', async () => {
    const user = userEvent.setup();
    const { client, usernameInput } = renderForm([registerSuccessMock('bobuser', 'newpassword')]);

    await user.type(usernameInput, 'bobuser');
    await user.click(screen.getByRole('button', { name: 'Register' }));

    await waitFor(() => expect(screen.getByText('newpassword')).toBeInTheDocument());
    const cached = client.readQuery({ query: UserListDocument });
    const unmasked = useFragment(UserRowFragment, cached?.viewer.users ?? []);
    expect(unmasked.map((u) => u.username)).toEqual(['bobuser']);
  });

  it('surfaces the server-specific error toast and does not open the modal when registration fails', async () => {
    const user = userEvent.setup();
    const { usernameInput } = renderForm([conflictMock('baduser')]);

    await user.type(usernameInput, 'baduser');
    await user.click(screen.getByRole('button', { name: 'Register' }));

    expect(await screen.findByRole('status')).toHaveTextContent('Username already exists');
    expect(screen.queryByText('newpassword')).not.toBeInTheDocument();
  });

  // The Register button is a native <button> in submit mode, which shrink-wraps
  // its label instead of filling the card the way a div does. The form's flex
  // column is what stretches it back across the card, level with the field.
  it('lays the form out as a column so Register spans the card', () => {
    const { container } = renderForm();
    const style = getComputedStyle(container.querySelector('form') as HTMLElement);
    expect(style.display).toBe('flex');
    expect(style.flexDirection).toBe('column');
  });
});

// The server's uniform `emailInUseError()` message, verbatim.
const EMAIL_IN_USE =
  'That email address is already in use by another account. Ask your administrator if you think it should be yours.';

describe('UserRegister — email', () => {
  // Mail alone is not enough: the welcome email is link-only, so without the
  // server's `public_url` registration keeps the generated-password hand-off.
  it('shows no email field when onboarding is not enabled, even with email on', () => {
    const { emailInput } = renderForm([], { onboardingEnabled: false });
    expect(emailInput).toBeNull();
  });

  it('keeps Register disabled until both username and email are valid', async () => {
    const user = userEvent.setup();
    const { usernameInput, emailInput } = renderForm([], { onboardingEnabled: true });
    const button = screen.getByRole('button', { name: 'Register' });

    await user.type(usernameInput, 'charlie1');
    expect(button).toBeDisabled();
    await user.type(emailInput!, 'not-an-address');
    expect(button).toBeDisabled();
    await user.clear(emailInput!);
    await user.type(emailInput!, 'c@example.com');
    expect(button).toBeEnabled();
  });

  it('sends the email and confirms the welcome email went out', async () => {
    const user = userEvent.setup();
    const { usernameInput, emailInput } = renderForm(
      [
        registerSuccessMock('charlie1', null, {
          email: 'c@example.com',
          onboardingEmailSent: true,
        }),
      ],
      { onboardingEnabled: true }
    );

    await user.type(usernameInput, 'charlie1');
    await user.type(emailInput!, 'c@example.com');
    await user.click(screen.getByRole('button', { name: 'Register' }));

    expect(await screen.findByText(/welcome email sent to c@example\.com/i)).toBeInTheDocument();
    expect(screen.queryByText(/new password for charlie1/i)).toBeNull();
    expect(screen.queryByRole('button', { name: 'Cancel' })).toBeNull();
  });

  it('falls back to the password modal, with a note, when the welcome email did not send', async () => {
    const user = userEvent.setup();
    const { usernameInput, emailInput } = renderForm(
      [registerSuccessMock('charlie1', 'Gen3rated!', { email: 'c@example.com' })],
      { onboardingEnabled: true }
    );

    await user.type(usernameInput, 'charlie1');
    await user.type(emailInput!, 'c@example.com');
    await user.click(screen.getByRole('button', { name: 'Register' }));

    expect(await screen.findByText(/new password for charlie1/i)).toBeInTheDocument();
    expect(screen.getByText(/welcome email could not be sent/i)).toBeInTheDocument();
  });

  it('toasts EmailInUseError and keeps the form values', async () => {
    const user = userEvent.setup();
    const { usernameInput, emailInput } = renderForm(
      [
        {
          request: {
            query: UserRegisterDocument,
            variables: { input: { username: 'charlie1', email: 'c@example.com' } },
          },
          result: {
            data: {
              __typename: 'Mutation',
              userRegister: {
                __typename: 'EmailInUseError',
                message: EMAIL_IN_USE,
              },
            },
          },
        },
      ],
      { onboardingEnabled: true }
    );

    await user.type(usernameInput, 'charlie1');
    await user.type(emailInput!, 'c@example.com');
    await user.click(screen.getByRole('button', { name: 'Register' }));

    expect(await screen.findByRole('status')).toHaveTextContent(EMAIL_IN_USE);
    expect(usernameInput.value).toBe('charlie1');
    expect(emailInput!.value).toBe('c@example.com');
  });
});
