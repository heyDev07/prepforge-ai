import Link from 'next/link';

export default function NotFound() {
  return (
    <main className="flex min-h-dvh flex-col items-center justify-center gap-3 px-4 text-center">
      <p className="text-sm font-semibold text-brand-700">404</p>
      <h1 className="text-2xl font-semibold text-slate-900">Page not found</h1>
      <Link href="/dashboard" className="text-sm font-medium text-brand-700 hover:underline">
        Go to your dashboard
      </Link>
    </main>
  );
}
