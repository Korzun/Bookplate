import { useCallback, useState } from 'react';

import { Card } from '~/component';
import { Button, TextInput } from '~/control';
import { useToast } from '~/provider/toast';
import { useRegisterUser } from '~/provider/user';

import { useStyle } from './style';

export const UserRegister = () => {
  const styles = useStyle();
  const [registerUser, loading] = useRegisterUser();
  const showToast = useToast();
  const [username, setUsername] = useState<string>('');
  const [password, setPassword] = useState<string>('');

  const handleRegisterUser = useCallback(async () => {
    const ok = await registerUser(username, password);
    if (ok) {
      showToast('User registered', 'success');
    } else {
      showToast('Registration failed', 'error');
    }
  }, [registerUser, username, password, showToast]);

  const handleUsernameChange = useCallback((newValue: string | undefined) => {
    setUsername(newValue ?? '');
  }, []);

  const handlePasswordChange = useCallback((newValue: string | undefined) => {
    setPassword(newValue ?? '');
  }, []);

  return (
    <Card title="Register new User">
      <div className={styles.inputContainer}>
        <TextInput
          name="username"
          value={username}
          onChange={handleUsernameChange}
          layout="horizontal"
          label="Username"
          autoComplete="off"
        />
        <TextInput
          name="password"
          password
          value={password}
          onChange={handlePasswordChange}
          layout="horizontal"
          label="Password"
          autoComplete="off"
        />
      </div>
      <Button type="primary" loading={loading} onClick={handleRegisterUser}>
        {loading ? 'Registering…' : 'Register'}
      </Button>
    </Card>
  );
};
