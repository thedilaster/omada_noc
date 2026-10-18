import { describe, it, expect, vi, beforeEach } from 'vitest';
import * as dbQueries from '@/lib/db/queries';
import { resolveAllowedMacs, resolveTelemetryViewer, scopeTelemetry } from '@/lib/auth/device-scope';
import { NetworkStatusSummary, OmadaClientDevice } from '@/types/omada';

const status: NetworkStatusSummary = {
  controllerOnline: true,
  omadacId: 'c1',
  siteId: 's1',
  totalClients: 2,
  wirelessClients: 1,
  wiredClients: 1,
  totalActivityRate: 30,
  totalTrafficDown: 300,
  totalTrafficUp: 30,
  lastUpdated: '2026-10-17T00:00:00Z',
};

const clients: OmadaClientDevice[] = [
  { mac: '30-68-93-E8-29-54', ip: '10.0.0.2', wireless: true, activity: 10, trafficDown: 100, trafficUp: 10 },
  { mac: '30-68-93-E8-29-55', ip: '10.0.0.3', wireless: false },
];

describe('Telemetry device scoping helper (lib/auth/device-scope)', () => {
  beforeEach(() => {
    vi.restoreAllMocks();
  });

  it('resolves the viewer from the database role', async () => {
    vi.spyOn(dbQueries, 'findUserById').mockResolvedValue({
      id: 'u1',
      username: 'u1',
      email: 'u1@test.com',
      role: 'USER',
      createdAt: '',
      updatedAt: '',
    });
    expect(await resolveTelemetryViewer(null)).toBeNull();
    expect(
      await resolveTelemetryViewer({ userId: 'u1', username: 'u1', email: 'u1@test.com', role: 'ADMIN', lastActive: 0 })
    ).toEqual({ userId: 'u1', role: 'USER' });
  });

  it('gives admins and untagged users unrestricted access, and fails closed otherwise', async () => {
    const tagSpy = vi.spyOn(dbQueries, 'getUserDeviceTags').mockResolvedValue([]);
    expect(await resolveAllowedMacs({ userId: 'a', role: 'ADMIN' })).toBeNull();
    expect(tagSpy).not.toHaveBeenCalled();
    expect(await resolveAllowedMacs({ userId: 'u', role: 'USER' })).toBeNull();
    expect(await resolveAllowedMacs(null)).toEqual(new Set());

    tagSpy.mockResolvedValue([{ id: 't', userId: 'u', macAddress: '30:68:93:e8:29:54', createdAt: '' }]);
    expect(await resolveAllowedMacs({ userId: 'u', role: 'USER' })).toEqual(new Set(['306893E82954']));
  });

  it('leaves missing or empty network, SSID, and WAN data untouched', async () => {
    vi.spyOn(dbQueries, 'getUserDeviceTags').mockResolvedValue([
      { id: 't', userId: 'u', macAddress: '30-68-93-E8-29-54', createdAt: '' },
    ]);

    const scoped = await scopeTelemetry({ userId: 'u', role: 'USER' }, { status, clients, networks: [], ssids: undefined });
    expect(scoped.scoped).toBe(true);
    expect(scoped.clients).toHaveLength(1);
    expect(scoped.status).toMatchObject({
      totalClients: 1,
      wirelessClients: 1,
      wiredClients: 0,
      totalActivityRate: 10,
      totalTrafficDown: 100,
      totalTrafficUp: 10,
    });
    expect(scoped.networks).toEqual([]);
    expect(scoped.ssids).toBeUndefined();
    expect(scoped.wanStatus).toBeUndefined();

    // Scoped KPIs tolerate clients without traffic counters
    vi.spyOn(dbQueries, 'getUserDeviceTags').mockResolvedValue([
      { id: 't', userId: 'u', macAddress: '30-68-93-E8-29-55', createdAt: '' },
    ]);
    const wiredOnly = await scopeTelemetry({ userId: 'u', role: 'USER' }, { status, clients });
    expect(wiredOnly.status).toMatchObject({ totalClients: 1, wiredClients: 1, totalActivityRate: 0, totalTrafficDown: 0 });
  });

  it('zeroes WAN rates without inventing a backup WAN', async () => {
    vi.spyOn(dbQueries, 'getUserDeviceTags').mockResolvedValue([
      { id: 't', userId: 'u', macAddress: '30-68-93-E8-29-54', createdAt: '' },
    ]);
    const wanStatus = {
      gatewayModel: 'ER605',
      primaryWan: { rxRate: 10, txRate: 5 },
      dualWanMode: 'Failover',
      overallUptimePercent: 100,
    } as any;

    const scoped = await scopeTelemetry({ userId: 'u', role: 'USER' }, { status, clients, wanStatus });
    expect(scoped.wanStatus?.primaryWan).toMatchObject({ rxRate: 0, txRate: 0 });
    expect(scoped.wanStatus).not.toHaveProperty('backupWan');
    expect(wanStatus.primaryWan.rxRate).toBe(10);

    const unscoped = await scopeTelemetry({ userId: 'a', role: 'ADMIN' }, { status, clients, wanStatus });
    expect(unscoped.scoped).toBe(false);
    expect(unscoped.status).toBe(status);
    expect(unscoped.wanStatus).toBe(wanStatus);
  });
});
