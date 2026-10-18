import { NextResponse } from 'next/server';
import { requireAdmin } from '@/lib/auth/guards';
import { runDeepSeekAgentInsight } from '@/lib/ai/insights';

export async function POST() {
  try {
    const guard = await requireAdmin();
    if (!guard.ok) return guard.response;

    const insight = await runDeepSeekAgentInsight(guard.session.userId);
    return NextResponse.json({ success: true, insight });
  } catch (error: unknown) {
    console.error('Run DeepSeek Agent insight error:', error);
    const message = error instanceof Error ? error.message : 'Failed to execute DeepSeek LLM Agent diagnostic';
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
