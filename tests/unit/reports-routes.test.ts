import { describe, it, expect, vi, beforeEach } from 'vitest';
import { GET as reportsSummaryHandler } from '@/app/api/reports/summary/route';
import * as sessionModule from '@/lib/auth/session';
import * as aggregationModule from '@/lib/reports/aggregation';

describe('Reports API Route (/api/reports/summary)', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('rejects unauthenticated requests with 401', async () => {
    vi.spyOn(sessionModule, 'getCurrentSession').mockResolvedValue(null);

    const res = await reportsSummaryHandler();
    expect(res.status).toBe(401);
    const json = await res.json();
    expect(json.error).toContain('Unauthorized');
  });

  it('returns aggregated executive report for authenticated sessions', async () => {
    vi.spyOn(sessionModule, 'getCurrentSession').mockResolvedValue({
      userId: 'u-1',
      username: 'admin',
      email: 'admin@omadanoc.com',
      role: 'ADMIN',
      lastActive: Date.now(),
    });

    vi.spyOn(aggregationModule, 'getReportSummary').mockResolvedValue({
      generatedAt: '2026-08-28T12:00:00Z',
      siteName: 'The Farm',
      controllerUptime: '10d',
      networkHealthScore: 95,
      infrastructure: {} as any,
      topActiveDevices: [],
      topVolumeDevices: [],
      topActiveUsers: [],
      rfDistribution: {} as any,
      securitySummary: {} as any,
    });

    const res = await reportsSummaryHandler();
    expect(res.status).toBe(200);
    const json = await res.json();
    expect(json.success).toBe(true);
    expect(json.report.siteName).toBe('The Farm');
    expect(aggregationModule.getReportSummary).toHaveBeenCalledWith(undefined, { userId: 'u-1', role: 'ADMIN' });
  });

  it('passes the non-admin session through so the report is scoped', async () => {
    vi.spyOn(sessionModule, 'getCurrentSession').mockResolvedValue({
      userId: 'u-7',
      username: 'viewer',
      email: 'viewer@omadanoc.com',
      role: 'USER',
      lastActive: Date.now(),
    });
    const summarySpy = vi.spyOn(aggregationModule, 'getReportSummary').mockResolvedValue({
      generatedAt: '2026-08-28T12:00:00Z',
      siteName: 'Site',
      controllerUptime: 'Unknown',
      networkHealthScore: 100,
      infrastructure: {} as any,
      topActiveDevices: [],
      topVolumeDevices: [],
      topActiveUsers: [],
      rfDistribution: {} as any,
    });

    const res = await reportsSummaryHandler();
    expect(res.status).toBe(200);
    expect(summarySpy).toHaveBeenCalledWith(undefined, { userId: 'u-7', role: 'USER' });
    const json = await res.json();
    expect(json.report.securitySummary).toBeUndefined();
  });

  it('handles unexpected exceptions and returns 500', async () => {
    const consoleSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
    vi.spyOn(sessionModule, 'getCurrentSession').mockResolvedValue({
      userId: 'u-1',
      username: 'admin',
      email: 'admin@omadanoc.com',
      role: 'ADMIN',
      lastActive: Date.now(),
    });

    vi.spyOn(aggregationModule, 'getReportSummary').mockRejectedValue(new Error('Controller timeout'));

    const res = await reportsSummaryHandler();
    expect(res.status).toBe(500);
    const json = await res.json();
    expect(json.error).toBe('Controller timeout');
    expect(consoleSpy).toHaveBeenCalled();
  });
});
