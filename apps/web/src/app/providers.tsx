'use client';

import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { useState, type ReactNode } from 'react';
import { ToastProvider } from '@/components/toast';
import { ApiError } from '@/lib/api';

export function Providers({ children }: { children: ReactNode }) {
  const [queryClient] = useState(
    () =>
      new QueryClient({
        defaultOptions: {
          queries: {
            staleTime: 10_000,
            refetchOnWindowFocus: false,
            // never retry client errors (401, 404, validation); retry transient failures once
            retry: (count, error) =>
              count < 1 &&
              (!(error instanceof ApiError) || error.status === 0 || error.status >= 500),
          },
        },
      }),
  );
  return (
    <QueryClientProvider client={queryClient}>
      <ToastProvider>{children}</ToastProvider>
    </QueryClientProvider>
  );
}
