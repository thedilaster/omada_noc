import { NextResponse } from 'next/server';
import { getCurrentSession } from './session';
import { findUserById } from '@/lib/db/queries';
import { SessionPayload, UserRecord } from '@/types/auth';

export type AdminGuardResult =
  | { ok: true; session: SessionPayload; user: UserRecord }
  | { ok: false; response: NextResponse };

/**
 * Authorizes an admin API request against the database, not the JWT role claim, so a
 * demoted or deleted admin loses access immediately instead of when their token expires.
 * Returns 401 for a missing session or deleted user and 403 when the stored role is not ADMIN.
 */
export async function requireAdmin(): Promise<AdminGuardResult> {
  const session = await getCurrentSession();
  if (!session) {
    return {
      ok: false,
      response: NextResponse.json({ error: 'Unauthorized. Active session required.' }, { status: 401 }),
    };
  }

  const user = await findUserById(session.userId);
  if (!user) {
    return {
      ok: false,
      response: NextResponse.json({ error: 'Unauthorized. Account no longer exists.' }, { status: 401 }),
    };
  }

  if (user.role !== 'ADMIN') {
    return {
      ok: false,
      response: NextResponse.json({ error: 'Forbidden: Admin access required' }, { status: 403 }),
    };
  }

  return { ok: true, session, user };
}
