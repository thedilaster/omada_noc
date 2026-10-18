import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { getReportSummary } from '@/lib/reports/aggregation';
import * as dbQueries from '@/lib/db/queries';

const ADMIN = { userId: 'u-1', role: 'ADMIN' as const };
const USER = { userId: 'u-2', role: 'USER' as const };

const mockUsers = [
  {
    id: 'u-1',
    username: 'admin',
    email: 'admin@omadanoc.com',
    role: 'ADMIN' as const,
    createdAt: '2026-01-01T00:00:00Z',
    updatedAt: '2026-01-01T00:00:00Z',
    profile: {
      id: 'p-1',
      userId: 'u-1',
      fullName: 'System Admin',
      jobTitle: 'Lead',
      department: 'NOC',
      avatarUrl: '',
      theme: 'dark' as const,
      updatedAt: '',
    },
    taggedDevices: [
      { id: 't-1', userId: 'u-1', macAddress: 'AA:BB:CC:DD:EE:01', createdAt: '' },
      { id: 't-2', userId: 'u-1', macAddress: 'AA:BB:CC:DD:EE:02', createdAt: '' },
    ],
  },
];

const mockLogins = {
  items: [
    {
      id: 'l-1',
      userId: 'u-1',
      email: 'admin@omadanoc.com',
      ipAddress: '127.0.0.1',
      userAgent: 'TestAgent',
      loginStatus: 'SUCCESS' as const,
      failureReason: null,
      createdAt: '2026-08-28T00:00:00Z',
    },
  ],
  total: 1,
  page: 1,
  pageSize: 100,
  totalPages: 1,
};

const mockClients = [
  {
    mac: 'AA:BB:CC:DD:EE:01',
    name: 'MacBook-Pro',
    ip: '192.168.1.100',
    wireless: true,
    ssid: 'Farm-WiFi',
    apName: 'EAP-Main',
    channel: 36, // 5GHz
    rssi: -55, // Excellent
    activity: 2500000, // 20 Mbps down
    uploadActivity: 125000, // 1 Mbps up
    rxRate: 1500000, // PHY link rate (Kbps) — must not be read as throughput
    txRate: 1000000,
    trafficDown: 500000000,
    trafficUp: 200000000,
    uptime: 3600,
  },
  {
    mac: 'AA-BB-CC-DD-EE-02',
    name: 'iPhone-15',
    ip: '192.168.1.101',
    wireless: true,
    ssid: 'Farm-WiFi',
    apName: 'EAP-Barn',
    channel: 6, // 2.4GHz
    rssi: -85, // Poor
    activity: 500000,
    rxRate: 300000,
    txRate: 200000,
    trafficDown: 100000000,
    trafficUp: 50000000,
    uptime: 1800,
  },
  {
    mac: 'AA:BB:CC:DD:EE:03',
    name: 'Workstation-LAN',
    ip: '192.168.1.50',
    wireless: false,
    switchName: 'Core-Switch',
    port: 4,
    activity: 10000000, // 80 Mbps down
    uploadActivity: 2500000, // 20 Mbps up
    rxRate: 6000000,
    txRate: 4000000,
    trafficDown: 2000000000,
    trafficUp: 1000000000,
    uptime: 7200,
  },
];

const buildMockClient = () => ({
  getNetworkStatus: vi.fn().mockResolvedValue({ siteName: 'The Farm', controllerOnline: true }),
  getActiveClients: vi.fn().mockResolvedValue({ clients: mockClients, total: 3 }),
  getDevices: vi.fn().mockResolvedValue([
    { mac: '00:11:22:33:44:01', name: 'EAP-Main', type: 'ap', status: 14 },
    { mac: '00:11:22:33:44:02', name: 'EAP-Barn', type: 'ap', status: 14 },
    { mac: '00:11:22:33:44:03', name: 'Core-Switch', type: 'switch', status: 14 },
    { mac: '00:11:22:33:44:04', name: 'Gateway-WAN', type: 'gateway', status: 14 },
  ]),
});

