'use client';

import { useQueryClient } from '@tanstack/react-query';
import { LayoutDashboard, LogOut, Plus, Sparkles } from 'lucide-react';
import Link from 'next/link';
import { usePathname, useRouter } from 'next/navigation';
import { useEffect, type ReactNode } from 'react';
import { Button, cx, Spinner } from '@/components/ui';
import { api, ApiError } from '@/lib/api';
import { useMe } from '@/lib/queries';

export default function AppLayout({ children }: { children: ReactNode }) {
  const router = useRouter();
  const pathname = usePathname();
  const queryClient = useQueryClient();
  const me = useMe();
  const unauthorised = me.error instanceof ApiError && me.error.status === 401;

  useEffect(() => {
    if (!unauthorised) return;
    // clear a stale cookie, then go to the login page
    void api
      .logout()
      .catch(() => undefined)
      .finally(() => router.replace(`/login?next=${encodeURIComponent(pathname)}`));
  }, [unauthorised, pathname, router]);

  async function logout() {
    await api.logout().catch(() => undefined);
    queryClient.clear();
    router.replace('/login');
  }

  if (me.isPending || unauthorised) return <Spinner label="Checking your session…" />;
  if (me.isError) {
    return (
      <div className="mx-auto max-w-md px-4 py-16 text-center text-sm text-slate-600">
        <p>{me.error.message}</p>
        <Button className="mt-4" onClick={() => void me.refetch()}>
          Try again
        </Button>
      </div>
    );
  }

  const nav = [
    { href: '/dashboard', label: 'Dashboard', icon: LayoutDashboard },
    { href: '/kits/new', label: 'New kit', icon: Plus },
  ];

  return (
    <div className="min-h-dvh">
      <header className="sticky top-0 z-30 border-b border-slate-200 bg-white/90 backdrop-blur">
        <div className="mx-auto flex h-14 max-w-6xl items-center gap-4 px-4 sm:px-6">
          <Link href="/dashboard" className="flex items-center gap-2 font-semibold text-brand-700">
            <Sparkles className="size-5" aria-hidden />
            <span className="tracking-tight">PrepForge</span>
          </Link>
          <nav aria-label="Main" className="flex items-center gap-1">
            {nav.map(({ href, label, icon: Icon }) => (
              <Link
                key={href}
                href={href}
                aria-current={pathname === href ? 'page' : undefined}
                className={cx(
                  'inline-flex items-center gap-1.5 rounded-md px-2.5 py-1.5 text-sm font-medium',
                  pathname === href
                    ? 'bg-slate-100 text-slate-900'
                    : 'text-slate-600 hover:bg-slate-50',
                )}
              >
                <Icon className="size-4" aria-hidden />
                <span className="hidden sm:inline">{label}</span>
              </Link>
            ))}
          </nav>
          <div className="ml-auto flex items-center gap-2">
            <span className="hidden max-w-48 truncate text-sm text-slate-500 md:inline">
              {me.data.user.email}
            </span>
            <Button
              variant="ghost"
              size="sm"
              icon={<LogOut className="size-4" aria-hidden />}
              onClick={logout}
            >
              <span className="hidden sm:inline">Sign out</span>
              <span className="sr-only sm:hidden">Sign out</span>
            </Button>
          </div>
        </div>
      </header>
      <main className="mx-auto max-w-6xl px-4 py-6 sm:px-6 sm:py-8">{children}</main>
    </div>
  );
}
