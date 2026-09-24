import { Sparkles } from 'lucide-react';
import type { ReactNode } from 'react';

export default function AuthLayout({ children }: { children: ReactNode }) {
  return (
    <main className="flex min-h-dvh flex-col items-center justify-center px-4 py-12">
      <div className="mb-6 flex items-center gap-2 text-brand-700">
        <Sparkles className="size-6" aria-hidden />
        <span className="text-lg font-semibold tracking-tight">PrepForge</span>
      </div>
      <div className="w-full max-w-sm rounded-xl bg-white p-6 shadow-sm ring-1 ring-slate-200 sm:p-8">
        {children}
      </div>
    </main>
  );
}