describe('Reports Aggregation Engine (lib/reports/aggregation.ts)', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.spyOn(dbQueries, 'listAllUsersWithDetails').mockResolvedValue(mockUsers);
    vi.spyOn(dbQueries, 'getPaginatedLogins').mockResolvedValue(mockLogins);
    vi.spyOn(dbQueries, 'getLatestAiInsight').mockResolvedValue(null);
    vi.spyOn(dbQueries, 'getUserDeviceTags').mockResolvedValue([]);
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('aggregates live telemetry, hardware inventory, and user data into an executive summary for admins', async () => {
    vi.spyOn(dbQueries, 'getLatestAiInsight').mockResolvedValue({
      narration: { historyContext: 'h', deltaChanges: 'd', currentStatus: 'c', fullNarrative: 'f' },
    } as any);

    const report = await getReportSummary(buildMockClient() as any, ADMIN);

    expect(report.siteName).toBe('The Farm');
    expect(report.infrastructure.totalClients).toBe(3);
    expect(report.infrastructure.wirelessClients).toBe(2);
    expect(report.infrastructure.wiredClients).toBe(1);
    expect(report.infrastructure.totalAps).toBe(2);
    expect(report.infrastructure.totalSwitches).toBe(1);
    expect(report.infrastructure.totalGateways).toBe(1);
    expect(report.infrastructure.freq5gClients).toBe(1);
    expect(report.infrastructure.freq2gClients).toBe(1);
    expect(report.networkHealthScore).toBe(97); // one poor-RF client, all hardware connected

    // Rates come from activity / uploadActivity (bytes/s), not the PHY rxRate/txRate
    expect(report.topActiveDevices[0]).toMatchObject({
      name: 'Workstation-LAN',
      currentRateMbps: 100,
      downloadRateMbps: 80,
      uploadRateMbps: 20,
    });
    expect(report.topActiveDevices[1]).toMatchObject({ name: 'MacBook-Pro', downloadRateMbps: 20, uploadRateMbps: 1 });
    expect(report.topActiveDevices[2]).toMatchObject({ name: 'iPhone-15', downloadRateMbps: 4, uploadRateMbps: 0 });
    expect(report.infrastructure.aggregateThroughputMbps).toBe(125);
    expect(report.topVolumeDevices[0].name).toBe('Workstation-LAN');

    expect(report.rfDistribution.excellent).toBe(1);
    expect(report.rfDistribution.poor).toBe(1);
    expect(report.rfDistribution.totalWireless).toBe(2);

    expect(report.topActiveUsers[0].username).toBe('admin');
    expect(report.topActiveUsers[0].taggedDevicesCount).toBe(2);

    expect(report.securitySummary?.authSuccessRate24h).toBe(100);
    expect(report.securitySummary?.totalLogins24h).toBe(1);
    expect(report.securitySummary?.activeUsersCount).toBe(1);
    expect(report.narration?.currentStatus).toBe('c');
    expect(dbQueries.getUserDeviceTags).not.toHaveBeenCalled();
  });

  it('penalizes health score on offline devices and failed logins, and bands signalLevel percentages', async () => {
    const mockClient = {
      getNetworkStatus: vi.fn().mockResolvedValue(null),
      getActiveClients: vi.fn().mockResolvedValue({
        clients: [
          { mac: 'C1', wireless: true, channel: 6, signalLevel: 60 }, // Good
          { mac: 'C2', wireless: true, channel: 6, signalLevel: 30 }, // Fair
          { mac: 'C3', wireless: true, channel: 6, signalLevel: 95 }, // Excellent (not "dBm" -> excellent by accident)
          { mac: 'C4', wireless: true, channel: 6 }, // No signal data: not banded
        ],
        total: 4,
      }),
      getDevices: vi.fn().mockResolvedValue([
        { mac: 'AP-1', name: 'AP-1', type: 'ap', status: 0 }, // Offline!
        { mac: 'AP-2', name: 'AP-2', type: 'ap', status: 1 }, // Disconnected (migrating)
        { mac: 'AP-3', name: 'AP-3', type: 'ap', status: 0, statusCategory: 1 }, // statusCategory wins: online
      ]),
    };

    vi.spyOn(dbQueries, 'getPaginatedLogins').mockResolvedValue({
      items: Array(8).fill({ loginStatus: 'FAILED' }) as any,
      total: 8,
      page: 1,
      pageSize: 100,
      totalPages: 1,
    });

    const report = await getReportSummary(mockClient as any, ADMIN);

    expect(report.siteName).toBe('Unknown');
    expect(report.rfDistribution).toEqual({ excellent: 1, good: 1, fair: 1, poor: 0, totalWireless: 4 });
    expect(report.networkHealthScore).toBe(70); // -10 failed logins, -20 for two offline APs
    expect(report.securitySummary?.failedLogins24h).toBe(8);
    expect(report.securitySummary?.authSuccessRate24h).toBe(0);
  });

  it('reports real zero counts and Unknown instead of fabricated defaults when telemetry is missing', async () => {
    const mockClient = {
      getNetworkStatus: vi.fn().mockRejectedValue(new Error('down')),
      getActiveClients: vi.fn().mockRejectedValue(new Error('down')),
      getDevices: vi.fn().mockRejectedValue(new Error('down')),
    };
    vi.spyOn(dbQueries, 'listAllUsersWithDetails').mockRejectedValue(new Error('db'));
    vi.spyOn(dbQueries, 'getPaginatedLogins').mockRejectedValue(new Error('db'));
    vi.spyOn(dbQueries, 'getLatestAiInsight').mockRejectedValue(new Error('db'));

    const report = await getReportSummary(mockClient as any, ADMIN);

    expect(report.infrastructure.totalAps).toBe(0);
    expect(report.infrastructure.totalSwitches).toBe(0);
    expect(report.infrastructure.totalGateways).toBe(0);
    expect(report.controllerUptime).toBe('Unknown');
    expect(report.siteName).toBe('Unknown');
    expect(report.securitySummary).toEqual({
      authSuccessRate24h: 100,
      totalLogins24h: 0,
      failedLogins24h: 0,
      activeUsersCount: 0,
    });
  });

  it('scopes non-admin reports to tagged devices and omits operator, login and narration data', async () => {
    vi.spyOn(dbQueries, 'getUserDeviceTags').mockResolvedValue([
      { id: 't-9', userId: 'u-2', macAddress: 'aa:bb:cc:dd:ee:02', createdAt: '' },
    ]);

    const report = await getReportSummary(buildMockClient() as any, USER);

    expect(dbQueries.getUserDeviceTags).toHaveBeenCalledWith('u-2');
    expect(report.infrastructure.totalClients).toBe(1);
    expect(report.topActiveDevices.map((d) => d.mac)).toEqual(['AA-BB-CC-DD-EE-02']);
    expect(report.topVolumeDevices.map((d) => d.mac)).toEqual(['AA-BB-CC-DD-EE-02']);
    expect(report.topActiveUsers).toEqual([]);
    expect(report.securitySummary).toBeUndefined();
    expect(report.narration).toBeUndefined();
    expect(dbQueries.listAllUsersWithDetails).not.toHaveBeenCalled();
    expect(dbQueries.getPaginatedLogins).not.toHaveBeenCalled();
    expect(dbQueries.getLatestAiInsight).not.toHaveBeenCalled();
  });

  it('shows all clients to non-admins without tags but still omits admin-only sections', async () => {
    const report = await getReportSummary(buildMockClient() as any, USER);

    expect(report.infrastructure.totalClients).toBe(3);
    expect(report.topActiveUsers).toEqual([]);
    expect(report.securitySummary).toBeUndefined();
  });

  it('treats a missing viewer as non-admin', async () => {
    const report = await getReportSummary(buildMockClient() as any);

    expect(report.securitySummary).toBeUndefined();
    expect(report.topActiveUsers).toEqual([]);
    expect(dbQueries.getUserDeviceTags).not.toHaveBeenCalled();
    expect(dbQueries.listAllUsersWithDetails).not.toHaveBeenCalled();
  });
});
