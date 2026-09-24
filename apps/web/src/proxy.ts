import { NextResponse, type NextRequest } from 'next/server';

const SESSION_COOKIE = 'pf_session';
const PROTECTED = ['/dashboard', '/kits'];

/**
 * Optimistic route protection: without a session cookie, protected pages redirect to /login
 * straight away. The API still checks every request, and the app layout handles expired
 * sessions, so this is a convenience, not the security boundary.
 */
export function proxy(request: NextRequest) {
  const { pathname, search } = request.nextUrl;
  const hasSession = request.cookies.has(SESSION_COOKIE);

  if (pathname === '/') {
    return NextResponse.redirect(new URL(hasSession ? '/dashboard' : '/login', request.url));
  }
  if (
    !hasSession &&
    PROTECTED.some((prefix) => pathname === prefix || pathname.startsWith(`${prefix}/`))
  ) {
    const login = new URL('/login', request.url);
    login.searchParams.set('next', `${pathname}${search}`);
    return NextResponse.redirect(login);
  }
  return NextResponse.next();
}

export const config = {
  matcher: ['/', '/dashboard/:path*', '/kits/:path*'],
};
