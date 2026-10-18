import { describe, it, expect, vi, beforeEach } from 'vitest';
import { POST as runInsightHandler } from '@/app/api/admin/insights/run/route';
import { GET as historyInsightHandler } from '@/app/api/admin/insights/history/route';
import * as sessionModule from '@/lib/auth/session';
import * as insightsModule from '@/lib/ai/insights';
import * as dbQueries from '@/lib/db/queries';

describe('Admin AI Insights API Routes', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    // requireAdmin() authorizes against the stored role, not the JWT claim
    vi.spyOn(dbQueries, 'findUserById').mockImplementation(async (id: string) =>
      id === 'u-admin' || id === 'u-user'
        ? { id, username: id, email: `${id}@test.com`, role: id === 'u-admin' ? 'ADMIN' : 'USER', createdAt: '', updatedAt: '' }
        : null
    );
  });

  describe('POST /api/admin/insights/run', () => {
    it('rejects unauthenticated requests with 401', async () => {
      vi.spyOn(sessionModule, 'getCurrentSession').mockResolvedValue(null);

      const res = await runInsightHandler();
      expect(res.status).toBe(401);
    });

    it('rejects non-admin users with 403', async () => {
      vi.spyOn(sessionModule, 'getCurrentSession').mockResolvedValue({
        userId: 'u-user',
        username: 'regular',
        email: 'user@test.com',
        role: 'USER',
        lastActive: Date.now(),
      });

      const res = await runInsightHandler();
      expect(res.status).toBe(403);
    });

    it('executes comparative insight and returns 200 for admins', async () => {
      vi.spyOn(sessionModule, 'getCurrentSession').mockResolvedValue({
        userId: 'u-admin',
        username: 'admin',
        email: 'admin@omadanoc.com',
        role: 'ADMIN',
        lastActive: Date.now(),
      });

      vi.spyOn(insightsModule, 'runComparativeAiInsight').mockResolvedValue({
        id: 'ins-1',
        createdAt: '2026-08-28T12:00:00Z',
        triggeredByUserId: 'u-admin',
        healthScore: 92,
        previousScore: null,
        scoreDelta: 0,
        trendDirection: 'INITIAL',
        executiveSummary: 'Initial test',
        resolvedIssues: [],
        persistingIssues: [],
        newIssues: [],
        actionableSuggestions: [],
        metricsSnapshot: {},
      });

      const res = await runInsightHandler();
      expect(res.status).toBe(200);
      const json = await res.json();
      expect(json.success).toBe(true);
      expect(json.insight.healthScore).toBe(92);
    });

    it('handles unexpected exceptions and returns 500', async () => {
      const consoleSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
      vi.spyOn(sessionModule, 'getCurrentSession').mockResolvedValue({
        userId: 'u-admin',
        username: 'admin',
        email: 'admin@omadanoc.com',
        role: 'ADMIN',
        lastActive: Date.now(),
      });

      vi.spyOn(insightsModule, 'runComparativeAiInsight').mockRejectedValue(new Error('Diagnostic failed'));

      const res = await runInsightHandler();
      expect(res.status).toBe(500);
      const json = await res.json();
      expect(json.error).toBe('Diagnostic failed');
      expect(consoleSpy).toHaveBeenCalled();
    });
  });

  describe('GET /api/admin/insights/history', () => {
    it('rejects unauthenticated requests with 401', async () => {
      vi.spyOn(sessionModule, 'getCurrentSession').mockResolvedValue(null);
      const req = new Request('http://localhost/api/admin/insights/history');
      const res = await historyInsightHandler(req);
      expect(res.status).toBe(401);
    });

    it('rejects non-admin users with 403', async () => {
      vi.spyOn(sessionModule, 'getCurrentSession').mockResolvedValue({
        userId: 'u-user',
        username: 'regular',
        email: 'user@test.com',
        role: 'USER',
        lastActive: Date.now(),
      });
      const req = new Request('http://localhost/api/admin/insights/history');
      const res = await historyInsightHandler(req);
      expect(res.status).toBe(403);
    });

    it('returns history array for admin session', async () => {
      vi.spyOn(sessionModule, 'getCurrentSession').mockResolvedValue({
        userId: 'u-admin',
        username: 'admin',
        email: 'admin@omadanoc.com',
        role: 'ADMIN',
        lastActive: Date.now(),
      });

      vi.spyOn(dbQueries, 'getRecentAiInsights').mockResolvedValue([
        {
          id: 'ins-1',
          createdAt: '2026-08-28T12:00:00Z',
          triggeredByUserId: 'u-admin',
          healthScore: 92,
          previousScore: null,
          scoreDelta: 0,
          trendDirection: 'INITIAL',
          executiveSummary: 'Test',
          resolvedIssues: [],
          persistingIssues: [],
          newIssues: [],
          actionableSuggestions: [],
          metricsSnapshot: {},
        },
      ]);

      const req = new Request('http://localhost/api/admin/insights/history?limit=5');
      const res = await historyInsightHandler(req);

      expect(res.status).toBe(200);
      const json = await res.json();
      expect(json.history.length).toBe(1);
      expect(dbQueries.getRecentAiInsights).toHaveBeenLastCalledWith(5);

      // Non-numeric limits fall back to the default; huge limits are clamped
      await historyInsightHandler(new Request('http://localhost/api/admin/insights/history?limit=abc'));
      expect(dbQueries.getRecentAiInsights).toHaveBeenLastCalledWith(10);
      await historyInsightHandler(new Request('http://localhost/api/admin/insights/history?limit=999999'));
      expect(dbQueries.getRecentAiInsights).toHaveBeenLastCalledWith(100);
    });

    it('rejects a demoted admin whose JWT still claims ADMIN', async () => {
      vi.spyOn(sessionModule, 'getCurrentSession').mockResolvedValue({
        userId: 'u-user',
        username: 'formerly-admin',
        email: 'user@test.com',
        role: 'ADMIN',
        lastActive: Date.now(),
      });
      const res = await historyInsightHandler(new Request('http://localhost/api/admin/insights/history'));
      expect(res.status).toBe(403);
    });

    it('handles unexpected exceptions and returns 500', async () => {
      const consoleSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
      vi.spyOn(sessionModule, 'getCurrentSession').mockResolvedValue({
        userId: 'u-admin',
        username: 'admin',
        email: 'admin@omadanoc.com',
        role: 'ADMIN',
        lastActive: Date.now(),
      });

      vi.spyOn(dbQueries, 'getRecentAiInsights').mockRejectedValue(new Error('DB read error'));

      const req = new Request('http://localhost/api/admin/insights/history');
      const res = await historyInsightHandler(req);

      expect(res.status).toBe(500);
      const json = await res.json();
      expect(json.error).toBe('DB read error');
      expect(consoleSpy).toHaveBeenCalled();
    });
  });

  describe('POST /api/admin/insights/agent', () => {
    it('rejects unauthenticated requests with 401', async () => {
      const { POST: agentInsightHandler } = await import('@/app/api/admin/insights/agent/route');
      vi.spyOn(sessionModule, 'getCurrentSession').mockResolvedValue(null);

      const res = await agentInsightHandler();
      expect(res.status).toBe(401);
    });

    it('rejects non-admin requests with 403', async () => {
      const { POST: agentInsightHandler } = await import('@/app/api/admin/insights/agent/route');
      vi.spyOn(sessionModule, 'getCurrentSession').mockResolvedValue({
        userId: 'u-user',
        username: 'user',
        email: 'user@test.com',
        role: 'USER',
        lastActive: Date.now(),
      });

      const res = await agentInsightHandler();
      expect(res.status).toBe(403);
    });

    it('executes DeepSeek LLM Agent and returns 200 for admins', async () => {
      const { POST: agentInsightHandler } = await import('@/app/api/admin/insights/agent/route');
      vi.spyOn(sessionModule, 'getCurrentSession').mockResolvedValue({
        userId: 'u-admin',
        username: 'admin',
        email: 'admin@omadanoc.com',
        role: 'ADMIN',
        lastActive: Date.now(),
      });

      vi.spyOn(insightsModule, 'runDeepSeekAgentInsight').mockResolvedValue({
        id: 'ins-agent-1',
        createdAt: '2026-08-28T12:00:00Z',
        triggeredByUserId: 'u-admin',
        healthScore: 96,
        previousScore: null,
        scoreDelta: 0,
        trendDirection: 'INITIAL',
        executiveSummary: 'DeepSeek-R1 agent verification complete.',
        engineType: 'DEEPSEEK_AGENT',
        llmModel: 'deepseek-r1:7b',
        resolvedIssues: [],
        persistingIssues: [],
        newIssues: [],
        actionableSuggestions: [],
        metricsSnapshot: {},
      });

      const res = await agentInsightHandler();
      expect(res.status).toBe(200);
      const json = await res.json();
      expect(json.success).toBe(true);
      expect(json.insight.engineType).toBe('DEEPSEEK_AGENT');
    });

    it('handles unexpected exceptions and returns 500', async () => {
      const { POST: agentInsightHandler } = await import('@/app/api/admin/insights/agent/route');
      const consoleSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
      vi.spyOn(sessionModule, 'getCurrentSession').mockResolvedValue({
        userId: 'u-admin',
        username: 'admin',
        email: 'admin@omadanoc.com',
        role: 'ADMIN',
        lastActive: Date.now(),
      });

      vi.spyOn(insightsModule, 'runDeepSeekAgentInsight').mockRejectedValue(new Error('Ollama offline'));

      const res = await agentInsightHandler();
      expect(res.status).toBe(500);
      const json = await res.json();
      expect(json.error).toBe('Ollama offline');
      expect(consoleSpy).toHaveBeenCalled();
    });
  });
});
