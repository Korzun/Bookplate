import type { Reference } from '@apollo/client';
import { useMutation } from '@apollo/client/react';
import { Fragment, useActionState, useCallback, useState } from 'react';

import { Card } from '~/component';
import { Button, PasswordResultModal, TextInput } from '~/control';
import type { UserRegisterMutation } from '~/gql/graphql';
import { UserRegisterDocument } from '~/graphql/user';
import { unwrapResult } from '~/provider/apollo';
import { useToast } from '~/provider/toast';

import { useStyle } from './style';

// `unwrapResult`'s `TPayload` sits in a position TypeScript cannot infer from
// the call, so it is named explicitly here, extracted from the generated
// union rather than hand-duplicated.
type UserRegisterPayload = Extract<
  UserRegisterMutation['userRegister'],
  { __typename: 'UserRegisterPayload' }
>;

/**
 * `useRegisterUser` is inlined directly here rather than kept as a
 * `provider/user` hook — this form is its only caller, mirroring
 * `component/device-row`'s own inlined `DeviceDeleteDocument` call.
 *
 * `userRegister` returns the created `User`, but a returned entity does not
 * insert itself into any list: `Viewer.users` is read separately
 * (`page/user-list`'s `UserListDocument`), so `update` appends into it via
 * `cache.modify` on the `Viewer` singleton (`keyFields: []` in `cacheConfig`
 * is what makes `cache.identify({ __typename: 'Viewer' })` resolve to an
 * addressable id) — the same shape `DeviceForm`'s create path uses for
 * `Viewer.devices`.
 */
export const UserRegister = () => {
  const styles = useStyle();
  const [runRegister] = useMutation(UserRegisterDocument);
  const showToast = useToast();
  const [username, setUsername] = useState<string>('');
  const [isUsernameValid, setIsUsernameValid] = useState<boolean>(false);
  const [result, setResult] = useState<{ username: string; password: string } | null>(null);

  const [, submitAction, isPending] = useActionState(async () => {
    try {
      const { data } = await runRegister({
        variables: { input: { username } },
        update: (cache, { data: mutationData }) => {
          const created = unwrapResult<UserRegisterPayload>(
            mutationData?.userRegister,
            'UserRegisterPayload'
          );
          if (created.status !== 'ok') return;

          cache.modify({
            id: cache.identify({ __typename: 'Viewer' }),
            fields: {
              users: (existing: readonly Reference[] = [], { toReference }) => {
                const ref = toReference(created.payload.user);
                return ref ? [...existing, ref] : existing;
              },
            },
          });
        },
      });

      const registerResult = unwrapResult<UserRegisterPayload>(
        data?.userRegister,
        'UserRegisterPayload'
      );
      if (registerResult.status === 'missing') {
        showToast('Registration failed', 'error');
        return null;
      }
      if (registerResult.status === 'error') {
        showToast(registerResult.message, 'error');
        return null;
      }

      setResult({ username, password: registerResult.payload.password });
      setUsername('');
      setIsUsernameValid(false);
    } catch (err) {
      showToast(err instanceof Error ? err.message : 'Registration failed', 'error');
    }
    return null;
  }, null);

  const handleUsernameChange = useCallback((newValue: string | undefined) => {
    setUsername(newValue ?? '');
  }, []);

  // TextInput only fires onChange when validate() passes, so a short username
  // never reaches `username` state; validate is also where we track the
  // enable/disable flag and drive the input's danger styling.
  const validateUsername = useCallback((newValue: string): boolean => {
    const valid = newValue.trim().length >= 6;
    setIsUsernameValid(valid);
    return valid;
  }, []);

  const handleDone = useCallback(() => {
    setResult(null);
  }, []);

  return (
    <Fragment>
      <Card title="Register a user">
        <form className={styles.form} action={submitAction}>
          <div className={styles.inputContainer}>
            <TextInput
              name="username"
              value={username}
              onChange={handleUsernameChange}
              validate={validateUsername}
              layout="horizontal"
              label="Username"
              autoComplete="off"
            />
          </div>
          <Button
            type="primary"
            radius="card"
            submit
            loading={isPending}
            disabled={!isUsernameValid}
          >
            {isPending ? 'Registering…' : 'Register'}
          </Button>
        </form>
      </Card>
      <PasswordResultModal
        isOpen={result !== null}
        username={result?.username ?? ''}
        password={result?.password ?? null}
        onDone={handleDone}
      />
    </Fragment>
  );
};
