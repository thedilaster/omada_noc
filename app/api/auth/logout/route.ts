import { NextResponse } from 'next/server';
import { cookies } from 'next/headers';
import { sessionCookieOptions } from '@/lib/auth/session';

export async function POST(request: Request) {
  const cookieStore = await cookies();
  cookieStore.set({ ...sessionCookieOptions(request, 0), value: '' });

  return NextResponse.json({ success: true, message: 'Logged out successfully' });
}

/**
 * Clears the session cookie and redirects to /login. Server Components cannot modify cookies,
 * so app/page.tsx redirects here when a valid JWT points at a user that no longer exists
 * (otherwise /login would bounce the still-valid cookie back to / in a redirect loop).
 */
export async function GET(request: Request) {
  const response = NextResponse.redirect(new URL('/login', request.url));
  response.cookies.set({ ...sessionCookieOptions(request, 0), value: '' });
  return response;
}
