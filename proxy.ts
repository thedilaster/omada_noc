import { NextResponse } from 'next/server';
import type { NextRequest } from 'next/server';
import {
  verifySessionToken,
  createSessionToken,
  sessionCookieOptions,
  SESSION_COOKIE_NAME,
  INACTIVITY_TIMEOUT_SECONDS,
  SESSION_REFRESH_INTERVAL_MS,
} from '@/lib/auth/session';

export async function proxy(request: NextRequest) {
  const { pathname } = request.nextUrl;

  // Allow Next internals and static assets
  if (
    pathname.startsWith('/_next') ||
    pathname.startsWith('/favicon.ico')
  ) {
    return NextResponse.next();
  }

  const sessionCookie = request.cookies.get(SESSION_COOKIE_NAME);
  const session = sessionCookie?.value ? await verifySessionToken(sessionCookie.value) : null;

  // Handle /login route: If already logged in, redirect to dashboard
  if (pathname === '/login') {
    if (session) {
      return NextResponse.redirect(new URL('/', request.url));
    }
    return NextResponse.next();
  }

  // Handle public auth and health API routes (login, logout, health probe)
  if (
    pathname === '/api/auth/login' ||
    pathname === '/api/auth/logout' ||
    pathname === '/api/health'
  ) {
    return NextResponse.next();
  }

  // Unauthenticated user attempting to access protected resources
  if (!session) {
    if (pathname.startsWith('/api/')) {
      return NextResponse.json({ error: 'Authentication required' }, { status: 401 });
    }
    const loginUrl = new URL('/login', request.url);
    const response = NextResponse.redirect(loginUrl);
    if (sessionCookie?.value) {
      // Clear expired cookie if present
      response.cookies.set({ ...sessionCookieOptions(request, 0), value: '' });
    }
    return response;
  }

  // RBAC authorization guard for Admin routes (/admin/* and /api/admin/*)
  if (pathname.startsWith('/admin') || pathname.startsWith('/api/admin')) {
    if (session.role !== 'ADMIN') {
      if (pathname.startsWith('/api/')) {
        return NextResponse.json({ error: 'Forbidden: Admin privilege required' }, { status: 403 });
      }
      return NextResponse.redirect(new URL('/', request.url));
    }
  }

  const response = NextResponse.next();

  // Slide the session: re-sign at most once per refresh interval so active users are not
  // logged out 15 minutes after login. Background polling also refreshes it, so the
  // client-side InactivityTracker remains the enforcer of the 15-minute idle logout.
  if (Date.now() - (session.lastActive || 0) > SESSION_REFRESH_INTERVAL_MS) {
    const refreshedToken = await createSessionToken({
      userId: session.userId,
      username: session.username,
      email: session.email,
      role: session.role,
      fullName: session.fullName,
    });
    response.cookies.set({ ...sessionCookieOptions(request, INACTIVITY_TIMEOUT_SECONDS), value: refreshedToken });
  }

  return response;
}

export const config = {
  matcher: [
    /*
     * Match all request paths except for static files
     */
    '/((?!_next/static|_next/image|favicon.ico).*)',
  ],
};
