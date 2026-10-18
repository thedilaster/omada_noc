import { SignJWT, jwtVerify } from 'jose';
import { cookies } from 'next/headers';
import { SessionPayload } from '@/types/auth';

export const SESSION_COOKIE_NAME = 'noc_session';
export const INACTIVITY_TIMEOUT_SECONDS = 15 * 60; // 15 minutes (900 seconds)
// Minimum age of `lastActive` before the proxy re-signs a sliding session token
export const SESSION_REFRESH_INTERVAL_MS = 60 * 1000;

const MIN_SECRET_LENGTH = 32;
const DEV_FALLBACK_SECRET = 'omada-noc-dashboard-super-secure-jwt-secret-key-32-chars';

let warnedAboutFallbackSecret = false;

function encodeSecret(secret: string): Uint8Array {
  return Uint8Array.from(Buffer.from(secret, 'utf-8'));
}

/**
 * Resolves the HS256 signing key lazily so a missing JWT_SECRET is caught at request time.
 * Production refuses to run with a missing/short secret (the dev fallback is public and
 * would let anyone forge an ADMIN token); dev/test fall back with a one-time warning.
 */
function getSecretKey(): Uint8Array {
  const secret = process.env.JWT_SECRET;

  if (process.env.NODE_ENV === 'production') {
    if (!secret || secret.length < MIN_SECRET_LENGTH) {
      throw new Error(
        `JWT_SECRET must be set to at least ${MIN_SECRET_LENGTH} characters in production.`
      );
    }
    return encodeSecret(secret);
  }

  if (!secret) {
    if (!warnedAboutFallbackSecret) {
      warnedAboutFallbackSecret = true;
      console.warn('⚠️ [Auth] JWT_SECRET is not set; using the insecure development fallback secret.');
    }
    return encodeSecret(DEV_FALLBACK_SECRET);
  }

  return encodeSecret(secret);
}

/**
 * Creates a signed JWT session token with an inactivity expiration window.
 */
export async function createSessionToken(
  payload: Omit<SessionPayload, 'lastActive' | 'exp'>,
  nowMs: number = Date.now()
): Promise<string> {
  const fullPayload: SessionPayload = {
    ...payload,
    lastActive: nowMs,
  };

  return new SignJWT({ ...fullPayload })
    .setProtectedHeader({ alg: 'HS256' })
    .setIssuedAt()
    .setExpirationTime(`${INACTIVITY_TIMEOUT_SECONDS}s`)
    .sign(getSecretKey());
}

/**
 * Verifies and decodes a signed JWT session token, enforcing the 15-minute sliding inactivity window.
 */
export async function verifySessionToken(
  token: string,
  nowMs: number = Date.now()
): Promise<SessionPayload | null> {
  if (!token) return null;

  try {
    const { payload } = await jwtVerify(token, getSecretKey());
    const session = payload as unknown as SessionPayload;

    // Check 15-minute inactivity sliding window
    const elapsedSeconds = (nowMs - (session.lastActive || 0)) / 1000;
    if (elapsedSeconds > INACTIVITY_TIMEOUT_SECONDS) {
      return null;
    }

    return session;
  } catch {
    return null;
  }
}

/**
 * Retrieves and validates the current active session from incoming Next.js request cookies.
 */
export async function getCurrentSession(): Promise<SessionPayload | null> {
  try {
    const cookieStore = await cookies();
    const sessionCookie = cookieStore.get(SESSION_COOKIE_NAME);
    if (!sessionCookie?.value) return null;

    return await verifySessionToken(sessionCookie.value);
  } catch {
    return null;
  }
}

/**
 * Decides whether the session cookie needs the Secure flag. COOKIE_SECURE ('true'/'false')
 * wins when set; otherwise Secure is only used when the browser reached us over HTTPS
 * (directly or via a TLS-terminating proxy), since browsers drop Secure cookies on plain
 * http://<LAN-IP>:3000 and login would silently bounce back to /login.
 */
export function isSecureRequest(request: Request): boolean {
  const override = process.env.COOKIE_SECURE?.trim().toLowerCase();
  if (override === 'true') return true;
  if (override === 'false') return false;

  const forwardedProto = (request.headers.get('x-forwarded-proto') || '').split(',')[0].trim().toLowerCase();
  return forwardedProto === 'https' || new URL(request.url).protocol === 'https:';
}

/**
 * Shared Set-Cookie attributes for the session cookie (login, logout, and proxy refresh).
 */
export function sessionCookieOptions(request: Request, maxAge: number) {
  return {
    name: SESSION_COOKIE_NAME,
    httpOnly: true,
    secure: isSecureRequest(request),
    sameSite: 'lax' as const,
    path: '/',
    maxAge,
  };
}
