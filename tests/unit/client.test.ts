import { describe, it, expect, beforeEach, vi, afterEach } from 'vitest';
import { OmadaClient, getOmadaClient, isLoginRequiredErrorCode, OmadaNetworkError } from '@/lib/omada/client';

// The client has no default credentials, so give every test in this file a configured account
beforeEach(() => {
  vi.stubEnv('OMADA_USER', 'test-user');
  vi.stubEnv('OMADA_PASS', 'test-pass');
});

afterEach(() => {
  vi.unstubAllEnvs();
});

describe('OmadaClient', () => {
  const originalFetch = global.fetch;

  beforeEach(() => {
    vi.clearAllMocks();
  });

  afterEach(() => {
    global.fetch = originalFetch;
  });

  describe('credential safety', () => {
    it('refuses to log in without configured credentials and makes no request', async () => {
      vi.stubEnv('OMADA_USER', '');
      vi.stubEnv('OMADA_PASS', '');
      const mockFetch = vi.fn();
      global.fetch = mockFetch;
      const client = new OmadaClient({ baseUrl: 'https://127.0.0.1' });

      await expect(client.login()).rejects.toThrow('Omada credentials are not configured');
      expect(mockFetch).not.toHaveBeenCalled();
    });

    it('backs off after the controller rejects credentials instead of retrying every poll', async () => {
      const mockFetch = vi.fn()
        .mockResolvedValueOnce({
          ok: true,
          json: async () => ({ errorCode: 0, result: { omadacId: 'cid' } }),
        })
        .mockResolvedValueOnce({
          ok: true,
          headers: new Headers(),
          json: async () => ({ errorCode: -30109, msg: 'Invalid username or password.' }),
        });
      global.fetch = mockFetch;
      const client = new OmadaClient({ baseUrl: 'https://127.0.0.1' });

      await expect(client.login()).rejects.toThrow('Invalid username or password.');
      const callsAfterFirstAttempt = mockFetch.mock.calls.length;
      await expect(client.login(true)).rejects.toThrow('Invalid username or password.');
      expect(mockFetch.mock.calls.length).toBe(callsAfterFirstAttempt);
    });
  });

  describe('constructor & configuration', () => {
    it('initializes with default environment fallback values', () => {
      const client = new OmadaClient();
      expect(client).toBeDefined();
    });

    it('initializes with custom configuration options and disables insecure SSL flag', () => {
      const client = new OmadaClient({
        baseUrl: 'https://omada.local:8043/',
        username: 'custom_user',
        password: 'custom_pass',
        siteNameOrId: 'Branch-1',
        allowInsecureSsl: false,
      });
      expect(client).toBeDefined();
    });
  });

  describe('login', () => {
    it('successfully discovers omadacId and authenticates', async () => {
      const mockFetch = vi.fn();

      // 1. /api/info
      mockFetch.mockResolvedValueOnce({
        ok: true,
        status: 200,
        json: async () => ({
          errorCode: 0,
          msg: 'Success',
          result: { omadacId: 'mock-omadac-id-123' },
        }),
      });

      // 2. /api/v2/login
      mockFetch.mockResolvedValueOnce({
        ok: true,
        status: 200,
        headers: {
          get: (header: string) =>
            header.toLowerCase() === 'set-cookie'
              ? 'TPEAP_SESSIONID=sess_12345; Path=/; Secure; HttpOnly'
              : null,
        },
        json: async () => ({
          errorCode: 0,
          msg: 'Success',
          result: { token: 'mock-csrf-token-abc', role: 1 },
        }),
      });

      global.fetch = mockFetch;

      const client = new OmadaClient({ baseUrl: 'https://127.0.0.1:8043' });
      await client.login();

      expect(mockFetch).toHaveBeenCalledTimes(2);
      expect(mockFetch.mock.calls[0][0]).toBe('https://127.0.0.1:8043/api/info');
      expect(mockFetch.mock.calls[1][0]).toBe('https://127.0.0.1:8043/mock-omadac-id-123/api/v2/login');

      // Subsequent login should be a no-op when not forced
      await client.login();
      expect(mockFetch).toHaveBeenCalledTimes(2);
    });

    it('deduplicates concurrent login requests', async () => {
      const mockFetch = vi.fn();

      mockFetch.mockImplementation(async (url: string) => {
        if (url.endsWith('/api/info')) {
          return {
            ok: true,
            status: 200,
            json: async () => ({ errorCode: 0, result: { omadacId: 'omada-123' } }),
          };
        }
        return {
          ok: true,
          status: 200,
          headers: { get: () => 'TPEAP_SESSIONID=sess_123;' },
          json: async () => ({ errorCode: 0, result: { token: 'token-123' } }),
        };
      });

      global.fetch = mockFetch;

      const client = new OmadaClient();
      await Promise.all([client.login(), client.login(), client.login()]);

      expect(mockFetch).toHaveBeenCalledTimes(2);
    });

    it('throws error when /api/info fails or returns non-zero error code', async () => {
      global.fetch = vi.fn().mockResolvedValueOnce({
        ok: false,
        status: 500,
        statusText: 'Internal Server Error',
      });

      const client = new OmadaClient();
      await expect(client.login()).rejects.toThrow(/Failed to reach Omada Controller info endpoint/);

      // Test errorCode != 0
      global.fetch = vi.fn().mockResolvedValueOnce({
        ok: true,
        status: 200,
        json: async () => ({ errorCode: -1001, msg: 'Invalid info request' }),
      });

      const client2 = new OmadaClient();
      await expect(client2.login()).rejects.toThrow(/Omada Info Error: Invalid info request/);
    });

    it('throws error when /api/v2/login fails or returns invalid credentials', async () => {
      const mockFetch = vi.fn()
        .mockResolvedValueOnce({
          ok: true,
          status: 200,
          json: async () => ({ errorCode: 0, result: { omadacId: 'omada-123' } }),
        })
        .mockResolvedValueOnce({
          ok: false,
          status: 403,
          statusText: 'Forbidden',
        });

      global.fetch = mockFetch;

      const client = new OmadaClient();
      await expect(client.login()).rejects.toThrow(/Omada Login HTTP error: 403/);

      const mockFetch2 = vi.fn()
        .mockResolvedValueOnce({
          ok: true,
          status: 200,
          json: async () => ({ errorCode: 0, result: { omadacId: 'omada-123' } }),
        })
        .mockResolvedValueOnce({
          ok: true,
          status: 200,
          headers: { get: () => null },
          json: async () => ({ errorCode: -1002, msg: 'Bad credentials' }),
        });

      global.fetch = mockFetch2;
      const client2 = new OmadaClient();
      await expect(client2.login()).rejects.toThrow(/Omada Login Failed: Bad credentials/);
    });

    it('detects HTML responses in safeParseJson and formats a friendly error with page title', async () => {
      const mockFetch = vi.fn().mockResolvedValueOnce({
        ok: true,
        status: 200,
        headers: { get: () => 'text/html' },
        text: async () => '<!DOCTYPE html><html><head><title>Omada Controller Web UI</title></head><body>Login</body></html>',
      });

      global.fetch = mockFetch;
      const client = new OmadaClient({ baseUrl: 'https://192.168.100.2:8043' });
      await expect(client.login()).rejects.toThrow(/returned HTML \("Omada Controller Web UI"\) instead of JSON/);
    });

    it('handles invalid JSON strings and unparseable responses in safeParseJson', async () => {
      const mockFetch = vi.fn().mockResolvedValueOnce({
        ok: true,
        status: 200,
        headers: { get: () => 'application/json' },
        text: async () => 'Not A Valid JSON Payload',
      });

      global.fetch = mockFetch;
      const client = new OmadaClient({ baseUrl: 'https://192.168.100.2:8043' });
      await expect(client.login()).rejects.toThrow(/Invalid JSON received from Omada Controller/);

      // Unparseable response object without text or json
      const mockFetch2 = vi.fn().mockResolvedValueOnce({
        ok: true,
        status: 200,
        headers: { get: () => 'application/json' },
      });

      global.fetch = mockFetch2;
      const client2 = new OmadaClient({ baseUrl: 'https://192.168.100.2:8043' });
      await expect(client2.login()).rejects.toThrow(/cannot be parsed as JSON/);
    });

    it('automatically discovers and falls back to :8043 if port was omitted in baseUrl', async () => {
      const mockFetch = vi.fn().mockImplementation(async (url: string) => {
        if (url === 'https://192.168.100.2/api/info') {
          // Standard :443 returns HTML
          return {
            ok: true,
            status: 200,
            headers: { get: () => 'text/html' },
            text: async () => '<!DOCTYPE html><html><head><title>Router</title></head></html>',
          };
        }
        if (url === 'https://192.168.100.2:8043/api/info') {
          // Port 8043 returns valid omadacId
          return {
            ok: true,
            status: 200,
            headers: { get: () => 'application/json' },
            text: async () => JSON.stringify({ errorCode: 0, result: { omadacId: 'discovered-omada-8043' } }),
          };
        }
        if (url.includes('/api/v2/login')) {
          return {
            ok: true,
            status: 200,
            headers: { get: () => 'TPOMADA_SESSIONID=sess_8043;' },
            text: async () => JSON.stringify({ errorCode: 0, result: { token: 'token-8043' } }),
          };
        }
        return { ok: false, status: 404 };
      });

      global.fetch = mockFetch;
      const client = new OmadaClient({ baseUrl: '192.168.100.2' });
      await client.login();
      expect(client).toBeDefined();
    });
  });

  describe('sites and site resolution', () => {
    it('fetches sites array directly from /api/v2/sites and resolves by exact siteId', async () => {
      const mockFetch = vi.fn().mockImplementation(async (url: string) => {
        if (url.endsWith('/api/info')) {
          return { ok: true, status: 200, json: async () => ({ errorCode: 0, result: { omadacId: 'omada-123' } }) };
        }
        if (url.endsWith('/api/v2/login')) {
          return { ok: true, status: 200, headers: { get: () => 'TPEAP_SESSIONID=sess_123;' }, json: async () => ({ errorCode: 0, result: { token: 'token-123' } }) };
        }
        if (url.includes('/api/v2/sites')) {
          return {
            ok: true,
            status: 200,
            json: async () => ({
              errorCode: 0,
              result: [
                { siteId: 'hexsite123', name: 'Default', siteKey: 'default' },
                { siteId: 'hexsite456', name: 'Branch 2', siteKey: 'branch-2' },
              ],
            }),
          };
        }
        return { ok: false, status: 404 };
      });

      global.fetch = mockFetch;

      const client = new OmadaClient({ siteNameOrId: 'hexsite456' });
      const resolvedId = await client.getResolvedSiteId();
      expect(resolvedId).toBe('hexsite456');

      const client2 = new OmadaClient({ siteNameOrId: 'UnknownSite' });
      const resolvedFallbackId = await client2.getResolvedSiteId();
      expect(resolvedFallbackId).toBe('hexsite123');
    });

    it('fetches sites wrapped in data object and matches by siteKey', async () => {
      const mockFetch = vi.fn().mockImplementation(async (url: string) => {
        if (url.endsWith('/api/info')) {
          return { ok: true, status: 200, json: async () => ({ errorCode: 0, result: { omadacId: 'omada-123' } }) };
        }
        if (url.endsWith('/api/v2/login')) {
          return { ok: true, status: 200, headers: { get: () => 'TPEAP_SESSIONID=sess_123;' }, json: async () => ({ errorCode: 0, result: { token: 'token-123' } }) };
        }
        if (url.includes('/api/v2/sites')) {
          return {
            ok: true,
            status: 200,
            json: async () => ({
              errorCode: 0,
              result: {
                data: [
                  { siteId: 'hexsite999', name: 'Headquarters', siteKey: 'hq' },
                ],
              },
            }),
          };
        }
        return { ok: false, status: 404 };
      });

      global.fetch = mockFetch;

      const client = new OmadaClient({ siteNameOrId: 'hq' });
      const resolvedId = await client.getResolvedSiteId();
      expect(resolvedId).toBe('hexsite999');
    });

    it('falls back to /api/v2/users/current when /api/v2/sites fails', async () => {
      const mockFetch = vi.fn().mockImplementation(async (url: string) => {
        if (url.endsWith('/api/info')) {
          return { ok: true, status: 200, json: async () => ({ errorCode: 0, result: { omadacId: 'omada-123' } }) };
        }
        if (url.endsWith('/api/v2/login')) {
          return { ok: true, status: 200, headers: { get: () => 'TPEAP_SESSIONID=sess_123;' }, json: async () => ({ errorCode: 0, result: { token: 'token-123' } }) };
        }
        if (url.endsWith('/api/v2/sites')) {
          return { ok: false, status: 403, statusText: 'Forbidden' };
        }
        if (url.includes('/api/v2/users/current')) {
          return {
            ok: true,
            status: 200,
            json: async () => ({
              errorCode: 0,
              result: {
                sites: [{ siteId: 'userSite123', name: 'User Default' }],
              },
            }),
          };
        }
        return { ok: false, status: 404 };
      });

      global.fetch = mockFetch;

      const client = new OmadaClient();
      const sites = await client.getSites();
      expect(sites).toHaveLength(1);
      expect(sites[0].siteId).toBe('userSite123');
    });

    it('falls back to siteNameOrId (uncached) when no site list is available', async () => {
      const mockFetch = vi.fn().mockImplementation(async (url: string) => {
        if (url.endsWith('/api/info')) {
          return { ok: true, status: 200, json: async () => ({ errorCode: 0, result: { omadacId: 'omada-123' } }) };
        }
        if (url.endsWith('/api/v2/login')) {
          return { ok: true, status: 200, headers: { get: () => 'TPEAP_SESSIONID=sess_123;' }, json: async () => ({ errorCode: 0, result: { token: 'token-123' } }) };
        }
        return { ok: true, status: 200, json: async () => ({ errorCode: -1005, msg: 'Permission denied' }) };
      });

      global.fetch = mockFetch;

      const client = new OmadaClient({ siteNameOrId: 'fallback-site-id' });
      const resolvedId = await client.getResolvedSiteId();
      expect(resolvedId).toBe('fallback-site-id');

      // Not cached: the next call asks the controller again
      const callsBefore = mockFetch.mock.calls.length;
      await client.getResolvedSiteId();
      expect(mockFetch.mock.calls.length).toBeGreaterThan(callsBefore);
    });

    it('propagates network errors instead of guessing a site', async () => {
      const mockFetch = vi.fn().mockImplementation(async (url: string) => {
        if (url.endsWith('/api/info')) {
          return { ok: true, status: 200, json: async () => ({ errorCode: 0, result: { omadacId: 'omada-123' } }) };
        }
        if (url.endsWith('/api/v2/login')) {
          return { ok: true, status: 200, headers: { get: () => 'TPEAP_SESSIONID=sess_123;' }, json: async () => ({ errorCode: 0, result: { token: 'token-123' } }) };
        }
        throw new Error('Network error');
      });

      global.fetch = mockFetch;

      const client = new OmadaClient({ siteNameOrId: 'fallback-site-id' });
      await expect(client.getResolvedSiteId()).rejects.toThrow(/Network error/);
    });
  });

  describe('getActiveClients & getTopClients', () => {
    const mockClientDevices = [
      {
        mac: 'AA-BB-CC-DD-EE-01',
        name: 'MacBook Pro',
        ip: '192.168.1.50',
        wireless: true,
        ssid: 'CorpNet',
        activity: 102400,
        trafficDown: 5000000,
        trafficUp: 1000000,
        uptime: 3600,
        rssi: -65,
      },
      {
        mac: 'AA-BB-CC-DD-EE-02',
        name: 'Workstation',
        ip: '192.168.1.51',
        wireless: false,
        port: 4,
        activity: 512000,
        trafficDown: 20000000,
        trafficUp: 5000000,
        uptime: 7200,
      },
      {
        mac: 'AA-BB-CC-DD-EE-03',
        name: 'IoT Sensor',
        ip: '192.168.1.52',
        wireless: true,
        ssid: 'IoTNet',
        activity: undefined,
        trafficDown: undefined,
        trafficUp: undefined,
        uptime: undefined,
        rssi: -85,
      },
    ];

    it('retrieves active clients from paginated structure and calculates top clients by activity', async () => {
      const mockFetch = vi.fn().mockImplementation(async (url: string) => {
        if (url.endsWith('/api/info')) {
          return { ok: true, status: 200, json: async () => ({ errorCode: 0, result: { omadacId: 'omada-123' } }) };
        }
        if (url.endsWith('/api/v2/login')) {
          return { ok: true, status: 200, headers: { get: () => 'TPEAP_SESSIONID=sess_123;' }, json: async () => ({ errorCode: 0, result: { token: 'token-123' } }) };
        }
        if (url.includes('/api/v2/sites') && !url.includes('/clients')) {
          return { ok: true, status: 200, json: async () => ({ errorCode: 0, result: [{ siteId: 'site-hex-123', name: 'Default' }] }) };
        }
        if (url.includes('/clients')) {
          return {
            ok: true,
            status: 200,
            json: async () => ({
              errorCode: 0,
              result: {
                totalRows: 3,
                currentPage: 1,
                currentSize: 3,
                data: mockClientDevices,
              },
            }),
          };
        }
        return { ok: false, status: 404 };
      });

      global.fetch = mockFetch;

      const client = new OmadaClient();
      const clients = await client.getActiveClients();
      expect(clients).toHaveLength(3);

      const topByActivity = await client.getTopClients(2, 'activity');
      expect(topByActivity).toHaveLength(2);
      expect(topByActivity[0].name).toBe('Workstation');
      expect(topByActivity[1].name).toBe('MacBook Pro');
    });

    it('returns empty array when getActiveClients returns non-array and non-data result', async () => {
      const mockFetch = vi.fn().mockImplementation(async (url: string) => {
        if (url.endsWith('/api/info')) {
          return { ok: true, status: 200, json: async () => ({ errorCode: 0, result: { omadacId: 'omada-123' } }) };
        }
        if (url.endsWith('/api/v2/login')) {
          return { ok: true, status: 200, headers: { get: () => 'TPEAP_SESSIONID=sess_123;' }, json: async () => ({ errorCode: 0, result: { token: 'token-123' } }) };
        }
        if (url.includes('/api/v2/sites') && !url.includes('/clients')) {
          return { ok: true, status: 200, json: async () => ({ errorCode: 0, result: [{ siteId: 'site-hex-123', name: 'Default' }] }) };
        }
        if (url.includes('/clients')) {
          return {
            ok: true,
            status: 200,
            json: async () => ({
              errorCode: 0,
              result: null,
            }),
          };
        }
        return { ok: false, status: 404 };
      });

      global.fetch = mockFetch;

      const client = new OmadaClient();
      const clients = await client.getActiveClients();
      expect(clients).toEqual([]);
    });

    it('sorts top clients by traffic and uptime', async () => {
      const mockFetch = vi.fn().mockImplementation(async (url: string) => {
        if (url.endsWith('/api/info')) {
          return { ok: true, status: 200, json: async () => ({ errorCode: 0, result: { omadacId: 'omada-123' } }) };
        }
        if (url.endsWith('/api/v2/login')) {
          return { ok: true, status: 200, headers: { get: () => 'TPEAP_SESSIONID=sess_123;' }, json: async () => ({ errorCode: 0, result: { token: 'token-123' } }) };
        }
        if (url.includes('/api/v2/sites') && !url.includes('/clients')) {
          return { ok: true, status: 200, json: async () => ({ errorCode: 0, result: [{ siteId: 'site-hex-123', name: 'Default' }] }) };
        }
        if (url.includes('/clients')) {
          return {
            ok: true,
            status: 200,
            json: async () => ({
              errorCode: 0,
              result: mockClientDevices,
            }),
          };
        }
        return { ok: false, status: 404 };
      });

      global.fetch = mockFetch;

      const client = new OmadaClient();
      const topByTraffic = await client.getTopClients(3, 'traffic');
      expect(topByTraffic[0].name).toBe('Workstation');

      const topByUptime = await client.getTopClients(3, 'uptime');
      expect(topByUptime[0].name).toBe('Workstation');
    });

    it('handles token expiration (-30000) by re-authenticating and retrying', async () => {
      let clientCallCount = 0;
      const mockFetch = vi.fn().mockImplementation(async (url: string) => {
        if (url.endsWith('/api/info')) {
          return { ok: true, status: 200, json: async () => ({ errorCode: 0, result: { omadacId: 'omada-123' } }) };
        }
        if (url.endsWith('/api/v2/login')) {
          return { ok: true, status: 200, headers: { get: () => 'TPEAP_SESSIONID=sess_123;' }, json: async () => ({ errorCode: 0, result: { token: 'token-123' } }) };
        }
        if (url.includes('/api/v2/sites') && !url.includes('/clients')) {
          return { ok: true, status: 200, json: async () => ({ errorCode: 0, result: [{ siteId: 'site-hex-123', name: 'Default' }] }) };
        }
        if (url.includes('/clients')) {
          clientCallCount++;
          if (clientCallCount === 1) {
            return {
              ok: true,
              status: 200,
              json: async () => ({
                errorCode: -30000,
                msg: 'Token expired',
              }),
            };
          }
          return {
            ok: true,
            status: 200,
            json: async () => ({
              errorCode: 0,
              result: mockClientDevices,
            }),
          };
        }
        return { ok: false, status: 404 };
      });

      global.fetch = mockFetch;

      const client = new OmadaClient();
      const clients = await client.getActiveClients();
      expect(clients).toHaveLength(3);
    });

    it('handles HTTP 401 by re-authenticating and retrying', async () => {
      let clientCallCount = 0;
      const mockFetch = vi.fn().mockImplementation(async (url: string) => {
        if (url.endsWith('/api/info')) {
          return { ok: true, status: 200, json: async () => ({ errorCode: 0, result: { omadacId: 'omada-123' } }) };
        }
        if (url.endsWith('/api/v2/login')) {
          return { ok: true, status: 200, headers: { get: () => 'TPEAP_SESSIONID=sess_123;' }, json: async () => ({ errorCode: 0, result: { token: 'token-123' } }) };
        }
        if (url.includes('/api/v2/sites') && !url.includes('/clients')) {
          return { ok: true, status: 200, json: async () => ({ errorCode: 0, result: [{ siteId: 'site-hex-123', name: 'Default' }] }) };
        }
        if (url.includes('/clients')) {
          clientCallCount++;
          if (clientCallCount === 1) {
            return {
              ok: false,
              status: 401,
              statusText: 'Unauthorized',
            };
          }
          return {
            ok: true,
            status: 200,
            json: async () => ({
              errorCode: 0,
              result: mockClientDevices,
            }),
          };
        }
        return { ok: false, status: 404 };
      });

      global.fetch = mockFetch;

      const client = new OmadaClient();
      const clients = await client.getActiveClients();
      expect(clients).toHaveLength(3);
    });

    it('throws error when client API returns non-zero error code', async () => {
      const mockFetch = vi.fn().mockImplementation(async (url: string) => {
        if (url.endsWith('/api/info')) {
          return { ok: true, status: 200, json: async () => ({ errorCode: 0, result: { omadacId: 'omada-123' } }) };
        }
        if (url.endsWith('/api/v2/login')) {
          return { ok: true, status: 200, headers: { get: () => 'TPEAP_SESSIONID=sess_123;' }, json: async () => ({ errorCode: 0, result: { token: 'token-123' } }) };
        }
        if (url.includes('/api/v2/sites') && !url.includes('/clients')) {
          return { ok: true, status: 200, json: async () => ({ errorCode: 0, result: [{ siteId: 'site-hex-123', name: 'Default' }] }) };
        }
        if (url.includes('/clients')) {
          return {
            ok: true,
            status: 200,
            json: async () => ({
              errorCode: -1,
              msg: 'Site not found',
            }),
          };
        }
        return { ok: false, status: 404 };
      });

      global.fetch = mockFetch;

      const client = new OmadaClient();
      await expect(client.getActiveClients()).rejects.toThrow(/Failed to retrieve clients: Site not found/);
    });
  });

  describe('getDevices, getClientDetail, getWirelessHealth, and getNetworkHealthAudit', () => {
    const mockDevicesList = [
      {
        mac: '3C-64-CF-9E-F6-CC',
        name: 'West AP',
        type: 'ap',
        model: 'EAP670',
        ip: '192.168.100.22',
        status: 14,
        clientNum: 28,
        cpuUtil: 85,
        memUtil: 65,
      },
      {
        mac: '3C-64-CF-9E-F6-DD',
        name: 'East AP',
        type: 'ap',
        model: 'EAP670',
        ip: '192.168.100.23',
        status: 14,
        clientNum: 2,
        cpuUtil: 10,
        memUtil: 50,
      },
      {
        mac: '30-68-93-E8-29-54',
        name: 'Core Switch',
        type: 'switch',
        model: 'SG2218P',
        ip: '192.168.100.3',
        status: 40, // isolated
        clientNum: 5,
        cpuUtil: 12,
        memUtil: 45,
      },
    ];

    const mockClients = [
      {
        mac: 'AA-BB-CC-DD-EE-01',
        name: 'Master Bedroom TV',
        ip: '192.168.100.46',
        wireless: true,
        ssid: 'TheFarmStrlnk',
        apName: 'West AP',
        rssi: -82,
        signalLevel: 20,
        activity: 100000,
        trafficDown: 5000000,
        trafficUp: 1000000,
        uptime: 86400,
      },
      {
        mac: 'AA-BB-CC-DD-EE-02',
        name: 'Ian iPhone',
        ip: '192.168.100.74',
        wireless: true,
        ssid: 'TheFarmStrlnk',
        apName: 'West AP',
        rssi: -60,
        signalLevel: 75,
        activity: 50000,
        trafficDown: 2000000,
        trafficUp: 500000,
        uptime: 3600,
      },
    ];

    it('fetches and filters network infrastructure devices', async () => {
      const mockFetch = vi.fn().mockImplementation(async (url: string) => {
        if (url.endsWith('/api/info')) {
          return { ok: true, status: 200, json: async () => ({ errorCode: 0, result: { omadacId: 'omada-123' } }) };
        }
        if (url.endsWith('/api/v2/login')) {
          return { ok: true, status: 200, headers: { get: () => 'TPEAP_SESSIONID=sess_123;' }, json: async () => ({ errorCode: 0, result: { token: 'token-123' } }) };
        }
        if (url.includes('/api/v2/sites') && !url.includes('/devices')) {
          return { ok: true, status: 200, json: async () => ({ errorCode: 0, result: [{ siteId: 'site-hex-123', name: 'Default' }] }) };
        }
        if (url.includes('/devices')) {
          return {
            ok: true,
            status: 200,
            json: async () => ({
              errorCode: 0,
              result: mockDevicesList,
            }),
          };
        }
        return { ok: false, status: 404 };
      });

      global.fetch = mockFetch;

      const client = new OmadaClient();
      const allDevices = await client.getDevices('all');
      expect(allDevices).toHaveLength(3);

      const apDevices = await client.getDevices('ap');
      expect(apDevices).toHaveLength(2);

      const switchDevices = await client.getDevices('switch');
      expect(switchDevices).toHaveLength(1);
    });

    it('looks up a client by IP, MAC, or name via getClientDetail', async () => {
      const mockFetch = vi.fn().mockImplementation(async (url: string) => {
        if (url.endsWith('/api/info')) {
          return { ok: true, status: 200, json: async () => ({ errorCode: 0, result: { omadacId: 'omada-123' } }) };
        }
        if (url.endsWith('/api/v2/login')) {
          return { ok: true, status: 200, headers: { get: () => 'TPEAP_SESSIONID=sess_123;' }, json: async () => ({ errorCode: 0, result: { token: 'token-123' } }) };
        }
        if (url.includes('/api/v2/sites') && !url.includes('/clients')) {
          return { ok: true, status: 200, json: async () => ({ errorCode: 0, result: [{ siteId: 'site-hex-123', name: 'Default' }] }) };
        }
        if (url.includes('/clients')) {
          return {
            ok: true,
            status: 200,
            json: async () => ({
              errorCode: 0,
              result: mockClients,
            }),
          };
        }
        return { ok: false, status: 404 };
      });

      global.fetch = mockFetch;

      const client = new OmadaClient();
      const byIp = await client.getClientDetail('192.168.100.46');
      expect(byIp?.name).toBe('Master Bedroom TV');

      const byMac = await client.getClientDetail('AA:BB:CC:DD:EE:02');
      expect(byMac?.name).toBe('Ian iPhone');

      const byName = await client.getClientDetail('master bedroom');
      expect(byName).toBeDefined();

      const notFound = await client.getClientDetail('999.999.999.999');
      expect(notFound).toBeNull();
    });

    it('calculates wireless health summary and network health audit with recommendations', async () => {
      const mockFetch = vi.fn().mockImplementation(async (url: string) => {
        if (url.endsWith('/api/info')) {
          return { ok: true, status: 200, json: async () => ({ errorCode: 0, result: { omadacId: 'omada-123' } }) };
        }
        if (url.endsWith('/api/v2/login')) {
          return { ok: true, status: 200, headers: { get: () => 'TPEAP_SESSIONID=sess_123;' }, json: async () => ({ errorCode: 0, result: { token: 'token-123' } }) };
        }
        if (url.includes('/api/v2/sites') && !url.includes('/clients') && !url.includes('/devices')) {
          return { ok: true, status: 200, json: async () => ({ errorCode: 0, result: [{ siteId: 'site-hex-123', name: 'Default' }] }) };
        }
        if (url.includes('/devices')) {
          return {
            ok: true,
            status: 200,
            json: async () => ({
              errorCode: 0,
              result: mockDevicesList,
            }),
          };
        }
        if (url.includes('/clients')) {
          return {
            ok: true,
            status: 200,
            json: async () => ({
              errorCode: 0,
              result: mockClients,
            }),
          };
        }
        return { ok: false, status: 404 };
      });

      global.fetch = mockFetch;

      const client = new OmadaClient();
      const health = await client.getWirelessHealth();
      expect(health.totalWirelessClients).toBe(2);
      expect(health.weakSignalCount).toBe(1);
      expect(health.criticalSignalCount).toBe(1);

      const audit = await client.getNetworkHealthAudit();
      expect(audit.healthScore).toBeLessThan(100);
      expect(audit.alerts.length).toBeGreaterThan(0);
      expect(audit.warnings.length).toBeGreaterThan(0);
      expect(audit.recommendations.length).toBeGreaterThan(0);
    });
  });

  describe('getNetworkStatus', () => {
    it('computes aggregated network metrics when online', async () => {
      const mockFetch = vi.fn().mockImplementation(async (url: string) => {
        if (url.endsWith('/api/info')) {
          return { ok: true, status: 200, json: async () => ({ errorCode: 0, result: { omadacId: 'omada-123' } }) };
        }
        if (url.endsWith('/api/v2/login')) {
          return { ok: true, status: 200, headers: { get: () => 'TPEAP_SESSIONID=sess_123;' }, json: async () => ({ errorCode: 0, result: { token: 'token-123' } }) };
        }
        if (url.includes('/api/v2/sites') && !url.includes('/clients')) {
          return { ok: true, status: 200, json: async () => ({ errorCode: 0, result: [{ siteId: 'site-hex-123', name: 'HQ' }] }) };
        }
        if (url.includes('/clients')) {
          return {
            ok: true,
            status: 200,
            json: async () => ({
              errorCode: 0,
              result: [
                { mac: '01', wireless: true, activity: 100, trafficDown: 1000, trafficUp: 500 },
                { mac: '02', wireless: false, activity: 200, trafficDown: 2000, trafficUp: 800 },
              ],
            }),
          };
        }
        return { ok: false, status: 404 };
      });

      global.fetch = mockFetch;

      const client = new OmadaClient({ siteNameOrId: 'HQ' });
      const status = await client.getNetworkStatus();

      expect(status.controllerOnline).toBe(true);
      expect(status.totalClients).toBe(2);
      expect(status.wirelessClients).toBe(1);
      expect(status.wiredClients).toBe(1);
      expect(status.totalActivityRate).toBe(300);
      expect(status.totalTrafficDown).toBe(3000);
      expect(status.totalTrafficUp).toBe(1300);
      expect(status.error).toBeNull();
    });

    it('returns offline error status when connection fails', async () => {
      global.fetch = vi.fn().mockRejectedValueOnce(new Error('Connection refused to controller'));

      const client = new OmadaClient();
      const status = await client.getNetworkStatus();

      expect(status.controllerOnline).toBe(false);
      expect(status.totalClients).toBe(0);
      expect(status.error).toBe('Connection refused to controller');
    });

    it('handles non-Error thrown values in getNetworkStatus catch block', async () => {
      global.fetch = vi.fn().mockRejectedValueOnce('String exception');

      const client = new OmadaClient();
      const status = await client.getNetworkStatus();

      expect(status.controllerOnline).toBe(false);
      expect(status.error).toBe('Unknown connection error');
    });
  });

  describe('Topology, Networks, SSIDs, and PoE Budgets', () => {
    it('fetches topology graph correctly', async () => {
      const mockFetch = vi.fn().mockImplementation(async (url: string) => {
        if (url.endsWith('/api/info')) {
          return { ok: true, status: 200, json: async () => ({ errorCode: 0, result: { omadacId: 'omada-123' } }) };
        }
        if (url.endsWith('/api/v2/login')) {
          return { ok: true, status: 200, headers: { get: () => 'TPOMADA_SESSIONID=sess_123;' }, json: async () => ({ errorCode: 0, result: { token: 'token-123' } }) };
        }
        if (url.includes('/api/v2/sites') && !url.includes('/topology')) {
          return { ok: true, status: 200, json: async () => ({ errorCode: 0, result: [{ siteId: 'site-hex-123', name: 'Default' }] }) };
        }
        if (url.includes('/topology')) {
          return {
            ok: true,
            status: 200,
            json: async () => ({
              errorCode: 0,
              result: [{ type: 'gateway', name: 'Gateway 1', mac: 'AA-BB', model: 'ER7206' }],
            }),
          };
        }
        return { ok: false, status: 404 };
      });

      global.fetch = mockFetch;
      const client = new OmadaClient();
      const topo = await client.getTopology();
      expect(topo).toHaveLength(1);
      expect(topo[0].name).toBe('Gateway 1');
    });

    it('fetches LAN networks and maps fields properly', async () => {
      const mockFetch = vi.fn().mockImplementation(async (url: string) => {
        if (url.endsWith('/api/info')) {
          return { ok: true, status: 200, json: async () => ({ errorCode: 0, result: { omadacId: 'omada-123' } }) };
        }
        if (url.endsWith('/api/v2/login')) {
          return { ok: true, status: 200, headers: { get: () => 'TPOMADA_SESSIONID=sess_123;' }, json: async () => ({ errorCode: 0, result: { token: 'token-123' } }) };
        }
        if (url.includes('/api/v2/sites') && !url.includes('/setting/lan/networks')) {
          return { ok: true, status: 200, json: async () => ({ errorCode: 0, result: [{ siteId: 'site-hex-123', name: 'Default' }] }) };
        }
        if (url.includes('/setting/lan/networks')) {
          return {
            ok: true,
            status: 200,
            json: async () => ({
              errorCode: 0,
              result: {
                data: [
                  {
                    id: 'net-1',
                    name: 'Management',
                    vlan: 1,
                    gatewaySubnet: '192.168.100.1/24',
                    dhcpSettings: { enable: true, ipaddrStart: '192.168.100.10', ipaddrEnd: '192.168.100.250' },
                  },
                ],
              },
            }),
          };
        }
        return { ok: false, status: 404 };
      });

      global.fetch = mockFetch;
      const client = new OmadaClient();
      const networks = await client.getLanNetworks();
      expect(networks).toHaveLength(1);
      expect(networks[0].name).toBe('Management');
      expect(networks[0].dhcpEnable).toBe(true);
    });

    it('fetches SSIDs and maps band & security labels properly', async () => {
      const mockFetch = vi.fn().mockImplementation(async (url: string) => {
        if (url.endsWith('/api/info')) {
          return { ok: true, status: 200, json: async () => ({ errorCode: 0, result: { omadacId: 'omada-123' } }) };
        }
        if (url.endsWith('/api/v2/login')) {
          return { ok: true, status: 200, headers: { get: () => 'TPOMADA_SESSIONID=sess_123;' }, json: async () => ({ errorCode: 0, result: { token: 'token-123' } }) };
        }
        if (url.includes('/setting/wlans') && !url.includes('/ssids')) {
          return {
            ok: true,
            status: 200,
            json: async () => ({
              errorCode: 0,
              result: { data: [{ id: 'wlan-group-1', name: 'Default' }] },
            }),
          };
        }
        if (url.includes('/ssids')) {
          return {
            ok: true,
            status: 200,
            json: async () => ({
              errorCode: 0,
              result: [
                {
                  id: 's-1',
                  name: 'Farm-WiFi',
                  band: 3,
                  security: 4,
                  broadcast: true,
                  vlanEnable: true,
                  vlanId: 20,
                },
              ],
            }),
          };
        }
        if (url.includes('/api/v2/sites')) {
          return { ok: true, status: 200, json: async () => ({ errorCode: 0, result: [{ siteId: 'site-hex-123', name: 'Default' }] }) };
        }
        return { ok: false, status: 404 };
      });

      global.fetch = mockFetch;
      const client = new OmadaClient();
      const ssids = await client.getSsids();
      expect(ssids).toHaveLength(1);
      expect(ssids[0].name).toBe('Farm-WiFi');
      expect(ssids[0].bandText).toBe('Dual-Band (2.4G + 5G)');
      expect(ssids[0].securityText).toBe('WPA3-SAE / WPA2');
    });

    it('fetches PoE budgets from switches', async () => {
      const mockFetch = vi.fn().mockImplementation(async (url: string) => {
        if (url.endsWith('/api/info')) {
          return { ok: true, status: 200, json: async () => ({ errorCode: 0, result: { omadacId: 'omada-123' } }) };
        }
        if (url.endsWith('/api/v2/login')) {
          return { ok: true, status: 200, headers: { get: () => 'TPOMADA_SESSIONID=sess_123;' }, json: async () => ({ errorCode: 0, result: { token: 'token-123' } }) };
        }
        if (url.includes('/api/v2/sites') && !url.includes('/devices')) {
          return { ok: true, status: 200, json: async () => ({ errorCode: 0, result: [{ siteId: 'site-hex-123', name: 'Default' }] }) };
        }
        if (url.includes('/devices')) {
          return {
            ok: true,
            status: 200,
            json: async () => ({
              errorCode: 0,
              result: [
                {
                  type: 'switch',
                  name: 'SG2218P Switch',
                  mac: '11-22-33-44',
                  model: 'SG2218P v2.0',
                  ip: '192.168.100.3',
                  poeRemain: 120,
                  poeSupport: true,
                  clientNum: 4,
                  cpuUtil: 10,
                  memUtil: 50,
                  status: 14,
                },
              ],
            }),
          };
        }
        return { ok: false, status: 404 };
      });

      global.fetch = mockFetch;
      const client = new OmadaClient();
      const poe = await client.getPoeBudgets();
      expect(poe).toHaveLength(1);
      expect(poe[0].poeRemain).toBe(120);
      expect(poe[0].totalPoePower).toBe(150);
      expect(poe[0].poePowerUsed).toBe(30);
    });

    it('fetches WAN status and NOC event logs', async () => {
      const mockFetch = vi.fn().mockImplementation(async (url: string) => {
        if (url.endsWith('/api/info')) {
          return { ok: true, status: 200, json: async () => ({ errorCode: 0, result: { omadacId: 'omada-123' } }) };
        }
        if (url.endsWith('/api/v2/login')) {
          return { ok: true, status: 200, headers: { get: () => 'TPOMADA_SESSIONID=sess_123;' }, json: async () => ({ errorCode: 0, result: { token: 'token-123' } }) };
        }
        if (url.includes('/api/v2/sites') && !url.includes('/devices') && !url.includes('/events')) {
          return { ok: true, status: 200, json: async () => ({ errorCode: 0, result: [{ siteId: 'site-hex-123', name: 'Default' }] }) };
        }
        if (url.includes('/devices')) {
          return {
            ok: true,
            status: 200,
            json: async () => ({
              errorCode: 0,
              result: [
                {
                  mac: '00-11-22-33-44-01',
                  name: 'Gateway ER7206',
                  type: 'gateway',
                  model: 'ER7206 v2.0',
                  ip: '192.168.100.1',
                  status: 14,
                  uptime: 86400,
                },
              ],
            }),
          };
        }
        if (url.includes('/events')) {
          return {
            ok: true,
            status: 200,
            json: async () => ({
              errorCode: 0,
              result: {
                data: [
                  {
                    id: 'evt-custom-1',
                    time: Date.now(),
                    type: 'roam',
                    level: 1,
                    content: 'Fast Roam completed',
                    extra: 'iPhone 15 roamed to AP2',
                  },
                ],
              },
            }),
          };
        }
        return { ok: true, status: 200, json: async () => ({ errorCode: 0, result: [] }) };
      });

      global.fetch = mockFetch;
      const client = new OmadaClient();
      const wan = await client.getWanStatus();
      expect(wan).toBeDefined();
      expect(wan?.gatewayModel).toContain('ER7206');
      expect(wan?.primaryWan.online).toBe(true);

      const events = await client.getNocEvents();
      expect(events.length).toBeGreaterThanOrEqual(1);
      expect(events[0].title).toBe('Fast Roam completed');
    });

    it('returns undefined WAN and empty events when fetch throws or site has no gateway', async () => {
      const mockFetch = vi.fn().mockRejectedValue(new Error('Network offline'));
      global.fetch = mockFetch;

      const client = new OmadaClient();
      const wan = await client.getWanStatus();
      expect(wan).toBeUndefined();

      const events = await client.getNocEvents();
      expect(events).toEqual([]);
    });

    it('returns undefined when gateway device array is empty in getWanStatus', async () => {
      const mockFetch = vi.fn().mockImplementation(async (url: string) => {
        if (url.includes('/api/v2/login')) {
          return { ok: true, status: 200, json: async () => ({ errorCode: 0, result: { token: 'tok' } }) };
        }
        if (url.includes('/api/v2/sites')) {
          return { ok: true, status: 200, json: async () => ({ errorCode: 0, result: [{ id: 'site1', name: 'Site 1' }] }) };
        }
        return { ok: true, status: 200, json: async () => ({ errorCode: 0, result: [] }) };
      });
      global.fetch = mockFetch;
      const client = new OmadaClient();
      const wan = await client.getWanStatus();
      expect(wan).toBeUndefined();
    });
  });

  describe('getOmadaClient singleton', () => {
    it('returns a singleton instance', () => {
      const instance1 = getOmadaClient();
      const instance2 = getOmadaClient();
      expect(instance1).toBe(instance2);
    });
  });
});

