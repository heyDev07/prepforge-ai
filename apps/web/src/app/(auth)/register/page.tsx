import type { Metadata } from 'next';
import { Suspense } from 'react';
import { AuthForm } from '@/components/auth-form';
import { Spinner } from '@/components/ui';

export const metadata: Metadata = { title: 'Create account' };

export default function Page() {
  return (
    <Suspense fallback={<Spinner />}>
      <AuthForm mode="register" />
    </Suspense>
  );
}
