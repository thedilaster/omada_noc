import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import {
  createSessionToken,
  verifySessionToken,
  getCurrentSession,
  isSecureRequest,
  sessionCookieOptions,
  INACTIVITY_TIMEOUT_SECONDS,
  SESSION_COOKIE_NAME,
} from '@/lib/auth/session';

const mockGetCookie = vi.fn();
vi.mock('next/headers', () => ({
  cookies: async () => ({
    get: mockGetCookie,
  }),
}));

describe('JWT Session & Inactivity Management', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('creates and verifies a valid signed JWT session token', async () => {
    const payload = {
      userId: 'user-uuid-123',
      username: 'jdoe',
      email: 'jdoe@example.com',
      role: 'ADMIN' as const,
      fullName: 'John Doe',
    };

    const token = await createSessionToken(payload);
    expect(token).toBeDefined();
    expect(typeof token).toBe('string');

    const decoded = await verifySessionToken(token);
    expect(decoded).not.toBeNull();
    expect(decoded?.userId).toBe('user-uuid-123');
    expect(decoded?.username).toBe('jdoe');
    expect(decoded?.role).toBe('ADMIN');
  });

  it('rejects a session token that has exceeded the 15-minute inactivity window', async () => {
    const payload = {
      userId: 'user-uuid-456',
      username: 'stale_user',
      email: 'stale@example.com',
      role: 'USER' as const,
    };

    const pastTimestamp = Date.now() - (INACTIVITY_TIMEOUT_SECONDS + 60) * 1000;
    const token = await createSessionToken(payload, pastTimestamp);

    const decoded = await verifySessionToken(token, Date.now());
    expect(decoded).toBeNull();
  });

  it('returns null for an invalid, malformed, or empty token', async () => {
    expect(await verifySessionToken('')).toBeNull();
    expect(await verifySessionToken('invalid.jwt.token')).toBeNull();
  });

  it('retrieves active session from cookies using getCurrentSession', async () => {
    const token = await createSessionToken({
      userId: 'u-cookie-test',
      username: 'cookieuser',
      email: 'cookie@test.com',
      role: 'ADMIN',
    });

    mockGetCookie.mockReturnValueOnce({ value: token });

    const session = await getCurrentSession();
    expect(session?.userId).toBe('u-cookie-test');

    // Test missing cookie
    mockGetCookie.mockReturnValueOnce(undefined);
    expect(await getCurrentSession()).toBeNull();

    // Test cookies() throwing error
    mockGetCookie.mockImplementationOnce(() => {
      throw new Error('Cookie store failure');
    });
    expect(await getCurrentSession()).toBeNull();
  });
});

describe('JWT signing secret resolution', () => {
  const payload = { userId: 'u-secret', username: 'sec', email: 'sec@test.com', role: 'ADMIN' as const };

  afterEach(() => {
    vi.unstubAllEnvs();
    vi.restoreAllMocks();
  });

  it('refuses to sign in production when JWT_SECRET is missing or shorter than 32 chars', async () => {
    vi.stubEnv('NODE_ENV', 'production');
    vi.stubEnv('JWT_SECRET', '');
    await expect(createSessionToken(payload)).rejects.toThrow('JWT_SECRET must be set');

    vi.stubEnv('JWT_SECRET', 'too-short-secret');
    await expect(createSessionToken(payload)).rejects.toThrow('JWT_SECRET must be set');
  });

  it('does not accept tokens forged with the public dev fallback secret in production', async () => {
    // Signed in dev/test with the fallback secret
    vi.stubEnv('JWT_SECRET', '');
    const forged = await createSessionToken(payload);

    vi.stubEnv('NODE_ENV', 'production');
    expect(await verifySessionToken(forged)).toBeNull();

    vi.stubEnv('JWT_SECRET', 'p'.repeat(32));
    expect(await verifySessionToken(forged)).toBeNull();
  });

  it('signs and verifies with a sufficiently long production secret', async () => {
    vi.stubEnv('NODE_ENV', 'production');
    vi.stubEnv('JWT_SECRET', 'x'.repeat(40));
    const token = await createSessionToken(payload);
    expect((await verifySessionToken(token))?.userId).toBe('u-secret');

    // A different secret must not verify the token
    vi.stubEnv('JWT_SECRET', 'y'.repeat(40));
    expect(await verifySessionToken(token)).toBeNull();
  });

  it('uses JWT_SECRET in development when provided', async () => {
    vi.stubEnv('JWT_SECRET', 'dev-secret-a');
    const token = await createSessionToken(payload);
    expect(await verifySessionToken(token)).not.toBeNull();

    vi.stubEnv('JWT_SECRET', 'dev-secret-b');
    expect(await verifySessionToken(token)).toBeNull();
  });

  it('warns only once when falling back to the development secret', async () => {
    vi.stubEnv('JWT_SECRET', '');
    vi.resetModules();
    const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});
    const freshSession = await import('@/lib/auth/session');

    await freshSession.createSessionToken(payload);
    await freshSession.createSessionToken(payload);
    expect(warnSpy).toHaveBeenCalledTimes(1);
    expect(warnSpy.mock.calls[0][0]).toContain('JWT_SECRET is not set');
  });
});

describe('Session cookie options', () => {
  afterEach(() => {
    vi.unstubAllEnvs();
  });

  const makeRequest = (url: string, headers: Record<string, string> = {}) => new Request(url, { headers });

  it('marks the cookie Secure only for HTTPS requests by default', () => {
    vi.stubEnv('COOKIE_SECURE', '');
    expect(isSecureRequest(makeRequest('http://192.168.1.50:3000/api/auth/login'))).toBe(false);
    expect(isSecureRequest(makeRequest('https://noc.example.com/api/auth/login'))).toBe(true);
    expect(isSecureRequest(makeRequest('http://10.0.0.5:3000/', { 'x-forwarded-proto': 'https' }))).toBe(true);
    expect(isSecureRequest(makeRequest('http://10.0.0.5:3000/', { 'x-forwarded-proto': 'HTTPS, http' }))).toBe(true);
    expect(isSecureRequest(makeRequest('http://10.0.0.5:3000/', { 'x-forwarded-proto': 'http, https' }))).toBe(false);
  });

  it('honours the COOKIE_SECURE override in both directions', () => {
    vi.stubEnv('COOKIE_SECURE', 'false');
    expect(isSecureRequest(makeRequest('https://noc.example.com/'))).toBe(false);

    vi.stubEnv('COOKIE_SECURE', 'TRUE');
    expect(isSecureRequest(makeRequest('http://192.168.1.50:3000/'))).toBe(true);

    // Unrecognized values fall through to protocol detection
    vi.stubEnv('COOKIE_SECURE', 'maybe');
    expect(isSecureRequest(makeRequest('http://192.168.1.50:3000/'))).toBe(false);
  });

  it('builds the shared session cookie attributes', () => {
    vi.stubEnv('COOKIE_SECURE', '');
    expect(sessionCookieOptions(makeRequest('http://localhost:3000/'), 900)).toEqual({
      name: SESSION_COOKIE_NAME,
      httpOnly: true,
      secure: false,
      sameSite: 'lax',
      path: '/',
      maxAge: 900,
    });
  });
});
