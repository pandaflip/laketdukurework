import { useState, type SyntheticEvent } from 'react';
import { useTranslation } from 'react-i18next';
import { Button, Card, Field, Input } from '../design/ui';
import { adminApi } from '../lib/api';
import { ErrorNotice, useAdminMutation } from './shared';

export function LoginPage() {
  const { t } = useTranslation('admin');
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const login = useAdminMutation(adminApi.login);

  const submit = (event: SyntheticEvent): void => {
    event.preventDefault();
    login.mutate({ username, password });
  };

  return (
    <Card className="mx-auto max-w-sm">
      <h1 className="mb-4 font-display text-xl font-bold">{t('login.title')}</h1>
      <form onSubmit={submit} className="flex flex-col gap-4">
        <Field label={t('login.username')}>
          <Input
            name="username"
            autoComplete="username"
            required
            value={username}
            onChange={(event) => {
              setUsername(event.target.value);
            }}
          />
        </Field>
        <Field label={t('login.password')}>
          <Input
            name="password"
            type="password"
            autoComplete="current-password"
            required
            value={password}
            onChange={(event) => {
              setPassword(event.target.value);
            }}
          />
        </Field>
        <ErrorNotice error={login.error} />
        <Button type="submit" variant="primary" disabled={login.isPending}>
          {t('login.submit')}
        </Button>
      </form>
    </Card>
  );
}
