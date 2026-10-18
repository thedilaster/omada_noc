import { NextResponse } from 'next/server';
import { requireAdmin } from '@/lib/auth/guards';
import { getRecentAiInsights } from '@/lib/db/queries';
import { parseBoundedInt } from '@/lib/db/validation';

export async function GET(request: Request) {
  try {
    const guard = await requireAdmin();
    if (!guard.ok) return guard.response;

    const { searchParams } = new URL(request.url);
    const limit = parseBoundedInt(searchParams.get('limit'), 10, 1, 100);

    const history = await getRecentAiInsights(limit);
    return NextResponse.json({ success: true, history });
  } catch (error: unknown) {
    console.error('Fetch AI insights history error:', error);
    const message = error instanceof Error ? error.message : 'Failed to fetch AI insights history';
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
