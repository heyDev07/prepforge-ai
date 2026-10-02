'use client';

import { useQueryClient } from '@tanstack/react-query';
import { LayoutDashboard, LogOut, Plus } from 'lucide-react';
import Link from 'next/link';
import { usePathname, useRouter } from 'next/navigation';
import { useEffect, type ReactNode } from 'react';
import { Logo } from '@/components/brand';
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
  const email = me.data.user.email;

  return (
    <div className="min-h-dvh">
      <header className="sticky top-0 z-30 border-b border-white/5 bg-ink-950 text-white">
        <div className="mx-auto flex h-16 max-w-6xl items-center gap-6 px-4 sm:px-6">
          <Link href="/dashboard" aria-label="PrepForge dashboard">
            <Logo tone="light" />
          </Link>
          <nav aria-label="Main" className="flex items-center gap-1">
            {nav.map(({ href, label, icon: Icon }) => {
              const active = pathname === href;
              return (
                <Link
                  key={href}
                  href={href}
                  aria-current={active ? 'page' : undefined}
                  className={cx(
                    'inline-flex items-center gap-1.5 rounded-lg px-3 py-2 text-sm font-medium transition-colors',
                    active
                      ? 'bg-white/10 text-white'
                      : 'text-slate-400 hover:bg-white/5 hover:text-white',
                  )}
                >
                  <Icon className="size-4" aria-hidden />
                  <span className="hidden sm:inline">{label}</span>
                  <span className="sr-only sm:hidden">{label}</span>
                </Link>
              );
            })}
          </nav>
          <div className="ml-auto flex items-center gap-3">
            <span className="hidden items-center gap-2 md:flex">
              <span
                className="grid size-8 place-items-center rounded-full bg-gradient-to-br from-slate-600 to-slate-800 text-xs font-semibold uppercase ring-1 ring-white/10"
                aria-hidden
              >
                {email.charAt(0)}
              </span>
              <span className="max-w-48 truncate text-sm text-slate-300">{email}</span>
            </span>
            <button
              type="button"
              onClick={logout}
              className="inline-flex h-9 items-center gap-1.5 rounded-lg px-3 text-sm font-medium text-slate-300 ring-1 ring-white/10 transition-colors hover:bg-white/5 hover:text-white"
            >
              <LogOut className="size-4" aria-hidden />
              <span className="hidden sm:inline">Sign out</span>
              <span className="sr-only sm:hidden">Sign out</span>
            </button>
          </div>
        </div>
      </header>
      <main className="mx-auto max-w-6xl px-4 py-8 sm:px-6 sm:py-10">{children}</main>
    </div>
  );
}
