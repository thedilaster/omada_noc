import { describe, it, expect, vi, beforeEach } from 'vitest';
import Page from '@/app/page';
import * as omadaClientModule from '@/lib/omada/client';
import * as sessionModule from '@/lib/auth/session';
import * as dbQueries from '@/lib/db/queries';
import * as navigationModule from 'next/navigation';

vi.mock('next/navigation', () => ({
  redirect: vi.fn(),
}));

describe('Server Page (app/page.tsx)', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.spyOn(dbQueries, 'findUserById').mockResolvedValue({
      id: 'u-admin',
      username: 'admin',
      email: 'admin@omadanoc.com',
      role: 'ADMIN',
      createdAt: '',
      updatedAt: '',
    });
  });

  it('redirects to /login if user is unauthenticated', async () => {
    vi.spyOn(sessionModule, 'getCurrentSession').mockResolvedValue(null);

    await Page();
    expect(navigationModule.redirect).toHaveBeenCalledWith('/login');
  });

  it('redirects to /login if session user is no longer found in the database', async () => {
    vi.spyOn(sessionModule, 'getCurrentSession').mockResolvedValue({
      userId: 'u-deleted',
      username: 'ghost',
      email: 'ghost@test.com',
      role: 'USER',
      lastActive: Date.now(),
    });
    vi.spyOn(dbQueries, 'findUserById').mockResolvedValue(null);

    await Page();
    // The logout route clears the orphaned cookie; redirecting to /login directly would loop
    expect(navigationModule.redirect).toHaveBeenCalledWith('/api/auth/logout');
  });

  it('renders Dashboard with initial data for authenticated admin', async () => {
    vi.spyOn(sessionModule, 'getCurrentSession').mockResolvedValue({
      userId: 'u-admin',
      username: 'admin',
      email: 'admin@omadanoc.com',
      role: 'ADMIN',
      lastActive: Date.now(),
    });

    const mockStatus = {
      controllerOnline: true,
      omadacId: 'id-123',
      siteId: 'site-123',
      totalClients: 1,
      wirelessClients: 1,
      wiredClients: 0,
      totalActivityRate: 100,
      totalTrafficDown: 1000,
      totalTrafficUp: 500,
      lastUpdated: new Date().toISOString(),
    };

    const mockClients = [
      { mac: '01', name: 'Device 1', ip: '192.168.1.10', wireless: true, ssid: 'Farm-WiFi', vlanId: 1 },
    ];

    const mockClientInstance = {
      getNetworkStatus: vi.fn().mockResolvedValue(mockStatus),
      getActiveClients: vi.fn().mockResolvedValue(mockClients),
      getTopology: vi.fn().mockResolvedValue([{ type: 'gateway', name: 'G1' }]),
      getLanNetworks: vi.fn().mockResolvedValue([{ id: '1', name: 'Default', vlan: 1 }]),
      getSsids: vi.fn().mockResolvedValue([{ id: 's1', name: 'Farm-WiFi' }]),
      getPoeBudgets: vi.fn().mockResolvedValue([]),
    };

    vi.spyOn(omadaClientModule, 'getOmadaClient').mockReturnValue(mockClientInstance as any);

    const jsx = await Page();
    expect(jsx).toBeDefined();
    expect(jsx!.props.initialData.status.controllerOnline).toBe(true);
    expect(jsx!.props.initialData.topClients).toHaveLength(1);
    expect(jsx!.props.initialData.networks).toHaveLength(1);
    expect(jsx!.props.initialData.ssids).toHaveLength(1);
  });

  it('scopes telemetry and recalculates KPIs for regular users with tagged devices', async () => {
    vi.spyOn(sessionModule, 'getCurrentSession').mockResolvedValue({
      userId: 'u-regular',
      username: 'jdoe',
      email: 'jdoe@test.com',
      role: 'USER',
      lastActive: Date.now(),
    });
    vi.spyOn(dbQueries, 'findUserById').mockResolvedValue({
      id: 'u-regular',
      username: 'jdoe',
      email: 'jdoe@test.com',
      role: 'USER',
      createdAt: '',
      updatedAt: '',
    });

    vi.spyOn(dbQueries, 'getUserDeviceTags').mockResolvedValue([
      {
        id: 'tag-1',
        userId: 'u-regular',
        macAddress: '01',
        deviceName: 'My Laptop',
        createdAt: '',
      },
    ]);

    const mockStatus = {
      controllerOnline: true,
      omadacId: 'id-123',
      siteId: 'site-123',
      totalClients: 2,
      wirelessClients: 1,
      wiredClients: 1,
      totalActivityRate: 300,
      totalTrafficDown: 3000,
      totalTrafficUp: 1500,
      lastUpdated: new Date().toISOString(),
    };

    const mockClients = [
      { mac: '01', name: 'My Laptop', wireless: true, activity: 100, trafficDown: 1000, trafficUp: 500 },
      { mac: '02', name: 'Other Device', wireless: false, activity: 200, trafficDown: 2000, trafficUp: 1000 },
    ];

    const mockClientInstance = {
      getNetworkStatus: vi.fn().mockResolvedValue(mockStatus),
      getActiveClients: vi.fn().mockResolvedValue(mockClients),
    };

    vi.spyOn(omadaClientModule, 'getOmadaClient').mockReturnValue(mockClientInstance as any);

    const jsx = await Page();
    expect(jsx).toBeDefined();
    expect(jsx!.props.initialData.topClients).toHaveLength(1);
    expect(jsx!.props.initialData.topClients[0].mac).toBe('01');
    expect(jsx!.props.initialData.status.totalClients).toBe(1);
  });

  it('handles getActiveClients error when controller is online gracefully', async () => {
    vi.spyOn(sessionModule, 'getCurrentSession').mockResolvedValue({
      userId: 'u-admin',
      username: 'admin',
      email: 'admin@omadanoc.com',
      role: 'ADMIN',
      lastActive: Date.now(),
    });

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
      getActiveClients: vi.fn().mockRejectedValue(new Error('Fetch failed')),
    };

    vi.spyOn(omadaClientModule, 'getOmadaClient').mockReturnValue(mockClientInstance as any);

    const jsx = await Page();
    expect(jsx).toBeDefined();
    expect(jsx!.props.initialData.topClients).toEqual([]);
  });

  it('renders Dashboard with offline status when controller is offline', async () => {
    vi.spyOn(sessionModule, 'getCurrentSession').mockResolvedValue({
      userId: 'u-admin',
      username: 'admin',
      email: 'admin@omadanoc.com',
      role: 'ADMIN',
      lastActive: Date.now(),
    });

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
      error: 'Controller unreachable',
    };

    const mockClientInstance = {
      getNetworkStatus: vi.fn().mockResolvedValue(mockStatus),
      getActiveClients: vi.fn(),
    };

    vi.spyOn(omadaClientModule, 'getOmadaClient').mockReturnValue(mockClientInstance as any);

    const jsx = await Page();
    expect(jsx).toBeDefined();
    expect(jsx!.props.initialData.status.controllerOnline).toBe(false);
    expect(mockClientInstance.getActiveClients).not.toHaveBeenCalled();
  });

  describe('device scoping for regular users', () => {
    const regularSession = {
      userId: 'u-regular',
      username: 'jdoe',
      email: 'jdoe@test.com',
      role: 'USER' as const,
      lastActive: Date.now(),
    };

    const onlineStatus = {
      controllerOnline: true,
      omadacId: 'id-123',
      siteId: 'site-123',
      totalClients: 2,
      wirelessClients: 2,
      wiredClients: 0,
      totalActivityRate: 300,
      totalTrafficDown: 3000,
      totalTrafficUp: 1500,
      lastUpdated: new Date().toISOString(),
    };

    const mockOmada = () =>
      vi.spyOn(omadaClientModule, 'getOmadaClient').mockReturnValue({
        getNetworkStatus: vi.fn().mockResolvedValue({ ...onlineStatus }),
        getActiveClients: vi.fn().mockResolvedValue([
          { mac: '30-68-93-E8-29-54', name: 'Mine', ip: '10.0.20.5', wireless: true, ssid: 'Staff', vlanId: 20, activity: 100 },
          { mac: 'AA-BB-CC-DD-EE-FF', name: 'Other', ip: '10.0.20.6', wireless: true, ssid: 'Staff', vlanId: 20, activity: 200 },
        ]),
        getLanNetworks: vi.fn().mockResolvedValue([{ id: 'n20', name: 'Staff', vlan: 20, gatewaySubnet: '10.0.20.1/24' }]),
        getSsids: vi.fn().mockResolvedValue([{ id: 's1', name: 'Staff', vlanId: 20 }]),
        getWanStatus: vi.fn().mockResolvedValue({
          gatewayModel: 'ER605',
          primaryWan: { port: 1, name: 'WAN1', rxRate: 5000, txRate: 900 },
          dualWanMode: 'Failover',
          overallUptimePercent: 100,
        }),
        getNocEvents: vi.fn().mockResolvedValue([{ id: 'e1', clientMac: 'AA-BB-CC-DD-EE-FF', title: 'Roam' }]),
      } as any);

    beforeEach(() => {
      vi.spyOn(sessionModule, 'getCurrentSession').mockResolvedValue(regularSession);
      vi.spyOn(dbQueries, 'findUserById').mockResolvedValue({
        id: 'u-regular',
        username: 'jdoe',
        email: 'jdoe@test.com',
        role: 'USER',
        createdAt: '',
        updatedAt: '',
      });
    });

    it('matches tags regardless of MAC notation and hides other clients from aggregates', async () => {
      mockOmada();
      vi.spyOn(dbQueries, 'getUserDeviceTags').mockResolvedValue([
        { id: 't1', userId: 'u-regular', macAddress: '30:68:93:e8:29:54', createdAt: '' },
      ]);

      const jsx = await Page();
      const data = jsx!.props.initialData;
      expect(data.allClients.map((c: { mac: string }) => c.mac)).toEqual(['30-68-93-E8-29-54']);
      expect(data.status.totalClients).toBe(1);
      expect(data.status.totalActivityRate).toBe(100);
      // Per-VLAN / per-SSID counts are computed after scoping
      expect(data.networks[0].clientCount).toBe(1);
      expect(data.ssids[0].clientCount).toBe(1);
      // Events name other clients and WAN rates are site-wide, so neither leaks to scoped users
      expect(data.events).toBeUndefined();
      expect(data.wanStatus.primaryWan.rxRate).toBe(0);
      expect(data.wanStatus.primaryWan.txRate).toBe(0);
    });

    it('fails closed (no clients) when the device tag lookup throws', async () => {
      mockOmada();
      vi.spyOn(console, 'error').mockImplementation(() => {});
      vi.spyOn(dbQueries, 'getUserDeviceTags').mockRejectedValue(new Error('DB down'));

      const jsx = await Page();
      const data = jsx!.props.initialData;
      expect(data.allClients).toEqual([]);
      expect(data.topClients).toEqual([]);
      expect(data.status.totalClients).toBe(0);
      expect(data.status.totalActivityRate).toBe(0);
      expect(data.events).toBeUndefined();
    });

    it('shows everything to users with no tagged devices', async () => {
      mockOmada();
      vi.spyOn(dbQueries, 'getUserDeviceTags').mockResolvedValue([]);

      const jsx = await Page();
      const data = jsx!.props.initialData;
      expect(data.allClients).toHaveLength(2);
      expect(data.networks[0].clientCount).toBe(2);
      expect(data.events).toHaveLength(1);
      expect(data.wanStatus.primaryWan.rxRate).toBe(5000);
    });

    it('scopes a demoted admin using the stored role rather than the JWT claim', async () => {
      mockOmada();
      vi.spyOn(sessionModule, 'getCurrentSession').mockResolvedValue({ ...regularSession, role: 'ADMIN' });
      vi.spyOn(dbQueries, 'getUserDeviceTags').mockResolvedValue([
        { id: 't1', userId: 'u-regular', macAddress: '30-68-93-E8-29-54', createdAt: '' },
      ]);

      const jsx = await Page();
      expect(jsx!.props.initialData.allClients).toHaveLength(1);
    });
  });
});
