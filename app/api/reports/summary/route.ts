import { NextResponse } from 'next/server';
import { getCurrentSession } from '@/lib/auth/session';
import { getReportSummary } from '@/lib/reports/aggregation';

export async function GET() {
  try {
    const session = await getCurrentSession();
    if (!session) {
      return NextResponse.json({ error: 'Unauthorized. Active session required.' }, { status: 401 });
    }

    // Non-admins get a report scoped to their tagged devices, without operator/login audit data
    const report = await getReportSummary(undefined, { userId: session.userId, role: session.role });
    return NextResponse.json({ success: true, report });
  } catch (error: unknown) {
    console.error('Reports summary API error:', error);
    const message = error instanceof Error ? error.message : 'Failed to generate report summary';
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