describe('OmadaClient hardening (TLS, re-login, timeouts, pagination, sites, WAN)', () => {
  const originalFetch = global.fetch;
  const savedEnv = {
    tls: process.env.NODE_TLS_REJECT_UNAUTHORIZED,
    insecure: process.env.OMADA_ALLOW_INSECURE_SSL,
    timeout: process.env.OMADA_TIMEOUT_MS,
  };

  const restoreEnv = (key: string, value: string | undefined) => {
    if (value === undefined) delete process.env[key];
    else process.env[key] = value;
  };

  afterEach(() => {
    global.fetch = originalFetch;
    restoreEnv('NODE_TLS_REJECT_UNAUTHORIZED', savedEnv.tls);
    restoreEnv('OMADA_ALLOW_INSECURE_SSL', savedEnv.insecure);
    restoreEnv('OMADA_TIMEOUT_MS', savedEnv.timeout);
    vi.restoreAllMocks();
  });

  const jsonRes = (body: unknown, extra: Record<string, unknown> = {}) => ({
    ok: true,
    status: 200,
    json: async () => body,
    ...extra,
  });

  /** Mock controller: /api/info + /login (token-N per login), site list, then custom routes, else 404 */
  const mockController = (routes: (url: string, init: any) => unknown = () => undefined) => {
    let logins = 0;
    const fetchMock = vi.fn(async (url: string, init?: any) => {
      if (url.endsWith('/api/info')) return jsonRes({ errorCode: 0, result: { omadacId: 'cid' } });
      if (url.endsWith('/api/v2/login')) {
        logins++;
        const n = logins;
        return jsonRes({ errorCode: 0, result: { token: `token-${n}` } }, { headers: { get: () => `TPOMADA_SESSIONID=s${n};` } });
      }
      const custom = await routes(url, init);
      if (custom !== undefined) return custom;
      if (url.includes('/api/v2/sites?')) return jsonRes({ errorCode: 0, result: [{ siteId: 'site-1', name: 'Default' }] });
      return { ok: false, status: 404, statusText: 'Not Found' };
    });
    global.fetch = fetchMock as any;
    return { fetchMock, logins: () => logins };
  };

  const newClient = () => new OmadaClient({ baseUrl: 'https://ctrl.test:8043' });
  const tokenOf = (init: any) => init?.headers?.['Csrf-Token'];

  describe('TLS verification (opt-in only)', () => {
    it('keeps certificate verification on unless OMADA_ALLOW_INSECURE_SSL is exactly "true"', () => {
      delete process.env.NODE_TLS_REJECT_UNAUTHORIZED;
      delete process.env.OMADA_ALLOW_INSECURE_SSL;
      new OmadaClient();
      expect(process.env.NODE_TLS_REJECT_UNAUTHORIZED).toBeUndefined();

      process.env.OMADA_ALLOW_INSECURE_SSL = 'yes';
      new OmadaClient();
      expect(process.env.NODE_TLS_REJECT_UNAUTHORIZED).toBeUndefined();

      process.env.OMADA_ALLOW_INSECURE_SSL = 'true';
      new OmadaClient({ allowInsecureSsl: false });
      expect(process.env.NODE_TLS_REJECT_UNAUTHORIZED).toBeUndefined();

      new OmadaClient();
      expect(process.env.NODE_TLS_REJECT_UNAUTHORIZED).toBe('0');
    });

    it('honours an explicit allowInsecureSsl: true config', () => {
      delete process.env.NODE_TLS_REJECT_UNAUTHORIZED;
      delete process.env.OMADA_ALLOW_INSECURE_SSL;
      new OmadaClient({ allowInsecureSsl: true });
      expect(process.env.NODE_TLS_REJECT_UNAUTHORIZED).toBe('0');
    });
  });

  describe('isLoginRequiredErrorCode', () => {
    it('recognises session codes and the -1200..-1299 login-required range', () => {
      for (const code of [-30000, -30001, -39000, -1000, -1200, -1250, -1299]) {
        expect(isLoginRequiredErrorCode(code)).toBe(true);
      }
      for (const code of [0, -1, -1199, -1300, -1001]) {
        expect(isLoginRequiredErrorCode(code)).toBe(false);
      }
      expect(isLoginRequiredErrorCode(undefined)).toBe(false);
    });
  });

  describe('re-login rules', () => {
    it('re-logs in once on a -12xx "login required" errorCode', async () => {
      let calls = 0;
      const { logins } = mockController((url) => {
        if (url.includes('/devices')) {
          calls++;
          return calls === 1
            ? jsonRes({ errorCode: -1201, msg: 'Login required' })
            : jsonRes({ errorCode: 0, result: [{ mac: 'A', name: 'AP', type: 'ap', status: 14 }] });
        }
      });
      const client = newClient();
      const devices = await client.getDevices();
      expect(devices).toHaveLength(1);
      expect(logins()).toBe(2);
    });

    it('re-logs in on HTTP 302 and on a redirect to the login page', async () => {
      let calls = 0;
      const { logins } = mockController((url) => {
        if (url.includes('/devices')) {
          calls++;
          if (calls === 1) return { ok: false, status: 302, statusText: 'Found' };
          if (calls === 3) return jsonRes('<html></html>', { redirected: true, url: 'https://ctrl.test:8043/cid/login' });
          return jsonRes({ errorCode: 0, result: [] });
        }
      });
      const client = newClient();
      await client.getDevices();
      await client.getDevices();
      expect(logins()).toBe(3);
    });

    it('does not re-login on 404 or 5xx responses', async () => {
      const { logins } = mockController((url) => {
        if (url.includes('/devices')) return { ok: false, status: 500, statusText: 'Server Error' };
      });
      const client = newClient();
      await expect(client.getDevices()).rejects.toThrow(/Omada API request failed: 500/);
      expect(logins()).toBe(1);
    });

    it('throws when the controller still rejects the session after re-login', async () => {
      const { logins } = mockController((url) => {
        if (url.includes('/devices')) return { ok: false, status: 401, statusText: 'Unauthorized' };
      });
      const client = newClient();
      await expect(client.getDevices()).rejects.toThrow(/rejected the session after re-login \(HTTP 401\)/);
      expect(logins()).toBe(2);
    });

    it('surfaces a login-required errorCode that persists after re-login as an API error', async () => {
      mockController((url) => {
        if (url.includes('/clients')) return jsonRes({ errorCode: -30000, msg: 'Session expired' });
      });
      const client = newClient();
      await expect(client.getActiveClients()).rejects.toThrow(/Failed to retrieve clients: Session expired \(code -30000\)/);
    });

    it('performs a single re-login for many parallel requests that hit an expired session', async () => {
      const { logins } = mockController((url, init) => {
        if (url.includes('/devices') || url.includes('/clients') || url.includes('/topology')) {
          if (tokenOf(init) === 'token-1') return { ok: false, status: 401, statusText: 'Unauthorized' };
          return jsonRes({ errorCode: 0, result: [] });
        }
      });
      const client = newClient();
      await client.login();
      await client.getResolvedSiteId();

      await Promise.all([
        client.getDevices(),
        client.getDevices('ap'),
        client.getActiveClients(),
        client.getActiveClients(),
        client.getTopology(),
        client.getTopology(),
        client.getDevices('switch'),
        client.getDevices('gateway'),
      ]);

      expect(logins()).toBe(2);
    });

    it('skips re-login when the token already changed since the failing request was sent', async () => {
      let releaseClients: () => void = () => {};
      const clientsGate = new Promise<void>((resolve) => {
        releaseClients = resolve;
      });

      const { logins } = mockController(async (url, init) => {
        if (url.includes('/devices')) {
          if (tokenOf(init) === 'token-1') return { ok: false, status: 401, statusText: 'Unauthorized' };
          return jsonRes({ errorCode: 0, result: [] });
        }
        if (url.includes('/clients')) {
          if (tokenOf(init) === 'token-1') {
            await clientsGate; // answer only after the other request finished its re-login
            return { ok: false, status: 401, statusText: 'Unauthorized' };
          }
          return jsonRes({ errorCode: 0, result: [{ mac: 'C1', ip: '1.1.1.1', wireless: false }] });
        }
      });

      const client = newClient();
      await client.login();
      await client.getResolvedSiteId();

      const clientsPromise = client.getActiveClients();
      await client.getDevices(); // 401 -> re-login (token-2) -> retry ok
      releaseClients();
      const clients = await clientsPromise;

      expect(clients).toHaveLength(1);
      expect(logins()).toBe(2);
    });

    it('logs in again when a previous forced re-login failed', async () => {
      let loginAttempts = 0;
      const fetchMock = vi.fn(async (url: string, init?: any) => {
        if (url.endsWith('/api/info')) return jsonRes({ errorCode: 0, result: { omadacId: 'cid' } });
        if (url.endsWith('/api/v2/login')) {
          loginAttempts++;
          if (loginAttempts === 2) return { ok: false, status: 503, statusText: 'Unavailable' };
          return jsonRes({ errorCode: 0, result: { token: `token-${loginAttempts}` } }, { headers: { get: () => 'S=1;' } });
        }
        if (url.includes('/api/v2/sites?')) return jsonRes({ errorCode: 0, result: [{ siteId: 'site-1', name: 'Default' }] });
        if (tokenOf(init) === 'token-1') return { ok: false, status: 401, statusText: 'Unauthorized' };
        return jsonRes({ errorCode: 0, result: [] });
      });
      global.fetch = fetchMock as any;

      const client = newClient();
      await client.getResolvedSiteId();
      await expect(client.getDevices()).rejects.toThrow(/Omada Login HTTP error: 503/);
      await expect(client.getDevices()).resolves.toEqual([]);
      expect(loginAttempts).toBe(3);
    });
  });

  describe('timeouts and network errors', () => {
    it('passes an AbortSignal.timeout to every controller fetch, honouring OMADA_TIMEOUT_MS', async () => {
      const timeoutSpy = vi.spyOn(AbortSignal, 'timeout');
      process.env.OMADA_TIMEOUT_MS = '1234';
      const { fetchMock } = mockController();
      const client = newClient();
      await client.login();
      expect(timeoutSpy).toHaveBeenCalledWith(1234);
      expect(fetchMock.mock.calls.every(([, init]) => init?.signal instanceof AbortSignal)).toBe(true);

      process.env.OMADA_TIMEOUT_MS = 'not-a-number';
      await client.login(true);
      expect(timeoutSpy).toHaveBeenLastCalledWith(8000);
    });

    it('fails fast on a timeout without probing fallback ports', async () => {
      const timeoutErr = Object.assign(new Error('The operation timed out.'), { name: 'TimeoutError' });
      const fetchMock = vi.fn().mockRejectedValue(timeoutErr);
      global.fetch = fetchMock;

      const client = new OmadaClient({ baseUrl: 'https://10.0.0.9' });
      await expect(client.login()).rejects.toThrow(/did not respond within 8000ms/);
      expect(fetchMock).toHaveBeenCalledTimes(1);

      const status = await new OmadaClient({ baseUrl: 'https://10.0.0.9' }).getNetworkStatus();
      expect(status.controllerOnline).toBe(false);
    });

    it('stops probing fallback ports once a candidate port times out', async () => {
      const fetchMock = vi.fn().mockImplementation(async (url: string) => {
        if (url === 'https://10.0.0.9/api/info') throw new TypeError('fetch failed');
        throw Object.assign(new Error('aborted'), { name: 'AbortError' });
      });
      global.fetch = fetchMock;

      const client = new OmadaClient({ baseUrl: 'https://10.0.0.9' });
      await expect(client.login()).rejects.toBeInstanceOf(OmadaNetworkError);
      expect(fetchMock).toHaveBeenCalledTimes(2); // :443 default + :8043, never the :443 retry
    });

    it('does not cycle through client endpoint fallbacks on network errors', async () => {
      const { fetchMock } = mockController((url) => {
        if (url.includes('/clients')) throw new TypeError('fetch failed');
      });
      const client = newClient();
      await expect(client.getActiveClients()).rejects.toBeInstanceOf(OmadaNetworkError);
      expect(fetchMock.mock.calls.filter(([u]) => String(u).includes('/clients'))).toHaveLength(1);
    });

    it('falls back to the unfiltered client list only when filters.active is unsupported, dropping inactive entries', async () => {
      const { fetchMock } = mockController((url) => {
        if (url.includes('/clients') && url.includes('filters.active=true')) return { ok: false, status: 404, statusText: 'Not Found' };
        if (url.includes('/clients')) {
          return jsonRes({
            errorCode: 0,
            result: { totalRows: 2, data: [{ mac: 'ON', active: true }, { mac: 'OFF', active: false }] },
          });
        }
      });
      const client = newClient();
      const clients = await client.getActiveClients();
      expect(clients.map((c) => c.mac)).toEqual(['ON']);
      expect(fetchMock.mock.calls.some(([u]) => String(u).includes('/insight/'))).toBe(false);
    });
  });

  describe('pagination', () => {
    it('reads every client page until totalRows is reached', async () => {
      const total = 2500;
      const { fetchMock } = mockController((url) => {
        if (url.includes('/clients')) {
          const page = Number(new URL(url).searchParams.get('currentPage'));
          const start = (page - 1) * 1000;
          const count = Math.max(0, Math.min(1000, total - start));
          const data = Array.from({ length: count }, (_, i) => ({ mac: `M${start + i}`, wireless: false }));
          return jsonRes({ errorCode: 0, result: { totalRows: total, currentPage: page, data } });
        }
      });
      const client = newClient();
      const clients = await client.getActiveClients();
      expect(clients).toHaveLength(total);
      expect(fetchMock.mock.calls.filter(([u]) => String(u).includes('/clients'))).toHaveLength(3);
    });

    it('pages devices without totalRows until a short page, and fails on a later page error', async () => {
      let mode: 'short' | 'error' = 'short';
      mockController((url) => {
        if (url.includes('/devices')) {
          const page = Number(new URL(url).searchParams.get('currentPage'));
          if (page === 1) {
            return jsonRes({ errorCode: 0, result: { data: Array.from({ length: 100 }, (_, i) => ({ mac: `D${i}`, type: 'ap', status: 14 })) } });
          }
          if (mode === 'error') return jsonRes({ errorCode: -1, msg: 'Busy' });
          return jsonRes({ errorCode: 0, result: { data: [{ mac: 'LAST', type: 'switch', status: 14 }] } });
        }
      });
      const client = newClient();
      expect(await client.getDevices()).toHaveLength(101);

      mode = 'error';
      await expect(client.getDevices()).rejects.toThrow(/Failed to retrieve devices: Busy/);
    });

    it('stops at the page cap and warns', async () => {
      const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});
      const { fetchMock } = mockController((url) => {
        if (url.includes('/devices')) {
          return jsonRes({ errorCode: 0, result: { totalRows: 1_000_000, data: Array.from({ length: 100 }, () => ({ mac: 'X', status: 14 })) } });
        }
      });
      const client = newClient();
      const devices = await client.getDevices();
      expect(devices).toHaveLength(2000);
      expect(fetchMock.mock.calls.filter(([u]) => String(u).includes('/devices'))).toHaveLength(20);
      expect(warnSpy).toHaveBeenCalledWith(expect.stringContaining('Stopped paging after 20 pages'));
    });
  });

  describe('site resolution', () => {
    it('falls back to users/current privilege.sites when /sites returns a non-zero errorCode', async () => {
      mockController((url) => {
        if (url.includes('/api/v2/sites?')) return jsonRes({ errorCode: -1005, msg: 'No permission' });
        if (url.includes('/users/current')) {
          return jsonRes({ errorCode: 0, result: { privilege: { sites: [{ id: 'priv-site', name: 'The Site' }] } } });
        }
      });
      const client = new OmadaClient({ baseUrl: 'https://ctrl.test:8043', siteNameOrId: 'the site' });
      expect(await client.getResolvedSiteId()).toBe('priv-site');
    });

    it('returns [] when users/current fails at the HTTP level, but propagates its network errors', async () => {
      let usersMode: 'http' | 'network' = 'http';
      mockController((url) => {
        if (url.includes('/api/v2/sites?')) return jsonRes({ errorCode: 0, result: [] });
        if (url.includes('/users/current')) {
          if (usersMode === 'network') throw new TypeError('fetch failed');
          return { ok: false, status: 500, statusText: 'Error' };
        }
      });
      const client = newClient();
      expect(await client.getSites()).toEqual([]);

      usersMode = 'network';
      await expect(client.getSites()).rejects.toBeInstanceOf(OmadaNetworkError);
    });

    it('warns with the available site names when OMADA_SITE matches nothing, and ignores sites without an ID', async () => {
      const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});
      mockController((url) => {
        if (url.includes('/api/v2/sites?')) {
          return jsonRes({ errorCode: 0, result: [{ name: 'Broken' }, { siteId: 's-a', name: 'Alpha' }, { siteId: 's-b', name: 'Beta' }] });
        }
      });
      const client = new OmadaClient({ baseUrl: 'https://ctrl.test:8043', siteNameOrId: 'Gamma' });
      expect(await client.getResolvedSiteId()).toBe('s-a');
      expect(warnSpy).toHaveBeenCalledWith(expect.stringContaining('Available sites: Alpha, Beta'));
    });
  });

  describe('health audit resilience & device status', () => {
    it('produces the controller-offline alert instead of throwing when the controller is unreachable', async () => {
      global.fetch = vi.fn().mockRejectedValue(new TypeError('fetch failed'));
      const client = newClient();
      const audit = await client.getNetworkHealthAudit();
      expect(audit.alerts).toContain('Omada Controller is offline or unreachable.');
      expect(audit.controllerStatus).toContain('Offline');
      expect(audit.totalDevices).toBe(0);
    });

    it('warns when only the device inventory fails and treats statusCategory as authoritative', async () => {
      let devicesFail = true;
      mockController((url) => {
        if (url.includes('/clients')) return jsonRes({ errorCode: 0, result: [] });
        if (url.includes('/devices')) {
          if (devicesFail) return { ok: false, status: 500, statusText: 'Error' };
          return jsonRes({
            errorCode: 0,
            result: [
              { mac: 'A', name: 'Cat-Online', type: 'ap', status: 0, statusCategory: 1 },
              { mac: 'B', name: 'Heartbeat', type: 'ap', status: 30 },
            ],
          });
        }
      });
      const client = newClient();
      const degraded = await client.getNetworkHealthAudit();
      expect(degraded.warnings[0]).toMatch(/device inventory could not be retrieved/);

      devicesFail = false;
      const audit = await client.getNetworkHealthAudit();
      expect(audit.alerts).toEqual(['1 infrastructure device(s) are isolated or offline: Heartbeat']);
    });
  });

  describe('defensive fallbacks', () => {
    it('returns empty collections when optional endpoints fail or return unexpected shapes', async () => {
      mockController((url) => {
        if (url.includes('/topology')) return jsonRes({ errorCode: 0, result: { data: [{ type: 'ap', name: 'T', mac: 'T1', model: 'EAP', statusCategory: 1 }] } });
        if (url.includes('/events')) return jsonRes({ errorCode: 0, result: {} });
        if (url.includes('/devices')) return jsonRes({ errorCode: -1, msg: 'Busy' });
      });
      const client = newClient();
      expect((await client.getTopology())[0].statusCategory).toBe(1);
      expect(await client.getNocEvents()).toEqual([]);
      expect(await client.getPoeBudgets()).toEqual([]);
      expect(await client.getWanStatus()).toBeUndefined();

      mockController((url) => {
        if (url.includes('/devices')) return jsonRes({ errorCode: 0, result: [{ mac: 'AP', name: 'AP', type: 'ap', status: 14 }] });
      });
      expect(await newClient().getWanStatus()).toBeUndefined();
    });

    it('returns [] for topology, LAN networks and SSIDs when the controller is unreachable', async () => {
      global.fetch = vi.fn().mockRejectedValue(new TypeError('fetch failed'));
      const client = newClient();
      expect(await client.getTopology()).toEqual([]);
      expect(await client.getLanNetworks()).toEqual([]);
      expect(await client.getSsids()).toEqual([]);
      mockController((url) => {
        if (url.includes('/topology')) return jsonRes({ errorCode: 0, result: null });
      });
      expect(await newClient().getTopology()).toEqual([]);
    });

    it('maps HTML responses to a friendly offline message and recommends AP review for weak clients', async () => {
      mockController((url) => {
        if (url.includes('/clients')) return { ok: true, status: 200, text: async () => '<!DOCTYPE html><html></html>' };
      });
      const offline = await newClient().getNetworkStatus();
      expect(offline.error).toMatch(/returned HTML instead of API data/);

      mockController((url) => {
        if (url.includes('/clients')) return jsonRes({ errorCode: 0, result: [{ mac: 'W', name: 'Weak', wireless: true, rssi: -75 }] });
        if (url.includes('/devices')) return jsonRes({ errorCode: 0, result: [] });
      });
      const audit = await newClient().getNetworkHealthAudit();
      expect(audit.recommendations[0]).toMatch(/Review AP placement.*Weak/);
    });
  });

  describe('SSID bands, PoE budgets, and WAN status', () => {
    it('labels the band bitmask correctly (7 = tri-band)', async () => {
      mockController((url) => {
        if (url.includes('/setting/wlans') && !url.includes('/ssids')) return jsonRes({ errorCode: 0, result: { data: [{ id: 'w1' }] } });
        if (url.includes('/ssids')) {
          return jsonRes({ errorCode: 0, result: { data: [{ name: 'A', band: 7 }, { name: 'B', band: 4 }, { name: 'C', band: 99 }] } });
        }
      });
      const ssids = await newClient().getSsids();
      expect(ssids.map((s) => s.bandText)).toEqual(['Tri-Band (2.4G + 5G + 6G)', '6 GHz Only', 'Dual-Band']);
    });

    it('omits switches that do not report a PoE budget and passes statusCategory through', async () => {
      mockController((url) => {
        if (url.includes('/devices')) {
          return jsonRes({
            errorCode: 0,
            result: [
              { mac: 'S1', name: 'No Budget', type: 'switch', model: 'SG2210P', poeSupport: true, status: 14 },
              { mac: 'S2', name: 'Budget', type: 'switch', model: 'SG2205P', poeRemain: 50, status: 14, statusCategory: 1 },
            ],
          });
        }
      });
      const poe = await newClient().getPoeBudgets();
      expect(poe).toHaveLength(1);
      expect(poe[0]).toMatchObject({ name: 'Budget', poeRemain: 50, totalPoePower: 65, poePowerUsed: 15, statusCategory: 1 });
    });

    it('builds WAN info from gateway port stats (link state, latency, loss, backup WAN)', async () => {
      mockController((url) => {
        if (url.includes('/devices')) {
          return jsonRes({ errorCode: 0, result: [{ mac: 'GW-1', name: 'GW', type: 'gateway', model: 'ER707-M2', status: 14, uptime: 500 }] });
        }
        if (url.includes('/clients')) {
          return jsonRes({ errorCode: 0, result: [{ mac: 'C1', activity: 1000, uploadActivity: 200 }, { mac: 'C2', activity: 500 }] });
        }
        if (url.includes('/gateways/GW-1')) {
          return jsonRes({
            errorCode: 0,
            result: {
              portStats: [
                { port: 1, name: 'SFP WAN', mode: 0, status: 1, internetState: 0, ip: '100.64.0.2', gateway: '100.64.0.1', dns1: '9.9.9.9', proto: 'pppoe', latency: 31, loss: 1.5, uptime: 3600 },
                { port: 2, name: 'WAN2', type: 0, status: 1, proto: 'static' },
                { port: 3, name: 'LAN', mode: 1, status: 1 },
              ],
            },
          });
        }
      });
      const wan = await newClient().getWanStatus();
      expect(wan?.primaryWan).toMatchObject({
        name: 'SFP WAN',
        online: false, // link up but no internet
        ip: '100.64.0.2',
        gateway: '100.64.0.1',
        dns: ['9.9.9.9'],
        proto: 'PPPoE',
        latencyMs: 31,
        packetLossPercent: 1.5,
        rxRate: 1500,
        txRate: 200,
        uptime: 3600,
        isPrimary: true,
      });
      expect(wan?.backupWan).toMatchObject({ name: 'WAN2', online: true, proto: 'Static', rxRate: 0, uptime: 500, isPrimary: false });
      expect(wan?.overallUptimePercent).toBeUndefined();
    });

    it('reports unknown WAN fields as Unknown/undefined when port stats are unavailable', async () => {
      mockController((url) => {
        if (url.includes('/devices')) {
          return jsonRes({ errorCode: 0, result: [{ mac: 'GW-1', name: 'GW', type: 'gateway', model: '', ip: '192.168.0.1', status: 0 }] });
        }
        if (url.includes('/clients')) return jsonRes({ errorCode: 0, result: [{ mac: 'C1', activity: 1000 }] });
        if (url.includes('/gateways/')) return jsonRes({ errorCode: 0, result: { portStats: [{ port: 1, name: 'WAN', mode: 0 }] } });
      });
      const wan = await newClient().getWanStatus();
      expect(wan?.gatewayModel).toBe('Omada SDN Gateway');
      expect(wan?.primaryWan).toMatchObject({
        online: false, // gateway itself is disconnected
        ip: 'Unknown',
        gateway: 'Unknown',
        dns: [],
        proto: 'Unknown',
        txRate: 0,
        uptime: 0,
      });
      expect(wan?.primaryWan.latencyMs).toBeUndefined();
      expect(wan?.primaryWan.packetLossPercent).toBeUndefined();
      expect(wan?.backupWan).toBeUndefined();
    });

    it('falls back to the gateway connection state when the gateway detail endpoint fails', async () => {
      mockController((url) => {
        if (url.includes('/devices')) {
          return jsonRes({ errorCode: 0, result: [{ mac: 'GW-1', name: 'GW', type: 'gateway', model: 'ER605', status: 0, statusCategory: 1 }] });
        }
        if (url.includes('/clients')) return jsonRes({ errorCode: 0, result: [] });
      });
      const wan = await newClient().getWanStatus();
      expect(wan?.primaryWan.online).toBe(true);
      expect(wan?.primaryWan.name).toBe('WAN 1');
    });
  });
});
