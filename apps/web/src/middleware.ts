import { NextRequest, NextResponse } from 'next/server';

const PUBLIC_PATHS = ['/login'];

export function middleware(request: NextRequest) {
  const { pathname } = request.nextUrl;
  const hasRefreshToken = request.cookies.has('refreshToken');
  const isPublicPath = PUBLIC_PATHS.some(
    (p) => pathname === p || pathname.startsWith(`${p}/`),
  );

  // No cookie and not on a public page → redirect to login
  if (!hasRefreshToken && !isPublicPath) {
    const loginUrl = request.nextUrl.clone();
    loginUrl.pathname = '/login';
    return NextResponse.redirect(loginUrl);
  }

  // Has cookie but on login page → let the page handle it.
  // Do NOT redirect to home here. The cookie might be expired/invalid,
  // and redirecting would cause an infinite loop:
  // middleware→home→AuthProvider 401→layout→/login→middleware→home→...
  // The login page itself will redirect to /dashboard after a successful login.

  return NextResponse.next();
}

export const config = {
  // Run on all routes except static files and Next.js internals
  matcher: ['/((?!api|_next/static|_next/image|favicon.ico|.*\\.(?:svg|png|jpg|jpeg|gif|webp)$).*)'],
};
