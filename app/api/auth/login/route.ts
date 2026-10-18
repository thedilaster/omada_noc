import { NextResponse } from 'next/server';
import { cookies } from 'next/headers';
import { findUserByEmailOrUsername, recordLoginAttempt, getUserProfile } from '@/lib/db/queries';
import { verifyPassword, verifyDummyPassword } from '@/lib/auth/password';
import { createSessionToken, sessionCookieOptions, INACTIVITY_TIMEOUT_SECONDS } from '@/lib/auth/session';
import { initDb } from '@/lib/db/schema';

// Column limits of user_logins.ip_address / user_logins.email; longer values make the audit insert fail
const MAX_IP_LENGTH = 45;
const MAX_IDENTIFIER_LENGTH = 255;

/**
 * Client IP for the audit log: first X-Forwarded-For hop (the original client), else X-Real-IP.
 */
function resolveClientIp(request: Request): string {
  const forwarded = (request.headers.get('x-forwarded-for') || '').split(',')[0].trim();
  const ip = forwarded || (request.headers.get('x-real-ip') || '').trim() || '127.0.0.1';
  return ip.slice(0, MAX_IP_LENGTH);
}

export async function POST(request: Request) {
  const ipAddress = resolveClientIp(request);
  const userAgent = request.headers.get('user-agent') || 'Unknown';

  try {
    // Ensure DB is initialized
    await initDb().catch((err) => console.error('DB init warning on login:', err));

    const body = await request.json();
    const { identifier, password } = body;
    const auditIdentifier = String(identifier || 'unknown').slice(0, MAX_IDENTIFIER_LENGTH);

    if (!identifier || !password) {
      await recordLoginAttempt(null, auditIdentifier, ipAddress, userAgent, 'FAILED', 'Missing credentials');
      return NextResponse.json(
        { error: 'Email/Username and password are required.' },
        { status: 400 }
      );
    }

    const user = await findUserByEmailOrUsername(identifier);

    if (!user) {
      // Spend the same bcrypt work as a real check so response time doesn't reveal valid accounts
      await verifyDummyPassword(password);
      await recordLoginAttempt(null, auditIdentifier, ipAddress, userAgent, 'FAILED', 'User not found');
      return NextResponse.json(
        { error: 'Invalid credentials. Please verify your email and password.' },
        { status: 401 }
      );
    }

    const isValidPassword = await verifyPassword(password, user.passwordHash);

    if (!isValidPassword) {
      await recordLoginAttempt(user.id, user.email, ipAddress, userAgent, 'FAILED', 'Invalid password');
      return NextResponse.json(
        { error: 'Invalid credentials. Please verify your email and password.' },
        { status: 401 }
      );
    }

    // Fetch Profile
    const profile = await getUserProfile(user.id);

    // Create JWT Session Token
    const token = await createSessionToken({
      userId: user.id,
      username: user.username,
      email: user.email,
      role: user.role,
      fullName: profile?.fullName || user.username,
    });

    // Record Success Login Audit
    await recordLoginAttempt(user.id, user.email, ipAddress, userAgent, 'SUCCESS', null);

    // Set HTTP-Only Cookie
    const cookieStore = await cookies();
    cookieStore.set({
      ...sessionCookieOptions(request, INACTIVITY_TIMEOUT_SECONDS),
      value: token,
    });

    return NextResponse.json({
      success: true,
      user: {
        id: user.id,
        username: user.username,
        email: user.email,
        role: user.role,
        fullName: profile?.fullName || user.username,
      },
    });
  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : 'Internal server error';
    console.error('Login route error:', error);
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
