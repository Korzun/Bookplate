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
import { renderWithApollo } from '~/test-utils';

import { UserRegister } from './index';

beforeEach(() => {
  HTMLDialogElement.prototype.showModal = () => {};
  HTMLDialogElement.prototype.close = () => {};
});

const registerSuccessMock = (
  username: string,
  password: string
): MockedResponse<UserRegisterMutation, UserRegisterMutationVariables> => ({
  request: { query: UserRegisterDocument, variables: { input: { username } } },
  result: {
    data: {
      __typename: 'Mutation',
      userRegister: {
        __typename: 'UserRegisterPayload',
        user: {
          __typename: 'User',
          id: 'u-new',
          username,
          progressCount: 0,
          library: { __typename: 'Library', id: 'lib-new' },
        },
        password,
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

function renderForm(mocks: MockedResponse[] = []) {
  const rendered = renderWithApollo(<UserRegister />, { mocks });
  seedEmptyUserList(rendered.client);
  const usernameInput = rendered.container.querySelector(
    'input[name="username"]'
  ) as HTMLInputElement;
  return { ...rendered, usernameInput };
}

describe('UserRegister', () => {
  it('renders the card titled "Register a user"', () => {
    renderForm();
    expect(screen.getByText('Register a user')).toBeInTheDocument();
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
