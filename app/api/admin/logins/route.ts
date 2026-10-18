import { NextResponse } from 'next/server';
import { requireAdmin } from '@/lib/auth/guards';
import { getPaginatedLogins } from '@/lib/db/queries';
import { parseBoundedInt } from '@/lib/db/validation';

const MAX_PAGE_SIZE = 100;

export async function GET(request: Request) {
  try {
    const guard = await requireAdmin();
    if (!guard.ok) return guard.response;

    const { searchParams } = new URL(request.url);
    const page = parseBoundedInt(searchParams.get('page'), 1, 1, Number.MAX_SAFE_INTEGER);
    const pageSize = parseBoundedInt(searchParams.get('pageSize'), 10, 1, MAX_PAGE_SIZE);

    const result = await getPaginatedLogins(page, pageSize);
    return NextResponse.json(result);
  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : 'Internal server error';
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
