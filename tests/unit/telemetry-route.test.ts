import { describe, it, expect, vi, beforeEach } from 'vitest';
import { GET } from '@/app/api/telemetry/route';
import * as omadaClientModule from '@/lib/omada/client';
import * as sessionModule from '@/lib/auth/session';
import * as dbQueries from '@/lib/db/queries';

const ADMIN_SESSION = {
  userId: 'u-admin',
  username: 'admin',
  email: 'admin@omadanoc.com',
  role: 'ADMIN' as const,
  lastActive: Date.now(),
};

const dbUser = (id: string, role: 'ADMIN' | 'USER') => ({
  id,
  username: id,
  email: `${id}@test.com`,
  role,
  createdAt: '',
  updatedAt: '',
});

describe('API Route: /api/telemetry', () => {
  beforeEach(() => {
    vi.restoreAllMocks();
    // Scoping uses the stored role, so the session user must exist in the database
    vi.spyOn(sessionModule, 'getCurrentSession').mockResolvedValue(ADMIN_SESSION);
    vi.spyOn(dbQueries, 'findUserById').mockImplementation(async (id: string) =>
      id === 'u-admin' ? dbUser('u-admin', 'ADMIN') : id === 'user-regular' ? dbUser('user-regular', 'USER') : null
    );
  });

  it('returns 200 with telemetry summary and sorted clients when controller is online', async () => {
    const mockClients = [
      { mac: '01', activity: 100, trafficDown: 1000, trafficUp: 500, uptime: 100 },
      { mac: '02', activity: 500, trafficDown: 5000, trafficUp: 2000, uptime: 200 },
    ];

    const mockStatus = {
      controllerOnline: true,
      omadacId: 'id-123',
      siteId: 'site-123',
      siteName: 'Default',
      totalClients: 2,
      wirelessClients: 1,
      wiredClients: 1,
      totalActivityRate: 600,
      totalTrafficDown: 6000,
      totalTrafficUp: 2500,
      lastUpdated: new Date().toISOString(),
      error: null,
    };

    const mockClientInstance = {
      getNetworkStatus: vi.fn().mockResolvedValue(mockStatus),
      getActiveClients: vi.fn().mockResolvedValue(mockClients),
      getTopology: vi.fn().mockResolvedValue([{ type: 'gateway', name: 'Gateway 1' }]),
      getLanNetworks: vi.fn().mockResolvedValue([{ id: 'net-1', name: 'Default', vlan: 1 }]),
      getSsids: vi.fn().mockResolvedValue([{ id: 's-1', name: 'SSID 1' }]),
      getPoeBudgets: vi.fn().mockResolvedValue([{ mac: '01', name: 'Switch', poeRemain: 100 }]),
      getDevices: vi.fn().mockResolvedValue([{ mac: '01', name: 'Switch', type: 'switch' }]),
    };

    vi.spyOn(omadaClientModule, 'getOmadaClient').mockReturnValue(mockClientInstance as any);

    // Test activity sorting (default) and all=true
    const req1 = new Request('http://localhost:3000/api/telemetry?limit=10&all=true&sort=activity');
    const res1 = await GET(req1);
    expect(res1.status).toBe(200);
    expect(res1.headers.get('Cache-Control')).toContain('no-store');

    const json1 = await res1.json();
    expect(json1.status.controllerOnline).toBe(true);
    expect(json1.topClients[0].mac).toBe('02'); // higher activity
    expect(json1.allClients).toHaveLength(2);

    // Test traffic sorting without all query param (includeAll = false)
    const req2 = new Request('http://localhost:3000/api/telemetry?sort=traffic');
    const res2 = await GET(req2);
    const json2 = await res2.json();
    expect(json2.topClients[0].mac).toBe('02');
    expect(json2.allClients).toBeUndefined();

    // Test uptime sorting without any other params
    const req3 = new Request('http://localhost:3000/api/telemetry?sort=uptime');
    const res3 = await GET(req3);
    const json3 = await res3.json();
    expect(json3.topClients[0].mac).toBe('02');

    // Test fallback sort branch
    const req4 = new Request('http://localhost:3000/api/telemetry?sort=unknown');
    const res4 = await GET(req4);
    const json4 = await res4.json();
    expect(json4.topClients).toHaveLength(2);

    // A non-numeric limit falls back to the default instead of returning no clients
    const res5 = await GET(new Request('http://localhost:3000/api/telemetry?limit=abc'));
    expect((await res5.json()).topClients).toHaveLength(2);

    const res6 = await GET(new Request('http://localhost:3000/api/telemetry?limit=1'));
    expect((await res6.json()).topClients).toHaveLength(1);
  });

  it('returns no clients when there is no session or the session user no longer exists', async () => {
    const mockClientInstance = {
      getNetworkStatus: vi.fn().mockResolvedValue({ controllerOnline: true, totalClients: 2 }),
      getActiveClients: vi.fn().mockResolvedValue([{ mac: '01' }, { mac: '02' }]),
      getNocEvents: vi.fn().mockResolvedValue([{ id: 'e1' }]),
    };
    vi.spyOn(omadaClientModule, 'getOmadaClient').mockReturnValue(mockClientInstance as any);

    vi.spyOn(sessionModule, 'getCurrentSession').mockResolvedValue(null);
    const json1 = await (await GET(new Request('http://localhost:3000/api/telemetry?all=true'))).json();
    expect(json1.topClients).toEqual([]);
    expect(json1.allClients).toEqual([]);
    expect(json1.status.totalClients).toBe(0);
    expect(json1.events).toBeUndefined();

    vi.spyOn(sessionModule, 'getCurrentSession').mockResolvedValue({ ...ADMIN_SESSION, userId: 'u-deleted' });
    const json2 = await (await GET(new Request('http://localhost:3000/api/telemetry'))).json();
    expect(json2.topClients).toEqual([]);

    // A failing user lookup also fails closed
    vi.spyOn(console, 'error').mockImplementation(() => {});
    vi.spyOn(dbQueries, 'findUserById').mockRejectedValue(new Error('DB down'));
    vi.spyOn(sessionModule, 'getCurrentSession').mockResolvedValue(ADMIN_SESSION);
    const json3 = await (await GET(new Request('http://localhost:3000/api/telemetry'))).json();
    expect(json3.topClients).toEqual([]);
  });

  it('scopes telemetry and recalculates KPIs for regular users with tagged devices', async () => {
    const mockClients = [
      { mac: 'AA:BB:CC:DD:EE:01', wireless: true, activity: 100, trafficDown: 1000, trafficUp: 500 },
      { mac: 'AA:BB:CC:DD:EE:02', wireless: false, activity: 200, trafficDown: 2000, trafficUp: 1000 },
      { mac: 'AA:BB:CC:DD:EE:03', wireless: true, activity: 300, trafficDown: 3000, trafficUp: 1500 },
    ];

    const mockStatus = {
      controllerOnline: true,
      omadacId: 'id-123',
      siteId: 'site-123',
      siteName: 'Default',
      totalClients: 3,
      wirelessClients: 2,
      wiredClients: 1,
      totalActivityRate: 600,
      totalTrafficDown: 6000,
      totalTrafficUp: 3000,
      lastUpdated: new Date().toISOString(),
      error: null,
    };

    const mockClientInstance = {
      getNetworkStatus: vi.fn().mockResolvedValue(mockStatus),
      getActiveClients: vi.fn().mockResolvedValue(mockClients),
    };

    vi.spyOn(omadaClientModule, 'getOmadaClient').mockReturnValue(mockClientInstance as any);
    vi.spyOn(sessionModule, 'getCurrentSession').mockResolvedValue({
      userId: 'user-regular',
      username: 'jdoe',
      email: 'jdoe@test.com',
      role: 'USER',
      lastActive: Date.now(),
    });

    // Stored canonically (dashed) while Omada reports colons here: must still match
    vi.spyOn(dbQueries, 'getUserDeviceTags').mockResolvedValue([
      {
        id: 't-1',
        userId: 'user-regular',
        macAddress: 'AA-BB-CC-DD-EE-01',
        deviceName: 'Work Laptop',
        createdAt: '',
      },
    ]);

    const req = new Request('http://localhost:3000/api/telemetry?all=true');
    const res = await GET(req);
    expect(res.status).toBe(200);

    const json = await res.json();
    expect(json.topClients).toHaveLength(1);
    expect(json.topClients[0].mac).toBe('AA:BB:CC:DD:EE:01');
    expect(json.status.totalClients).toBe(1);
    expect(json.status.wirelessClients).toBe(1);
    expect(json.status.wiredClients).toBe(0);
    expect(json.status.totalActivityRate).toBe(100);
    expect(json.status.totalTrafficDown).toBe(1000);
  });

  it('computes VLAN/SSID counts after scoping and hides site-wide data from scoped users', async () => {
    const mockClientInstance = {
      getNetworkStatus: vi.fn().mockResolvedValue({ controllerOnline: true, totalClients: 3 }),
      getActiveClients: vi.fn().mockResolvedValue([
        { mac: '30-68-93-E8-29-54', wireless: true, ssid: 'Staff', vlanId: 20, activity: 10 },
        { mac: '30-68-93-E8-29-55', wireless: true, ssid: 'Staff', vlanId: 20, activity: 20 },
        { mac: '30-68-93-E8-29-56', wireless: true, ssid: 'Guest', vlanId: 30, activity: 30 },
      ]),
      getLanNetworks: vi.fn().mockResolvedValue([
        { id: 'n20', name: 'Staff', vlan: 20 },
        { id: 'n30', name: 'Guest', vlan: 30 },
      ]),
      getSsids: vi.fn().mockResolvedValue([
        { id: 's1', name: 'Staff', vlanId: 20 },
        { id: 's2', name: 'Guest', vlanId: 30 },
      ]),
      getWanStatus: vi.fn().mockResolvedValue({
        gatewayModel: 'ER605',
        primaryWan: { port: 1, rxRate: 9000, txRate: 1000 },
        backupWan: { port: 2, rxRate: 50, txRate: 5 },
        dualWanMode: 'Failover',
        overallUptimePercent: 99,
      }),
      getNocEvents: vi.fn().mockResolvedValue([{ id: 'e1', clientMac: '30-68-93-E8-29-56' }]),
    };
    vi.spyOn(omadaClientModule, 'getOmadaClient').mockReturnValue(mockClientInstance as any);
    vi.spyOn(sessionModule, 'getCurrentSession').mockResolvedValue({
      userId: 'user-regular',
      username: 'jdoe',
      email: 'jdoe@test.com',
      role: 'USER',
      lastActive: Date.now(),
    });
    vi.spyOn(dbQueries, 'getUserDeviceTags').mockResolvedValue([
      { id: 't1', userId: 'user-regular', macAddress: '30:68:93:e8:29:54', createdAt: '' },
    ]);

    const json = await (await GET(new Request('http://localhost:3000/api/telemetry?all=true'))).json();
    expect(json.allClients).toHaveLength(1);
    expect(json.networks.map((n: { clientCount: number }) => n.clientCount)).toEqual([1, 0]);
    expect(json.ssids.map((s: { clientCount: number }) => s.clientCount)).toEqual([1, 0]);
    expect(json.events).toBeUndefined();
    expect(json.wanStatus.primaryWan).toMatchObject({ rxRate: 0, txRate: 0 });
    expect(json.wanStatus.backupWan).toMatchObject({ rxRate: 0, txRate: 0 });
    expect(json.wanStatus.gatewayModel).toBe('ER605');

    // Admins keep the unscoped view
    vi.spyOn(sessionModule, 'getCurrentSession').mockResolvedValue(ADMIN_SESSION);
    const adminJson = await (await GET(new Request('http://localhost:3000/api/telemetry?all=true'))).json();
    expect(adminJson.allClients).toHaveLength(3);
    expect(adminJson.networks.map((n: { clientCount: number }) => n.clientCount)).toEqual([2, 1]);
    expect(adminJson.events).toHaveLength(1);
    expect(adminJson.wanStatus.primaryWan.rxRate).toBe(9000);
  });

  it('fails closed for non-admins when the device tag lookup throws', async () => {
    vi.spyOn(console, 'error').mockImplementation(() => {});
    vi.spyOn(omadaClientModule, 'getOmadaClient').mockReturnValue({
      getNetworkStatus: vi.fn().mockResolvedValue({ controllerOnline: true, totalClients: 2, totalTrafficDown: 500 }),
      getActiveClients: vi.fn().mockResolvedValue([{ mac: '01' }, { mac: '02' }]),
    } as any);
    vi.spyOn(sessionModule, 'getCurrentSession').mockResolvedValue({
      userId: 'user-regular',
      username: 'jdoe',
      email: 'jdoe@test.com',
      role: 'USER',
      lastActive: Date.now(),
    });
    vi.spyOn(dbQueries, 'getUserDeviceTags').mockRejectedValue(new Error('DB down'));

    const json = await (await GET(new Request('http://localhost:3000/api/telemetry'))).json();
    expect(json.topClients).toEqual([]);
    expect(json.status.totalClients).toBe(0);
    expect(json.status.totalTrafficDown).toBe(0);
  });

  it('returns 503 when controller is offline', async () => {
    const mockStatus = {
      controllerOnline: false,
      omadacId: null,
      siteId: 'Default',
      totalClients: 0,
      wirelessClients: 0,
      wiredClients: 0,
      totalActivityRate: 0,
      totalTrafficDown: 0,
      totalTrafficUp: 0,
      lastUpdated: new Date().toISOString(),
      error: 'Connection timeout',
    };

    const mockClientInstance = {
      getNetworkStatus: vi.fn().mockResolvedValue(mockStatus),
    };

    vi.spyOn(omadaClientModule, 'getOmadaClient').mockReturnValue(mockClientInstance as any);

    const req = new Request('http://localhost:3000/api/telemetry');
    const res = await GET(req);
    expect(res.status).toBe(200);

    const json = await res.json();
    expect(json.status.controllerOnline).toBe(false);
    expect(json.topClients).toEqual([]);
  });

  it('handles errors when getActiveClients throws within online check', async () => {
    const mockStatus = {
      controllerOnline: true,
      omadacId: 'id-123',
      siteId: 'site-123',
      totalClients: 0,
      wirelessClients: 0,
      wiredClients: 0,
      totalActivityRate: 0,
      totalTrafficDown: 0,
      totalTrafficUp: 0,
      lastUpdated: new Date().toISOString(),
    };

    const mockClientInstance = {
      getNetworkStatus: vi.fn().mockResolvedValue(mockStatus),
      getActiveClients: vi.fn().mockRejectedValue(new Error('Site error')),
    };

    vi.spyOn(omadaClientModule, 'getOmadaClient').mockReturnValue(mockClientInstance as any);
    vi.spyOn(console, 'error').mockImplementation(() => {});

    const req = new Request('http://localhost:3000/api/telemetry');
    const res = await GET(req);
    expect(res.status).toBe(200);
    const json = await res.json();
    expect(json.topClients).toEqual([]);
  });

  it('handles top-level fatal exception and returns 500', async () => {
    vi.spyOn(omadaClientModule, 'getOmadaClient').mockImplementation(() => {
      throw new Error('Fatal client init failure');
    });

    const req = new Request('http://localhost:3000/api/telemetry');
    const res = await GET(req);
    expect(res.status).toBe(500);

    const json = await res.json();
    expect(json.error).toBe('Fatal client init failure');
    expect(json.status.controllerOnline).toBe(false);
  });
});
