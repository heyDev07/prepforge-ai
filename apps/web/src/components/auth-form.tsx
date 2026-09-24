'use client';

import { useQueryClient } from '@tanstack/react-query';
import Link from 'next/link';
import { useRouter, useSearchParams } from 'next/navigation';
import { useState, type FormEvent } from 'react';
import { Alert, Button, Field, Input } from '@/components/ui';
import { api, ApiError } from '@/lib/api';
import { keys } from '@/lib/queries';

/** Only same-site relative paths are allowed as post-login destinations. */
function safeNext(value: string | null): string {
  return value && value.startsWith('/') && !value.startsWith('//') ? value : '/dashboard';
}

export function AuthForm({ mode }: { mode: 'login' | 'register' }) {
  const router = useRouter();
  const searchParams = useSearchParams();
  const queryClient = useQueryClient();
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<ApiError | null>(null);
  const next = safeNext(searchParams.get('next'));

  async function onSubmit(event: FormEvent) {
    event.preventDefault();
    setPending(true);
    setError(null);
    try {
      const { user } =
        mode === 'login' ? await api.login(email, password) : await api.register(email, password);
      queryClient.setQueryData(keys.me, { user });
      router.replace(next);
    } catch (e) {
      setError(e instanceof ApiError ? e : null);
      setPending(false);
    }
  }

  const fields = error?.fieldErrors ?? {};
  const isLogin = mode === 'login';

  return (
    <form onSubmit={onSubmit} className="space-y-5" noValidate>
      <div className="space-y-1">
        <h1 className="text-xl font-semibold text-slate-900">
          {isLogin ? 'Sign in to PrepForge' : 'Create your account'}
        </h1>
        <p className="text-sm text-slate-600">
          {isLogin
            ? 'Pick up your interview preparation where you left off.'
            : 'Turn a job description into a researched, scheduled prep kit.'}
        </p>
      </div>

      {error && !fields.email && !fields.password ? (
        <Alert tone="red">{error.message}</Alert>
      ) : null}

      <Field label="Email" error={fields.email}>
        {(props) => (
          <Input
            {...props}
            type="email"
            autoComplete="email"
            required
            value={email}
            onChange={(e) => setEmail(e.target.value)}
          />
        )}
      </Field>
      <Field
        label="Password"
        error={fields.password}
        hint={isLogin ? undefined : 'At least 8 characters.'}
      >
        {(props) => (
          <Input
            {...props}
            type="password"
            autoComplete={isLogin ? 'current-password' : 'new-password'}
            required
            minLength={isLogin ? undefined : 8}
            value={password}
            onChange={(e) => setPassword(e.target.value)}
          />
        )}
      </Field>

      <Button type="submit" variant="primary" className="w-full" loading={pending}>
        {isLogin ? 'Sign in' : 'Create account'}
      </Button>

      <p className="text-center text-sm text-slate-600">
        {isLogin ? 'New to PrepForge? ' : 'Already have an account? '}
        <Link
          href={`${isLogin ? '/register' : '/login'}${next !== '/dashboard' ? `?next=${encodeURIComponent(next)}` : ''}`}
          className="font-medium text-brand-700 hover:underline"
        >
          {isLogin ? 'Create an account' : 'Sign in'}
        </Link>
      </p>
    </form>
  );
}
