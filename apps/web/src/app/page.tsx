import { redirect } from 'next/navigation';

/** The proxy sends "/" to the dashboard or login; this is the fallback. */
export default function Home() {
  redirect('/dashboard');
}
