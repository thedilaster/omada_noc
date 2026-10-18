import { describe, it, expect, vi, beforeEach } from 'vitest';
import { runComparativeAiInsight, runDeepSeekAgentInsight, AiAuditUnavailableError } from '@/lib/ai/insights';
import * as dbQueries from '@/lib/db/queries';

describe('Iterative AI Insights Engine (lib/ai/insights.ts)', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('establishes initial baseline when no prior audit history exists (Cold Start)', async () => {
    vi.spyOn(dbQueries, 'getRecentAiInsights').mockResolvedValue([]);
    vi.spyOn(dbQueries, 'saveAiInsight').mockImplementation(async (data: any) => ({
      ...data,
      id: 'insight-1',
      createdAt: '2026-08-28T12:00:00Z',
    }));

    const mockClient = {
      getNetworkStatus: vi.fn().mockResolvedValue({ siteName: 'The Farm' }),
      getActiveClients: vi.fn().mockResolvedValue({
        clients: [
          {
            mac: 'AA:BB:CC:DD:EE:01',
            name: 'Client-1',
            wireless: true,
            rssi: -50,
            channel: 36,
          },
        ],
        total: 1,
      }),
      getDevices: vi.fn().mockResolvedValue([
        { mac: '00:11:22:33:44:01', name: 'AP-1', type: 'ap', status: 14 },
      ]),
    };

    const insight = await runComparativeAiInsight('user-1', mockClient as any);

    expect(insight.trendDirection).toBe('INITIAL');
    expect(insight.previousScore).toBeNull();
    expect(insight.scoreDelta).toBe(0);
    expect(insight.executiveSummary).toContain('Initial diagnostic benchmark');
    expect(insight.actionableSuggestions[0].id).toBe('sug-opt-routine');
  });

  it('detects persisting and resolved issues against previous baseline audits', async () => {
    const previousAudit: any = {
      id: 'insight-prev',
      createdAt: '2026-08-28T10:00:00Z',
      healthScore: 78,
      newIssues: [
        {
          id: 'rf-weak-AABBCCDDEE02',
          category: 'RF_SIGNAL',
          severity: 'WARNING',
          title: 'Sub-Optimal RF Signal (Client-Weak)',
          description: 'Weak signal -85 dBm',
        },
        {
          id: 'dev-offline-001122334402',
          category: 'DEVICE_OFFLINE',
          severity: 'CRITICAL',
          title: 'Infrastructure Node Offline (AP-Barn)',
          description: 'Device offline',
        },
      ],
      persistingIssues: [],
    };

    vi.spyOn(dbQueries, 'getRecentAiInsights').mockResolvedValue([previousAudit]);
    vi.spyOn(dbQueries, 'saveAiInsight').mockImplementation(async (data: any) => ({
      ...data,
      id: 'insight-2',
      createdAt: '2026-08-28T12:00:00Z',
    }));

    const mockClient = {
      getNetworkStatus: vi.fn().mockResolvedValue({ siteName: 'The Farm' }),
      getActiveClients: vi.fn().mockResolvedValue({
        clients: [
          {
            mac: 'AA:BB:CC:DD:EE:02',
            name: 'Client-Weak',
            wireless: true,
            rssi: -86,
            channel: 6,
          },
        ],
        total: 1,
      }),
      getDevices: vi.fn().mockResolvedValue([
        { mac: '00:11:22:33:44:01', name: 'AP-1', type: 'ap', status: 14 },
        { mac: '00:11:22:33:44:02', name: 'AP-Barn', type: 'ap', status: 14 },
      ]),
    };

    const insight = await runComparativeAiInsight('user-1', mockClient as any);

    expect(insight.trendDirection).toBe('IMPROVED');
    expect(insight.healthScore).toBeGreaterThan(previousAudit.healthScore);
    expect(insight.resolvedIssues.length).toBe(1);
    expect(insight.resolvedIssues[0].id).toBe('dev-offline-001122334402');
    expect(insight.persistingIssues.length).toBe(1);
    expect(insight.persistingIssues[0].id).toBe('rf-weak-AABBCCDDEE02');
    expect(insight.persistingIssues[0].persistedAuditCount).toBe(2);
    expect(insight.actionableSuggestions.some((s) => s.id === 'sug-rf-roam')).toBe(true);
  });

  it('detects degraded performance, offline nodes, 2.4GHz saturation, and bandwidth bursts', async () => {
    const previousAudit: any = {
      id: 'insight-perfect',
      createdAt: '2026-08-28T10:00:00Z',
      healthScore: 100,
      newIssues: [],
      persistingIssues: [],
    };

    vi.spyOn(dbQueries, 'getRecentAiInsights').mockResolvedValue([previousAudit]);
    vi.spyOn(dbQueries, 'saveAiInsight').mockImplementation(async (data: any) => ({
      ...data,
      id: 'insight-3',
      createdAt: '2026-08-28T12:00:00Z',
    }));

    // 7 clients on 2.4GHz (>65% saturation), 1 with >50Mbps activity burst, 1 offline AP
    const mockClients = [
      { mac: 'C1', wireless: true, channel: 1, activity: 7000000 }, // ~56 Mbps burst
      { mac: 'C2', wireless: true, channel: 6, activity: 1000 },
      { mac: 'C3', wireless: true, channel: 11, activity: 1000 },
      { mac: 'C4', wireless: true, channel: 1, activity: 1000 },
      { mac: 'C5', wireless: true, channel: 6, activity: 1000 },
      { mac: 'C6', wireless: true, channel: 11, activity: 1000 },
      { mac: 'C7', wireless: true, channel: 6, activity: 1000 },
    ];

    const mockClient = {
      getNetworkStatus: vi.fn().mockResolvedValue({ siteName: 'The Farm' }),
      getActiveClients: vi.fn().mockResolvedValue({ clients: mockClients, total: 7 }),
      getDevices: vi.fn().mockResolvedValue([
        { mac: 'AP-OFF', name: 'AP-West', type: 'ap', status: 0 }, // Offline!
      ]),
    };

    const insight = await runComparativeAiInsight('user-1', mockClient as any);

    expect(insight.trendDirection).toBe('DEGRADED');
    expect(insight.healthScore).toBeLessThan(previousAudit.healthScore);
    expect(insight.newIssues.some((i) => i.category === 'DEVICE_OFFLINE')).toBe(true);
    expect(insight.newIssues.some((i) => i.category === 'CHANNEL_CONGESTION')).toBe(true);
    expect(insight.newIssues.some((i) => i.category === 'BANDWIDTH_BURST')).toBe(true);
    expect(insight.actionableSuggestions.some((s) => s.id === 'sug-crit-offline')).toBe(true);
    expect(insight.actionableSuggestions.some((s) => s.id === 'sug-band-steering')).toBe(true);
  });

  it('detects stable trend when score change is within ±2', async () => {
    const previousAudit: any = {
      id: 'insight-stable-prev',
      createdAt: '2026-08-28T10:00:00Z',
      healthScore: 98,
      newIssues: [],
      persistingIssues: [],
    };

    vi.spyOn(dbQueries, 'getRecentAiInsights').mockResolvedValue([previousAudit]);
    vi.spyOn(dbQueries, 'saveAiInsight').mockImplementation(async (data: any) => ({
      ...data,
      id: 'insight-4',
      createdAt: '2026-08-28T12:00:00Z',
    }));

    const mockClient = {
      getNetworkStatus: vi.fn().mockResolvedValue({ siteName: 'The Farm' }),
      getActiveClients: vi.fn().mockResolvedValue({
        clients: [
          { mac: 'C1', wireless: true, channel: 36, rssi: -55, activity: 1000 },
        ],
        total: 1,
      }),
      getDevices: vi.fn().mockResolvedValue([
        { mac: 'AP-1', name: 'AP-1', type: 'ap', status: 14 },
      ]),
    };

    const insight = await runComparativeAiInsight('user-1', mockClient as any);

    expect(insight.trendDirection).toBe('STABLE');
    expect(insight.executiveSummary).toContain('remains stable');
  });

  it('correctly recognizes IoT clients and avoids false-positive 2.4 GHz congestion warnings', async () => {
    vi.spyOn(dbQueries, 'getRecentAiInsights').mockResolvedValue([]);
    vi.spyOn(dbQueries, 'saveAiInsight').mockImplementation(async (data: any) => ({
      ...data,
      id: 'insight-iot',
      createdAt: '2026-08-28T12:00:00Z',
    }));

    // 6 clients on 2.4GHz on VLAN 20 / IoT SSID
    const mockIotClients = [
      { mac: '40:9B:CD:01', name: 'Ring Front Cam', wireless: true, channel: 1, vlanId: 20, ssid: 'TheFarmIot' },
      { mac: '24:DC:AA:02', name: 'Shelly Smart Plug', wireless: true, channel: 6, vlanId: 20, ssid: 'TheFarmIot' },
      { mac: 'EC:FA:BB:03', name: 'ESP32 Sensor', wireless: true, channel: 11, vlanId: 20, ssid: 'TheFarmIot' },
      { mac: 'B0:72:CC:04', name: 'Alexa Echo Dot', wireless: true, channel: 1, vlanId: 20, ssid: 'TheFarmAlexa' },
      { mac: '11:22:33:05', name: 'Schlage Smart Lock', wireless: true, channel: 6, vlanId: 20, ssid: 'TheFarmIot' },
      { mac: '11:22:33:06', name: 'Kasa Light Switch', wireless: true, channel: 11, vlanId: 20, ssid: 'TheFarmIot' },
      { mac: 'AA:BB:CC:07', name: 'MacBook Pro 16', wireless: true, channel: 36, vlanId: 1, ssid: 'TheFarmStrlnk' },
    ];

    const mockClient = {
      getNetworkStatus: vi.fn().mockResolvedValue({ siteName: 'The Farm' }),
      getActiveClients: vi.fn().mockResolvedValue({ clients: mockIotClients, total: 7 }),
      getDevices: vi.fn().mockResolvedValue([{ mac: 'AP-1', name: 'AP-1', type: 'ap', status: 14 }]),
      getLanNetworks: vi.fn().mockResolvedValue([{ id: 'net-20', name: 'Smart Home (IoT)', vlan: 20 }]),
      getSsids: vi.fn().mockResolvedValue([{ id: 'ssid-iot', name: 'TheFarmIot', bandText: '2.4G' }]),
      getWanStatus: vi.fn().mockResolvedValue({ primaryWan: { latencyMs: 24, online: true } }),
      getPoeBudgets: vi.fn().mockResolvedValue([{ name: 'SG2218P', poeRemain: 124 }]),
    };

    const insight = await runComparativeAiInsight('user-1', mockClient as any);

    // Verify it is NOT flagged as a WARNING channel congestion, but as an INFO expected IoT segregation
    expect(insight.newIssues.some((i) => i.id === 'rf-2g-iot-segregated' && i.severity === 'INFO')).toBe(true);
    expect(insight.newIssues.some((i) => i.id === 'rf-2g-saturation')).toBe(false);

    // Verify 3-part narration was generated
    expect(insight.narration).toBeDefined();
    expect(insight.narration?.historyContext).toBeDefined();
    expect(insight.narration?.deltaChanges).toBeDefined();
    expect(insight.narration?.currentStatus).toContain('IoT/smart home clients are cleanly segregated');
    expect(insight.narration?.fullNarrative).toContain(insight.narration?.currentStatus);
  });

  it('executes runDeepSeekAgentInsight with Ollama neural generation and extracts Chain-of-Thought', async () => {
    const { runDeepSeekAgentInsight } = await import('@/lib/ai/insights');
    vi.spyOn(dbQueries, 'getRecentAiInsights').mockResolvedValue([]);
    vi.spyOn(dbQueries, 'saveAiInsight').mockImplementation(async (data: any) => ({
      ...data,
      id: 'insight-deepseek-1',
      createdAt: '2026-08-28T12:00:00Z',
    }));

    global.fetch = vi.fn().mockImplementation((url: string) => {
      if (url.includes('/api/generate')) {
        return Promise.resolve({
          ok: true,
          json: async () => ({
            model: 'deepseek-r1:7b',
            response: `<think>
Analyzing clients: 2 clients connected, 1 on 5GHz, 1 on 2.4GHz IoT.
Everything is optimal.
</think>
{
  "healthScore": 95,
  "trendDirection": "IMPROVED",
  "executiveSummary": "DeepSeek-R1 verified healthy network conditions.",
  "narration": {
    "historyContext": "Baseline is stable.",
    "deltaChanges": "+1 device joined IoT VLAN.",
    "currentStatus": "Optimal posture."
  },
  "issues": [
    {
      "id": "deepseek-iss-1",
      "category": "RF_SIGNAL",
      "severity": "INFO",
      "title": "Clean Spectrum",
      "description": "5GHz is cleanly utilized."
    }
  ],
  "suggestions": [
    {
      "id": "deepseek-sug-1",
      "priority": "LOW",
      "title": "Maintain Baseline",
      "action": "No immediate remediation required.",
      "expectedImpact": "Continued high throughput."
    }
  ]
}`,
          }),
        });
      }
      return Promise.reject(new Error('Unknown url'));
    });

    const mockClient = {
      getNetworkStatus: vi.fn().mockResolvedValue({ siteName: 'The Farm' }),
      getActiveClients: vi.fn().mockResolvedValue([
        { mac: 'AA:11', name: 'Workstation', wireless: true, channel: 36 },
      ]),
      getDevices: vi.fn().mockResolvedValue([{ mac: 'AP-1', name: 'AP-1', type: 'ap', status: 14 }]),
      getLanNetworks: vi.fn().mockResolvedValue([{ id: 'net-20', name: 'IoT', vlan: 20 }]),
      getSsids: vi.fn().mockResolvedValue([{ id: 's1', name: 'TheFarmIot', bandText: '2.4G' }]),
    };

    const insight = await runDeepSeekAgentInsight('user-admin', mockClient as any);

    expect(insight.engineType).toBe('DEEPSEEK_AGENT');
    expect(insight.llmModel).toBe('deepseek-r1:7b');
    expect(insight.thinkingProcess).toContain('Analyzing clients');
    expect(insight.healthScore).toBe(95);
    expect(insight.executiveSummary).toContain('DeepSeek-R1 verified');
    expect(insight.narration?.currentStatus).toBe('Optimal posture.');
  });

  describe('telemetry guards (no baseline poisoning)', () => {
    const offlineClient = () => ({
      getNetworkStatus: vi.fn().mockResolvedValue({ controllerOnline: false, error: 'connect ETIMEDOUT' }),
      getActiveClients: vi.fn().mockRejectedValue(new Error('down')),
      getDevices: vi.fn().mockRejectedValue(new Error('down')),
    });

    it('refuses to run or save an algorithmic audit while the controller is offline', async () => {
      vi.spyOn(dbQueries, 'getRecentAiInsights').mockResolvedValue([{ id: 'prev', healthScore: 70, newIssues: [], persistingIssues: [] } as any]);
      const saveSpy = vi.spyOn(dbQueries, 'saveAiInsight');

      const run = runComparativeAiInsight('user-1', offlineClient() as any);
      await expect(run).rejects.toBeInstanceOf(AiAuditUnavailableError);
      await expect(run).rejects.toThrow(/controller is offline or unreachable \(connect ETIMEDOUT\).*no record was saved/);
      expect(saveSpy).not.toHaveBeenCalled();
    });

    it('treats an unknown network status or a failed device inventory as unavailable telemetry', async () => {
      vi.spyOn(dbQueries, 'getRecentAiInsights').mockResolvedValue([]);
      const saveSpy = vi.spyOn(dbQueries, 'saveAiInsight');

      const noStatus = {
        getNetworkStatus: vi.fn().mockRejectedValue(new Error('boom')),
        getActiveClients: vi.fn().mockResolvedValue([]),
        getDevices: vi.fn().mockResolvedValue([]),
      };
      await expect(runComparativeAiInsight(null, noStatus as any)).rejects.toThrow(/offline or unreachable\. AI audit skipped/);

      const noDevices = {
        getNetworkStatus: vi.fn().mockResolvedValue({ controllerOnline: true }),
        getActiveClients: vi.fn().mockResolvedValue([]),
        getDevices: vi.fn().mockRejectedValue(new Error('500')),
      };
      await expect(runComparativeAiInsight(null, noDevices as any)).rejects.toThrow(/telemetry is incomplete/);
      expect(saveSpy).not.toHaveBeenCalled();
    });

    it('refuses to run the DeepSeek engine (no inference, no save) while the controller is offline', async () => {
      vi.spyOn(dbQueries, 'getRecentAiInsights').mockResolvedValue([]);
      const saveSpy = vi.spyOn(dbQueries, 'saveAiInsight');
      const fetchSpy = vi.fn();
      global.fetch = fetchSpy;

      await expect(runDeepSeekAgentInsight('user-1', offlineClient() as any)).rejects.toBeInstanceOf(AiAuditUnavailableError);
      expect(fetchSpy).not.toHaveBeenCalled();
      expect(saveSpy).not.toHaveBeenCalled();
    });
  });

  it('flags weak clients from signalLevel % when RSSI is missing and measures bursts from activity + uploadActivity', async () => {
    vi.spyOn(dbQueries, 'getRecentAiInsights').mockResolvedValue([
      { id: 'prev', createdAt: '2026-08-28T10:00:00Z', healthScore: 90, newIssues: [], persistingIssues: [] } as any,
    ]);
    vi.spyOn(dbQueries, 'saveAiInsight').mockImplementation(async (data: any) => ({ ...data, id: 'i', createdAt: 'now' }));

    const mockClient = {
      getNetworkStatus: vi.fn().mockResolvedValue({ controllerOnline: true }),
      getActiveClients: vi.fn().mockResolvedValue([
        { mac: 'W1', name: 'Weak-Pct', wireless: true, channel: 36, signalLevel: 10 },
        { mac: 'W2', name: 'Strong-Pct', wireless: true, channel: 36, signalLevel: 90 },
        { mac: 'B1', name: 'Uploader', wireless: false, activity: 4_000_000, uploadActivity: 3_000_000 },
        { mac: 'P1', name: 'Fast-PHY', wireless: false, rxRate: 2_400_000, txRate: 2_400_000 },
      ]),
      getDevices: vi.fn().mockResolvedValue([{ mac: 'AP-1', name: 'AP-1', type: 'ap', status: 0, statusCategory: 1 }]),
    };

    const insight = await runComparativeAiInsight('user-1', mockClient as any);

    const weak = insight.newIssues.filter((i) => i.category === 'RF_SIGNAL');
    expect(weak.map((i) => i.affectedEntities?.[0])).toEqual(['W1']);
    expect(weak[0].description).toContain('10% signal level');
    const bursts = insight.newIssues.filter((i) => i.category === 'BANDWIDTH_BURST');
    expect(bursts.map((i) => i.affectedEntities?.[0])).toEqual(['B1']);
    expect(bursts[0].description).toContain('56 Mbps');
    expect(insight.newIssues.some((i) => i.category === 'DEVICE_OFFLINE')).toBe(false);
    expect(insight.narration?.historyContext).not.toMatch(/Starlink|24 ms/);
    expect((insight.metricsSnapshot as any).siteName).toBe('Unknown');
  });

  describe('runDeepSeekAgentInsight response handling', () => {
    const onlineClient = () => ({
      getNetworkStatus: vi.fn().mockResolvedValue({ controllerOnline: true, siteName: 'HQ' }),
      getActiveClients: vi.fn().mockResolvedValue([
        { mac: 'L', name: 'Light-User', wireless: false, activity: 100 },
        { mac: 'H', name: 'Heavy-User', wireless: false, activity: 9_000_000 },
        { mac: 'M', name: 'Mid-User', wireless: true, channel: 36, rssi: -85, activity: 50_000 },
      ]),
      getDevices: vi.fn().mockResolvedValue([
        { mac: 'AP-1', name: 'AP-1', type: 'ap', status: 14 },
        { mac: 'AP-2', name: 'AP-2', type: 'ap', status: 30 },
      ]),
    });

    const mockOllama = (response: string) => {
      const fetchMock = vi.fn().mockResolvedValue({
        ok: true,
        json: async () => ({ model: 'deepseek-r1:7b', response }),
      });
      global.fetch = fetchMock;
      return fetchMock;
    };

    beforeEach(() => {
      vi.spyOn(dbQueries, 'getRecentAiInsights').mockResolvedValue([]);
      vi.spyOn(dbQueries, 'saveAiInsight').mockImplementation(async (data: any) => ({ ...data, id: 'ds', createdAt: 'now' }));
    });

    it('ignores braces inside the chain-of-thought, sanitizes lists, and sends top consumers sorted by activity', async () => {
      const fetchMock = mockOllama(
        '<think>Maybe {"healthScore": 10}? No.</think>\nVerdict: {"healthScore": "81", "trendDirection": "BOGUS", "issues": "none", ' +
          '"suggestions": ["text", {"title": "Rebalance", "priority": "URGENT"}]}'
      );

      const insight = await runDeepSeekAgentInsight('user-admin', onlineClient() as any);

      expect(insight.healthScore).toBe(81);
      expect(insight.trendDirection).toBe('INITIAL');
      expect(insight.newIssues).toEqual([]);
      expect(insight.actionableSuggestions).toEqual([
        { id: 'llm-sug-0', priority: 'MEDIUM', title: 'Rebalance', action: '', expectedImpact: '' },
      ]);
      expect(insight.thinkingProcess).toContain('healthScore": 10');

      const body = JSON.parse(fetchMock.mock.calls[0][1].body);
      expect(body.options.num_predict).toBe(4096);
      const payload = JSON.parse(body.prompt.split('Live Omada Telemetry:\n')[1]);
      expect(payload.topBandwidthConsumers.map((c: any) => c.name)).toEqual(['Heavy-User', 'Mid-User', 'Light-User']);
      expect(payload.offlineHardware.map((d: any) => d.name)).toEqual(['AP-2']);
      expect(payload.onlineHardware.map((d: any) => d.name)).toEqual(['AP-1']);
      expect(payload.weakClients.map((c: any) => c.name)).toEqual(['Mid-User']);
      expect(payload.siteName).toBe('HQ');
    });

    it('computes the trend against the previous audit when the model omits a valid one', async () => {
      vi.spyOn(dbQueries, 'getRecentAiInsights').mockResolvedValue([{ id: 'p', healthScore: 70 } as any]);
      mockOllama('{"healthScore": 64, "issues": [{"title": "AP-2 down", "severity": "CRITICAL", "category": "DEVICE_OFFLINE"}, {"severity": "LOUD"}]}');

      const insight = await runDeepSeekAgentInsight('user-admin', onlineClient() as any);
      expect(insight.trendDirection).toBe('DEGRADED');
      expect(insight.scoreDelta).toBe(-6);
      expect(insight.newIssues[0]).toMatchObject({ title: 'AP-2 down', severity: 'CRITICAL', category: 'DEVICE_OFFLINE' });
      expect(insight.newIssues[1]).toMatchObject({ id: 'llm-issue-1', severity: 'INFO', category: 'GENERAL', title: 'Observed Condition' });
    });

    it('returns an error and saves nothing when the model output has no parseable verdict', async () => {
      const saveSpy = vi.spyOn(dbQueries, 'saveAiInsight');

      for (const response of [
        'I am unable to produce JSON today.',
        '<think>Reasoning that was cut off by num_predict {"healthScore": 50',
        '{"executiveSummary": "no score here"}',
      ]) {
        mockOllama(response);
        await expect(runDeepSeekAgentInsight('user-admin', onlineClient() as any)).rejects.toThrow(
          /did not return a parseable JSON verdict/
        );
      }
      expect(saveSpy).not.toHaveBeenCalled();
    });
  });

  it('tests isIotClient helper directly across VLANs, SSIDs, and vendor keywords', async () => {
    const { isIotClient } = await import('@/lib/ai/insights');
    const networks = [
      { id: '1', name: 'Management', vlan: 1, gatewaySubnet: '192.168.1.1/24', dhcpEnable: true },
      { id: '2', name: 'IoT Devices', vlan: 30, gatewaySubnet: '192.168.30.1/24', dhcpEnable: true },
    ];

    expect(isIotClient({ mac: 'AA:11', vlanId: 20 } as any)).toBe(true);
    expect(isIotClient({ mac: 'AA:11', vlanId: 50 } as any)).toBe(true);
    expect(isIotClient({ mac: 'AA:11', vlanId: 30 } as any, networks as any)).toBe(true);
    expect(isIotClient({ mac: 'AA:11', ssid: 'iot-dmz' } as any)).toBe(true);
    expect(isIotClient({ mac: '40:9B:CD:11' } as any)).toBe(true);
    expect(isIotClient({ mac: 'B0:72:00:11' } as any)).toBe(true);
    expect(isIotClient({ mac: '24:DC:00:11' } as any)).toBe(true);
    expect(isIotClient({ mac: 'EC:FA:00:11' } as any)).toBe(true);
    expect(isIotClient({ mac: 'AA:11', name: 'Philips Hue Bridge' } as any)).toBe(true);
    expect(isIotClient({ mac: 'AA:11', name: 'Feit Smart Bulb' } as any)).toBe(true);
    expect(isIotClient({ mac: 'AA:11', name: 'Sonoff Relay' } as any)).toBe(true);
    expect(isIotClient({ mac: 'AA:11', name: 'Wemo Mini' } as any)).toBe(true);
    expect(isIotClient({ mac: 'AA:11', name: 'MacBook Pro' } as any)).toBe(false);
  });
});
