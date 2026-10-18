import { describe, it, expect, vi, beforeEach } from 'vitest';
import { server, omadaClient, startMcpServer } from '@/mcp/server';
import * as dbQueries from '@/lib/db/queries';
import { activateMemoryFallback, resetMemoryFallback } from '@/lib/db/pool';

describe('MCP Server Bridge', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe('server initialization & export', () => {
    it('initializes McpServer instance with registered tools', () => {
      expect(server).toBeDefined();
    });

    it('connects to stdio transport via startMcpServer', async () => {
      const connectSpy = vi.spyOn(server, 'connect').mockResolvedValue(undefined as any);
      await startMcpServer();
      expect(connectSpy).toHaveBeenCalled();
    });
  });

  describe('Tool: get_network_status', () => {
    it('returns formatted status markdown when controller is online', async () => {
      const mockStatus = {
        controllerOnline: true,
        omadacId: 'omada-id-456',
        siteId: 'site-hex-789',
        siteName: 'Main Campus',
        totalClients: 10,
        wirelessClients: 7,
        wiredClients: 3,
        totalActivityRate: 2097152, // 2 MB/s
        totalTrafficDown: 104857600, // 100 MB
        totalTrafficUp: 52428800, // 50 MB
        lastUpdated: '2026-08-26T12:00:00Z',
        error: null,
      };

      vi.spyOn(omadaClient, 'getNetworkStatus').mockResolvedValue(mockStatus);

      const toolHandler = (server as any)._registeredTools?.get_network_status?.handler;
      expect(toolHandler).toBeDefined();

      const result = await toolHandler({});
      expect(result.content[0].text).toContain('Omada Network Status');
      expect(result.content[0].text).toContain('Controller Status:** Online ✅');
      expect(result.content[0].text).toContain('Main Campus');
      expect(result.content[0].text).toContain('10');
      expect(result.content[0].text).toContain('7');
      expect(result.content[0].text).toContain('3');
      expect(result.content[0].text).toContain('2 MB/s');
    });

    it('handles online status with missing omadacId or missing siteName', async () => {
      const mockStatus = {
        controllerOnline: true,
        omadacId: null,
        siteId: 'Default',
        siteName: undefined,
        totalClients: 0,
        wirelessClients: 0,
        wiredClients: 0,
        totalActivityRate: 0,
        totalTrafficDown: 0,
        totalTrafficUp: 0,
        lastUpdated: '2026-08-26T12:00:00Z',
        error: null,
      };

      vi.spyOn(omadaClient, 'getNetworkStatus').mockResolvedValue(mockStatus as any);

      const toolHandler = (server as any)._registeredTools?.get_network_status?.handler;
      const result = await toolHandler({});
      expect(result.content[0].text).toContain('Controller ID:** N/A');
      expect(result.content[0].text).toContain('Active Site:** Default');
    });

    it('returns warning markdown when controller is offline', async () => {
      const mockStatus = {
        controllerOnline: false,
        omadacId: null,
        siteId: 'Default',
        siteName: 'Default',
        totalClients: 0,
        wirelessClients: 0,
        wiredClients: 0,
        totalActivityRate: 0,
        totalTrafficDown: 0,
        totalTrafficUp: 0,
        lastUpdated: '2026-08-26T12:00:00Z',
        error: 'Host unreachable',
      };

      vi.spyOn(omadaClient, 'getNetworkStatus').mockResolvedValue(mockStatus);

      const toolHandler = (server as any)._registeredTools?.get_network_status?.handler;
      const result = await toolHandler({});
      expect(result.content[0].text).toContain('⚠️ Omada Controller is currently offline');
      expect(result.content[0].text).toContain('Host unreachable');
    });

    it('returns error object when getNetworkStatus throws an exception', async () => {
      vi.spyOn(omadaClient, 'getNetworkStatus').mockRejectedValue(new Error('Fatal RPC failure'));

      const toolHandler = (server as any)._registeredTools?.get_network_status?.handler;
      const result = await toolHandler({});
      expect(result.isError).toBe(true);
      expect(result.content[0].text).toContain('Error querying network status: Fatal RPC failure');
    });
  });

  describe('Tool: get_active_clients', () => {
    const mockClients = [
      {
        mac: 'AA-BB-CC-DD-EE-01',
        name: 'Work Laptop',
        ip: '192.168.1.100',
        wireless: true,
        ssid: 'Office-Staff',
        rssi: -48,
        apName: 'AP-Floor-2',
        activity: 1048576,
        trafficDown: 20000000,
        trafficUp: 5000000,
        uptime: 18000,
      },
      {
        mac: 'AA-BB-CC-DD-EE-02',
        name: 'Core NAS',
        ip: '192.168.1.200',
        wireless: false,
        switchName: 'Core-SW-01',
        port: 12,
        activity: 5242880,
        trafficDown: 500000000,
        trafficUp: 200000000,
        uptime: 864000,
      },
      {
        mac: 'AA-BB-CC-DD-EE-03',
        name: undefined,
        hostName: undefined,
        ip: '',
        wireless: false,
        switchName: undefined,
        port: undefined,
        activity: 0,
        trafficDown: 0,
        trafficUp: 0,
        uptime: 0,
      },
      {
        mac: 'AA-BB-CC-DD-EE-04',
        name: undefined,
        hostName: 'wireless-device.local',
        ip: '192.168.1.105',
        wireless: true,
        ssid: undefined,
        rssi: undefined,
        apName: undefined,
        activity: 500,
        trafficDown: 100,
        trafficUp: 100,
        uptime: 60,
      },
    ];

    it('returns active clients formatted with wireless and wired metadata', async () => {
      vi.spyOn(omadaClient, 'getActiveClients').mockResolvedValue(mockClients);

      const toolHandler = (server as any)._registeredTools?.get_active_clients?.handler;
      expect(toolHandler).toBeDefined();

      const result = await toolHandler({ connection_type: 'all', sort_by: 'activity', limit: 10 });
      expect(result.content[0].text).toContain('Active Clients (4 returned');
      expect(result.content[0].text).toContain('Work Laptop');
      expect(result.content[0].text).toContain('Office-Staff');
      expect(result.content[0].text).toContain('AP-Floor-2');
      expect(result.content[0].text).toContain('Core NAS');
      expect(result.content[0].text).toContain('Core-SW-01');
      expect(result.content[0].text).toContain('Port: 12');
      expect(result.content[0].text).toContain('Unnamed Device');
      expect(result.content[0].text).toContain('wireless-device.local');
    });

    it('sorts and filters by connection_type wireless and sort_by traffic', async () => {
      vi.spyOn(omadaClient, 'getActiveClients').mockResolvedValue(mockClients);
      const toolHandler = (server as any)._registeredTools?.get_active_clients?.handler;

      const wirelessRes = await toolHandler({ connection_type: 'wireless', sort_by: 'traffic', limit: 10 });
      expect(wirelessRes.content[0].text).toContain('Work Laptop');
      expect(wirelessRes.content[0].text).not.toContain('Core NAS');
    });

    it('sorts and filters by connection_type wired and sort_by uptime', async () => {
      vi.spyOn(omadaClient, 'getActiveClients').mockResolvedValue(mockClients);
      const toolHandler = (server as any)._registeredTools?.get_active_clients?.handler;

      const wiredRes = await toolHandler({ connection_type: 'wired', sort_by: 'uptime', limit: 10 });
      expect(wiredRes.content[0].text).toContain('Core NAS');
      expect(wiredRes.content[0].text).not.toContain('Work Laptop');
    });

    it('handles empty results and returns descriptive message', async () => {
      vi.spyOn(omadaClient, 'getActiveClients').mockResolvedValue([]);
      const toolHandler = (server as any)._registeredTools?.get_active_clients?.handler;

      const result = await toolHandler({ connection_type: 'wireless' });
      expect(result.content[0].text).toContain('No connected clients found matching filter criteria');
    });

    it('handles exceptions and returns error object', async () => {
      vi.spyOn(omadaClient, 'getActiveClients').mockRejectedValue(new Error('Auth token invalid'));
      const toolHandler = (server as any)._registeredTools?.get_active_clients?.handler;

      const result = await toolHandler({});
      expect(result.isError).toBe(true);
      expect(result.content[0].text).toContain('Error retrieving active clients: Auth token invalid');
    });
  });

  describe('Tool: get_network_devices', () => {
    const mockDevices = [
      {
        mac: '3C-64-CF-9E-F6-CC',
        name: 'West AP',
        type: 'ap',
        model: 'EAP670',
        ip: '192.168.100.22',
        status: 14,
        clientNum: 15,
        cpuUtil: 18,
        memUtil: 62,
      },
      {
        mac: '30-68-93-E8-29-54',
        name: 'Backbone',
        type: 'switch',
        model: 'SG2218P',
        ip: '192.168.100.3',
        status: 14,
        clientNum: 5,
        cpuUtil: 10,
        memUtil: 50,
      },
      {
        mac: 'EC-75-0C-2C-A4-68',
        name: 'Main Gateway',
        type: 'gateway',
        model: 'ER7206',
        ip: '192.168.100.1',
        status: 14,
        clientNum: 0,
        cpuUtil: 2,
        memUtil: 20,
      },
    ];

    it('returns list of network infrastructure devices', async () => {
      vi.spyOn(omadaClient, 'getDevices').mockResolvedValue(mockDevices as any);

      const toolHandler = (server as any)._registeredTools?.get_network_devices?.handler;
      expect(toolHandler).toBeDefined();

      const result = await toolHandler({ device_type: 'all' });
      expect(result.content[0].text).toContain('Network Infrastructure Devices (3 found');
      expect(result.content[0].text).toContain('West AP');
      expect(result.content[0].text).toContain('Backbone');
      expect(result.content[0].text).toContain('Main Gateway');
    });

    it('derives Connected/Offline from isDeviceOnline (statusCategory first, v5 codes 14-17)', async () => {
      vi.spyOn(omadaClient, 'getDevices').mockResolvedValue([
        { mac: 'A', name: 'Wireless-Mesh-AP', type: 'ap', model: 'EAP', ip: '1', status: 15 },
        { mac: 'B', name: 'Migrating-Down', type: 'ap', model: 'EAP', ip: '2', status: 1 },
        { mac: 'C', name: 'Category-Online', type: 'switch', model: 'SG', ip: '3', status: 0, statusCategory: 1 },
      ] as any);
      const toolHandler = (server as any)._registeredTools?.get_network_devices?.handler;

      const text: string = (await toolHandler({ device_type: 'all' })).content[0].text;
      const statusOf = (name: string) => text.split(name)[1].split('**Status:** ')[1].split(' |')[0];
      expect(statusOf('Wireless-Mesh-AP')).toBe('Connected ✅');
      expect(statusOf('Migrating-Down')).toBe('Isolated/Offline ⚠️');
      expect(statusOf('Category-Online')).toBe('Connected ✅');
    });

    it('handles empty results and returns descriptive message', async () => {
      vi.spyOn(omadaClient, 'getDevices').mockResolvedValue([]);
      const toolHandler = (server as any)._registeredTools?.get_network_devices?.handler;

      const result = await toolHandler({ device_type: 'gateway' });
      expect(result.content[0].text).toContain('No network infrastructure devices found matching filter');
    });

    it('handles exceptions and returns error object', async () => {
      vi.spyOn(omadaClient, 'getDevices').mockRejectedValue(new Error('Hardware API timeout'));
      const toolHandler = (server as any)._registeredTools?.get_network_devices?.handler;

      const result = await toolHandler({});
      expect(result.isError).toBe(true);
      expect(result.content[0].text).toContain('Error retrieving network devices: Hardware API timeout');
    });
  });

  describe('Tool: get_client_detail', () => {
    const mockDetail = {
      mac: 'CC-6E-A4-5B-19-1F',
      name: 'Master Bedroom TV',
      ip: '192.168.100.46',
      wireless: true,
      ssid: 'TheFarmStrlnk',
      apName: 'West AP',
      wifiMode: 6,
      rssi: -63,
      signalLevel: 80,
      channel: 104,
      rxRate: 2402000,
      txRate: 2402000,
      activity: 500000,
      trafficDown: 1000000000,
      trafficUp: 200000000,
      uptime: 86400,
      deviceType: 'SmartTV',
    };

    it('returns formatted deep inspection for matching client', async () => {
      vi.spyOn(omadaClient, 'getClientDetail').mockResolvedValue(mockDetail as any);

      const toolHandler = (server as any)._registeredTools?.get_client_detail?.handler;
      expect(toolHandler).toBeDefined();

      const result = await toolHandler({ query: '192.168.100.46' });
      expect(result.content[0].text).toContain('Detailed Device Inspection: Master Bedroom TV');
      expect(result.content[0].text).toContain('192.168.100.46');
      expect(result.content[0].text).toContain('CC:6E:A4:5B:19:1F');
      expect(result.content[0].text).toContain('RSSI: `-63 dBm`');
      expect(result.content[0].text).toContain('RF Channel:** 104');
    });

    it('returns not found message when device does not exist', async () => {
      vi.spyOn(omadaClient, 'getClientDetail').mockResolvedValue(null);

      const toolHandler = (server as any)._registeredTools?.get_client_detail?.handler;
      const result = await toolHandler({ query: 'NonExistent' });
      expect(result.content[0].text).toContain('No active device found matching query "NonExistent"');
    });

    it('handles exceptions and returns error object', async () => {
      vi.spyOn(omadaClient, 'getClientDetail').mockRejectedValue(new Error('Database lock'));
      const toolHandler = (server as any)._registeredTools?.get_client_detail?.handler;

      const result = await toolHandler({ query: '192.168.100.1' });
      expect(result.isError).toBe(true);
      expect(result.content[0].text).toContain('Error inspecting client detail: Database lock');
    });
  });

  describe('Tool: audit_network_health', () => {
    const mockAudit = {
      timestamp: '2026-08-26T12:00:00Z',
      healthScore: 85,
      controllerStatus: 'Online ✅',
      totalDevices: 14,
      totalClients: 73,
      alerts: ['1 infrastructure device is isolated'],
      warnings: ['AP Load Imbalance on Main Center AP'],
      recommendations: ['Enable Fast Roaming 802.11k/v'],
    };

    it('returns full diagnostic audit report with alerts and recommendations', async () => {
      vi.spyOn(omadaClient, 'getNetworkHealthAudit').mockResolvedValue(mockAudit);

      const toolHandler = (server as any)._registeredTools?.audit_network_health?.handler;
      expect(toolHandler).toBeDefined();

      const result = await toolHandler({});
      expect(result.content[0].text).toContain('Omada Network Health & Performance Audit');
      expect(result.content[0].text).toContain('85/100');
      expect(result.content[0].text).toContain('1 infrastructure device is isolated');
      expect(result.content[0].text).toContain('AP Load Imbalance');
      expect(result.content[0].text).toContain('Enable Fast Roaming 802.11k/v');
    });

    it('handles exceptions and returns error object', async () => {
      vi.spyOn(omadaClient, 'getNetworkHealthAudit').mockRejectedValue(new Error('Audit calculation error'));
      const toolHandler = (server as any)._registeredTools?.audit_network_health?.handler;

      const result = await toolHandler({});
      expect(result.isError).toBe(true);
      expect(result.content[0].text).toContain('Error performing network health audit: Audit calculation error');
    });
  });

  describe('Tool: get_audit_history', () => {
    it('bounds limit to an integer between 1 and 100', () => {
      const schema = (server as any)._registeredTools?.get_audit_history?.inputSchema;
      expect(schema.safeParse({ limit: 5 }).success).toBe(true);
      expect(schema.safeParse({}).success).toBe(true);
      expect(schema.safeParse({ limit: -1 }).success).toBe(false);
      expect(schema.safeParse({ limit: 0 }).success).toBe(false);
      expect(schema.safeParse({ limit: 2.5 }).success).toBe(false);
      expect(schema.safeParse({ limit: 101 }).success).toBe(false);
    });

    it('explains that history needs PostgreSQL when only the in-memory fallback is available', async () => {
      vi.spyOn(dbQueries, 'getRecentAiInsights').mockResolvedValue([]);
      activateMemoryFallback();
      try {
        const toolHandler = (server as any)._registeredTools?.get_audit_history?.handler;
        const result = await toolHandler({ limit: 5 });
        expect(result.content[0].text).toContain('Audit history requires the PostgreSQL database');
        expect(result.content[0].text).not.toContain('No prior AI network audit history');
      } finally {
        resetMemoryFallback();
      }
    });

    it('returns empty notice when no audits exist', async () => {
      vi.spyOn(dbQueries, 'getRecentAiInsights').mockResolvedValue([]);
      const toolHandler = (server as any)._registeredTools?.get_audit_history?.handler;
      expect(toolHandler).toBeDefined();

      const result = await toolHandler({ limit: 5 });
      expect(result.content[0].text).toContain('No prior AI network audit history found');
    });

    it('returns formatted audit timeline with trajectory and resolved/persisting issues', async () => {
      vi.spyOn(dbQueries, 'getRecentAiInsights').mockResolvedValue([
        {
          id: 'ins-1',
          createdAt: '2026-08-28T12:00:00Z',
          triggeredByUserId: 'u-1',
          healthScore: 94,
          previousScore: 88,
          scoreDelta: 6,
          trendDirection: 'IMPROVED',
          executiveSummary: 'Telemetry improved.',
          resolvedIssues: [
            { id: 'r-1', category: 'RF_SIGNAL', severity: 'WARNING', title: 'Weak AP Fixed', description: '' },
          ],
          persistingIssues: [
            {
              id: 'p-1',
              category: 'RF_SIGNAL',
              severity: 'WARNING',
              title: 'Sticky Client',
              description: '',
              firstObservedAt: '',
              persistedAuditCount: 2,
            },
          ],
          newIssues: [
            { id: 'n-1', category: 'BANDWIDTH_BURST', severity: 'INFO', title: 'Port Burst', description: '' },
          ],
          actionableSuggestions: [],
          metricsSnapshot: {},
        },
      ]);

      const toolHandler = (server as any)._registeredTools?.get_audit_history?.handler;
      const result = await toolHandler({ limit: 5 });

      expect(result.content[0].text).toContain('Omada AI Continuous Memory Audit Timeline');
      expect(result.content[0].text).toContain('IMPROVED (+6%)');
      expect(result.content[0].text).toContain('[Resolved] Weak AP Fixed');
      expect(result.content[0].text).toContain('[Persisting #2] Sticky Client');
      expect(result.content[0].text).toContain('[New Anomaly] Port Burst');
    });

    it('handles query error and returns isError: true', async () => {
      vi.spyOn(dbQueries, 'getRecentAiInsights').mockRejectedValue(new Error('DB read error'));
      const toolHandler = (server as any)._registeredTools?.get_audit_history?.handler;

      const result = await toolHandler({ limit: 5 });
      expect(result.isError).toBe(true);
      expect(result.content[0].text).toContain('Error retrieving AI audit history: DB read error');
    });
  });
});
