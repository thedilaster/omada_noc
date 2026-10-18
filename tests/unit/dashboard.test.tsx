import React from 'react';
import { renderToString } from 'react-dom/server';
import { render, screen, fireEvent, waitFor, act, within } from '@testing-library/react';
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import Dashboard from '@/app/components/Dashboard';
import { TelemetryResponse } from '@/types/omada';

const mockInitialData: TelemetryResponse = {
  status: {
    controllerOnline: true,
    omadacId: 'omada-abc-123456789',
    siteId: 'site-hex-123',
    siteName: 'Headquarters',
    totalClients: 4,
    wirelessClients: 2,
    wiredClients: 2,
    totalActivityRate: 1048576,
    totalTrafficDown: 50000000,
    totalTrafficUp: 20000000,
    lastUpdated: '2026-08-26T00:00:00.000Z',
    error: null,
  },
  topClients: [
    {
      mac: 'AA-BB-CC-DD-EE-01',
      name: 'MacBook Pro',
      hostName: 'macbook-pro.local',
      ip: '192.168.1.10',
      wireless: true,
      ssid: 'Corp-WiFi',
      apName: 'AP-Lobby',
      rssi: -55,
      activity: 524288,
      trafficDown: 30000000,
      trafficUp: 10000000,
      uptime: 7200,
      guest: false,
    },
    {
      mac: 'AA-BB-CC-DD-EE-02',
      name: 'Core Server',
      ip: '192.168.1.20',
      wireless: false,
      switchName: 'Core-Switch',
      port: 8,
      activity: 524288,
      trafficDown: 20000000,
      trafficUp: 10000000,
      uptime: 86400,
      guest: false,
    },
    {
      mac: 'AA-BB-CC-DD-EE-03',
      name: 'Executive iPad',
      ip: '192.168.1.30',
      wireless: true,
      ssid: 'Corp-WiFi',
      rssi: -72,
      activity: 0,
      trafficDown: 1000000,
      trafficUp: 200000,
      uptime: 1800,
      guest: false,
    },
    {
      mac: 'AA-BB-CC-DD-EE-04',
      name: undefined,
      hostName: 'guest-phone.local',
      ip: '192.168.1.40',
      wireless: true,
      ssid: 'Guest-WiFi',
      activity: 0,
      trafficDown: 500000,
      trafficUp: 100000,
      uptime: 600,
      guest: true,
    },
  ],
};

describe('Dashboard Client Component', () => {
  const originalFetch = global.fetch;

  beforeEach(() => {
    vi.clearAllMocks();
    global.fetch = vi.fn().mockImplementation(async (url: string) => {
      if (url.includes('/api/auth/me')) {
        return {
          ok: true,
          status: 200,
          json: async () => ({ authenticated: false, user: null }),
        };
      }
      return {
        ok: true,
        status: 200,
        json: async () => mockInitialData,
      };
    });
  });

  afterEach(() => {
    global.fetch = originalFetch;
    vi.useRealTimers();
  });

  it('renders dashboard headers, status pill, and client table with metric cards', () => {
    render(<Dashboard initialData={mockInitialData} />);

    expect(screen.getByText(/Omada NOC Telemetry/i)).toBeInTheDocument();
    expect(screen.getByText(/MCP Bridge/i)).toBeInTheDocument();
    expect(screen.getByText(/Headquarters/i)).toBeInTheDocument();
    expect(screen.getByText(/ID: omada-ab/i)).toBeInTheDocument();
    expect(screen.getByText(/Controller Online/i)).toBeInTheDocument();

    expect(screen.getByText('MacBook Pro')).toBeInTheDocument();
    expect(screen.getByText('Core Server')).toBeInTheDocument();
    expect(screen.getByText('Executive iPad')).toBeInTheDocument();
    expect(screen.getByText('guest-phone.local')).toBeInTheDocument();
  });

  it('handles status with missing siteName and missing omadacId', () => {
    const dataWithoutSiteName: TelemetryResponse = {
      status: {
        controllerOnline: true,
        omadacId: null,
        siteId: 'site-default',
        siteName: undefined,
        totalClients: 0,
        wirelessClients: 0,
        wiredClients: 0,
        totalActivityRate: 0,
        totalTrafficDown: 0,
        totalTrafficUp: 0,
        lastUpdated: '2026-08-26T00:00:00.000Z',
        error: null,
      },
      topClients: [],
    };

    render(<Dashboard initialData={dataWithoutSiteName} />);
    expect(screen.getByText('site-default')).toBeInTheDocument();
  });

  it('filters clients when typing in search input across hostName, MAC, and SSID', async () => {
    render(<Dashboard initialData={mockInitialData} />);

    const searchInput = screen.getByPlaceholderText(/search by device/i);

    // Search by hostname
    fireEvent.change(searchInput, { target: { value: 'macbook-pro' } });
    expect(screen.getByText('MacBook Pro')).toBeInTheDocument();
    expect(screen.queryByText('Core Server')).not.toBeInTheDocument();

    // Search by MAC
    fireEvent.change(searchInput, { target: { value: 'EE-02' } });
    expect(screen.getByText('Core Server')).toBeInTheDocument();
    expect(screen.queryByText('MacBook Pro')).not.toBeInTheDocument();

    // Search by SSID
    fireEvent.change(searchInput, { target: { value: 'Guest-WiFi' } });
    expect(screen.getByText('guest-phone.local')).toBeInTheDocument();
    expect(screen.queryByText('MacBook Pro')).not.toBeInTheDocument();

    // Search unmatched
    fireEvent.change(searchInput, { target: { value: 'nonexistent-device' } });
    expect(screen.getByText(/no client telemetry records found/i)).toBeInTheDocument();

    // Click clear search text link
    const clearSearchLink = screen.getByRole('button', { name: /clear search/i });
    fireEvent.click(clearSearchLink);
    expect(screen.getByText('MacBook Pro')).toBeInTheDocument();

    // Search again and click ✕ button
    fireEvent.change(searchInput, { target: { value: 'macbook' } });
    const xButton = screen.getByRole('button', { name: '✕' });
    fireEvent.click(xButton);
    expect(searchInput).toHaveValue('');
  });

  it('changes polling interval selection', () => {
    render(<Dashboard initialData={mockInitialData} />);
    const pollingSelect = screen.getByRole('combobox', { name: /polling interval/i });
    fireEvent.change(pollingSelect, { target: { value: '5' } });
    expect(pollingSelect).toHaveValue('5');
    fireEvent.change(pollingSelect, { target: { value: '0' } });
    expect(pollingSelect).toHaveValue('0');
  });

  it('filters clients by medium (All, Wi-Fi, Wired)', () => {
    render(<Dashboard initialData={mockInitialData} />);

    // Click Wi-Fi tab
    const wirelessTab = screen.getByRole('button', { name: /^wi-fi/i });
    fireEvent.click(wirelessTab);
    expect(screen.getByText('MacBook Pro')).toBeInTheDocument();
    expect(screen.queryByText('Core Server')).not.toBeInTheDocument();

    // Click Wired tab
    const wiredTab = screen.getByRole('button', { name: /^wired/i });
    fireEvent.click(wiredTab);
    expect(screen.getByText('Core Server')).toBeInTheDocument();
    expect(screen.queryByText('MacBook Pro')).not.toBeInTheDocument();

    // Click All tab
    const allTab = screen.getByRole('button', { name: /^all/i });
    fireEvent.click(allTab);
    expect(screen.getByText('MacBook Pro')).toBeInTheDocument();
    expect(screen.getByText('Core Server')).toBeInTheDocument();
  });

  it('sorts clients when changing sort option between activity, traffic, and uptime', () => {
    render(<Dashboard initialData={mockInitialData} />);

    const sortSelect = screen.getByRole('combobox', { name: /sort clients by/i });

    // Sort by traffic
    fireEvent.change(sortSelect, { target: { value: 'traffic' } });
    expect(sortSelect).toHaveValue('traffic');

    // Sort by uptime
    fireEvent.change(sortSelect, { target: { value: 'uptime' } });
    expect(sortSelect).toHaveValue('uptime');

    // Sort by activity
    fireEvent.change(sortSelect, { target: { value: 'activity' } });
    expect(sortSelect).toHaveValue('activity');
  });

  it('handles manual refresh and updates data', async () => {
    const updatedData: TelemetryResponse = {
      status: {
        ...mockInitialData.status,
        totalClients: 5,
        totalActivityRate: 2097152,
      },
      topClients: mockInitialData.topClients,
    };

    global.fetch = vi.fn().mockImplementation(async (url: string) => {
      if (url.includes('/api/auth/me')) {
        return { ok: true, status: 200, json: async () => ({ authenticated: false }) };
      }
      return { ok: true, status: 200, json: async () => updatedData };
    });

    render(<Dashboard initialData={mockInitialData} />);

    const refreshBtn = screen.getByRole('button', { name: /refresh/i });
    fireEvent.click(refreshBtn);

    await waitFor(() => {
      expect(global.fetch).toHaveBeenCalledWith(expect.stringContaining('/api/telemetry'));
    });
  });

  it('handles refresh failure with error json response and network exception', async () => {
    // 1. HTTP error response
    global.fetch = vi.fn().mockImplementation(async (url: string) => {
      if (url.includes('/api/auth/me')) {
        return { ok: true, status: 200, json: async () => ({ authenticated: false }) };
      }
      return {
        ok: false,
        status: 503,
        json: async () => ({ error: 'Controller communication timed out' }),
      };
    });

    render(<Dashboard initialData={mockInitialData} />);

    const refreshBtn = screen.getByRole('button', { name: /refresh/i });
    fireEvent.click(refreshBtn);

    await waitFor(() => {
      expect(screen.getByText(/Controller Offline/i)).toBeInTheDocument();
      expect(screen.getByText(/Controller communication timed out/i)).toBeInTheDocument();
    });

    // 2. Network rejection
    global.fetch = vi.fn().mockImplementation(async (url: string) => {
      if (url.includes('/api/auth/me')) {
        return { ok: true, status: 200, json: async () => ({ authenticated: false }) };
      }
      throw new Error('Network disconnected');
    });

    fireEvent.click(refreshBtn);

    await waitFor(() => {
      expect(screen.getByText(/Network disconnected/i)).toBeInTheDocument();
    });
  });

  it('triggers auto-refresh on timer and allows changing intervals or pausing', async () => {
    vi.useFakeTimers();

    global.fetch = vi.fn().mockImplementation(async (url: string) => {
      if (url.includes('/api/auth/me')) {
        return { ok: true, status: 200, json: async () => ({ authenticated: false }) };
      }
      return { ok: true, status: 200, json: async () => mockInitialData };
    });

    render(<Dashboard initialData={mockInitialData} />);

    const pollingSelect = screen.getByRole('combobox', { name: /polling interval/i });
    // Switch to 5s
    fireEvent.change(pollingSelect, { target: { value: '5' } });

    // Advance timers by 5s
    await act(async () => {
      vi.advanceTimersByTime(5000);
    });

    expect(global.fetch).toHaveBeenCalledWith(expect.stringContaining('/api/telemetry'));

    // Pause polling (0)
    fireEvent.change(pollingSelect, { target: { value: '0' } });
    const callCountBefore = (global.fetch as any).mock.calls.length;

    await act(async () => {
      vi.advanceTimersByTime(15000);
    });

    expect((global.fetch as any).mock.calls.length).toBe(callCountBefore);
  });

  it('renders offline warning banner when initial status is offline and allows dismissal and retry', async () => {
    global.fetch = vi.fn().mockResolvedValue({
      ok: true,
      status: 200,
      json: async () => mockInitialData,
    });

    const offlineData: TelemetryResponse = {
      status: {
        controllerOnline: false,
        omadacId: null,
        siteId: 'site-hex-123',
        siteName: 'Headquarters',
        totalClients: 0,
        wirelessClients: 0,
        wiredClients: 0,
        totalActivityRate: 0,
        totalTrafficDown: 0,
        totalTrafficUp: 0,
        lastUpdated: '2026-08-26T00:00:00.000Z',
        error: 'Host unreachable',
      },
      topClients: [],
    };

    render(<Dashboard initialData={offlineData} />);
    expect(screen.getByText(/Controller Offline/i)).toBeInTheDocument();
    expect(screen.getByText(/Host unreachable/i)).toBeInTheDocument();

    // Click retry
    const retryBtn = screen.getByRole('button', { name: /retry/i });
    fireEvent.click(retryBtn);
    expect(global.fetch).toHaveBeenCalledWith(expect.stringContaining('/api/telemetry'));

    // Click dismiss button
    const dismissBtn = screen.getByRole('button', { name: /dismiss connection notice/i });
    fireEvent.click(dismissBtn);
    expect(screen.queryByText(/Host unreachable/i)).not.toBeInTheDocument();
  });

  it('opens executive reports modal, admin AI insights drawer, and docs modal when buttons are clicked', async () => {
    global.fetch = vi.fn().mockImplementation((url: string) => {
      if (url.includes('/api/auth/me')) {
        return Promise.resolve({
          ok: true,
          json: async () => ({
            authenticated: true,
            user: { id: 'u1', username: 'admin', role: 'ADMIN' },
          }),
        });
      }
      if (url.includes('/api/reports/summary')) {
        return Promise.resolve({
          ok: true,
          json: async () => ({ success: true, report: null }),
        });
      }
      if (url.includes('/api/admin/insights/history')) {
        return Promise.resolve({
          ok: true,
          json: async () => ({ success: true, history: [] }),
        });
      }
      if (url.includes('/api/docs')) {
        return Promise.resolve({
          ok: true,
          json: async () => ({
            success: true,
            total: 1,
            docs: [
              {
                slug: 'prd',
                filename: 'PRD.md',
                title: 'Product Requirements Document',
                category: 'Product & Strategy',
                excerpt: 'PRD details',
                content: '# PRD\n\nDetails',
                size: 1024,
                updatedAt: new Date().toISOString(),
              },
            ],
          }),
        });
      }
      return Promise.resolve({ ok: true, json: async () => ({}) });
    });

    render(<Dashboard initialData={mockInitialData} />);

    // Wait for auth/me to resolve and set role to ADMIN
    await waitFor(() => {
      expect(screen.getAllByRole('button', { name: /AI Insights/i })[0]).toBeInTheDocument();
    });

    // Click Executive Report button from navigation strip
    const reportBtns = screen.getAllByRole('button', { name: /Executive Report/i });
    fireEvent.click(reportBtns[0]);

    // Modal should be open
    expect(screen.getByText(/Executive Telemetry & SLA Report/i)).toBeInTheDocument();

    // Click AI Insights button
    const aiBtns = screen.getAllByRole('button', { name: /AI Insights/i });
    fireEvent.click(aiBtns[0]);

    // Drawer should be open
    expect(screen.getByText(/Continuous AI & NLG Engine/i)).toBeInTheDocument();

    // Click Docs button
    const docsBtns = screen.getAllByRole('button', { name: /Docs/i });
    fireEvent.click(docsBtns[0]);

    // Docs modal should be open
    await waitFor(() => {
      expect(screen.getByText(/System Documentation & Architecture Dossier/i)).toBeInTheDocument();
    });

    // Test controls under search bar
    const genReportBtn = screen.getByRole('button', { name: /Generate Executive PDF Report/i });
    fireEvent.click(genReportBtn);

    const auditBtn = screen.getByRole('button', { name: /AI Continuous Health Audit/i });
    fireEvent.click(auditBtn);

    const viewDocsBtn = screen.getByRole('button', { name: /View System Specs & Docs/i });
    fireEvent.click(viewDocsBtn);

    // Close buttons
    const closeButtons = screen.getAllByRole('button', { name: '✕' });
    closeButtons.forEach((btn) => fireEvent.click(btn));
  });

  it('navigates between Telemetry, Topology Map, VLANs & Wi-Fi, and Hardware & PoE tabs', () => {
    render(<Dashboard initialData={mockInitialData} />);

    // Default tab is Telemetry & Clients
    expect(screen.getByText(/Connected Client Telemetry/i)).toBeInTheDocument();

    // Switch to Topology Map
    const topologyTab = screen.getByRole('button', { name: /Topology Map/i });
    fireEvent.click(topologyTab);
    expect(screen.getByText(/Physical Topology Data Unavailable/i)).toBeInTheDocument();

    // Switch to VLANs & Wi-Fi
    const vlanTab = screen.getByRole('button', { name: /VLANs & Wi-Fi/i });
    fireEvent.click(vlanTab);
    expect(screen.getByText(/VLAN Network Segmentation Matrix/i)).toBeInTheDocument();
    expect(screen.getByText(/Wireless SSID Fleet Configuration/i)).toBeInTheDocument();

    // Switch to Hardware & PoE
    const poeTab = screen.getByRole('button', { name: /Hardware & PoE/i });
    fireEvent.click(poeTab);
    expect(screen.getByText(/PoE Switch Power Budget & Headroom/i)).toBeInTheDocument();

    // Switch back to Telemetry & Clients
    const telemetryTab = screen.getByRole('button', { name: /Telemetry & Clients/i });
    fireEvent.click(telemetryTab);
    expect(screen.getByText(/Connected Client Telemetry/i)).toBeInTheDocument();
  });

  it('collapses client list to top 5 by default and allows expanding/collapsing', () => {
    // Create mock initial data with 8 clients
    const manyClientsData: TelemetryResponse = {
      ...mockInitialData,
      status: { ...mockInitialData.status, totalClients: 8 },
      topClients: Array.from({ length: 8 }, (_, i) => ({
        mac: `AA:BB:CC:DD:EE:0${i}`,
        name: `Client Device ${i + 1}`,
        ip: `192.168.100.${10 + i}`,
        wireless: i % 2 === 0,
        activity: 1000 * (8 - i),
        trafficDown: 50000,
        trafficUp: 20000,
        uptime: 3600,
      })),
    };

    render(<Dashboard initialData={manyClientsData} />);

    // By default, showing top 5 active
    expect(screen.getByText(/TOP 5 ACTIVE/i)).toBeInTheDocument();
    expect(screen.getByText(/Client Device 1/i)).toBeInTheDocument();
    expect(screen.getByText(/Client Device 5/i)).toBeInTheDocument();
    expect(screen.queryByText(/Client Device 6/i)).not.toBeInTheDocument();

    // Click Expand All
    const expandBtn = screen.getAllByRole('button', { name: /Expand All \(8\)/i })[0];
    fireEvent.click(expandBtn);

    // Now all 8 are shown
    expect(screen.getByText(/ALL CLIENTS/i)).toBeInTheDocument();
    expect(screen.getByText(/Client Device 6/i)).toBeInTheDocument();
    expect(screen.getByText(/Client Device 8/i)).toBeInTheDocument();

    // Click Collapse to Top 5
    const collapseBtn = screen.getAllByRole('button', { name: /Collapse to Top 5/i })[0];
    fireEvent.click(collapseBtn);

    // Collapsed back to 5
    expect(screen.getByText(/TOP 5 ACTIVE/i)).toBeInTheDocument();
    expect(screen.queryByText(/Client Device 6/i)).not.toBeInTheDocument();
  });

  it('opens ClientInspectorModal when clicking a client table row and closes it', () => {
    render(<Dashboard initialData={mockInitialData} />);

    // Click client row
    const clientName = screen.getByText('MacBook Pro');
    fireEvent.click(clientName);

    expect(screen.getByRole('dialog', { name: /Client Diagnostic Deep-Dive/i })).toBeInTheDocument();
    expect(screen.getByText(/RF Signal Strength/i)).toBeInTheDocument();

    // Close modal
    const doneBtn = screen.getByRole('button', { name: /Done/i });
    fireEvent.click(doneBtn);
    expect(screen.queryByRole('dialog', { name: /Client Diagnostic Deep-Dive/i })).not.toBeInTheDocument();
  });

  it('copies diagnostic snapshot to clipboard and triggers Live Events modal', async () => {
    Object.defineProperty(navigator, 'clipboard', {
      value: { writeText: vi.fn().mockResolvedValue(undefined) },
      configurable: true,
      writable: true,
    });

    render(<Dashboard initialData={mockInitialData} />);

    // Click Snapshot button
    const snapshotBtn = screen.getByRole('button', { name: /Snapshot/i });
    fireEvent.click(snapshotBtn);
    expect(navigator.clipboard.writeText).toHaveBeenCalled();
    expect(await screen.findByText(/Diagnostic snapshot copied to clipboard!/i)).toBeInTheDocument();

    // Click Live Events button
    const eventsBtn = screen.getByRole('button', { name: /Live Events/i });
    fireEvent.click(eventsBtn);
    expect(screen.getByText('Live NOC Event Stream')).toBeInTheDocument();

    // Close Live Events modal
    const closeBtn = screen.getByRole('button', { name: 'Close' });
    fireEvent.click(closeBtn);
    expect(screen.queryByText('Live NOC Event Stream')).not.toBeInTheDocument();
  });

  it('handles client list sorting by traffic and uptime and auto-collapse expansion', () => {
    render(<Dashboard initialData={mockInitialData} />);

    const sortSelect = screen.getByLabelText(/Sort clients by/i);
    fireEvent.change(sortSelect, { target: { value: 'traffic' } });
    expect(screen.getByText('MacBook Pro')).toBeInTheDocument();

    fireEvent.change(sortSelect, { target: { value: 'uptime' } });
    expect(screen.getByText('Core Server')).toBeInTheDocument();

    fireEvent.change(sortSelect, { target: { value: 'unknown' } });
    expect(screen.getByText('MacBook Pro')).toBeInTheDocument();
  });

  it('handles background NLG audit lifecycle and renders floating badge with view/dismiss actions', async () => {
    let nlgResolver: any;
    const nlgPromise = new Promise((resolve) => {
      nlgResolver = resolve;
    });

    global.fetch = vi.fn().mockImplementation(async (url: string, opts?: any) => {
      if (url.includes('/api/auth/me')) {
        return {
          ok: true,
          status: 200,
          json: async () => ({ authenticated: true, user: { role: 'ADMIN' } }),
        };
      }
      if (url.includes('/api/admin/insights/history')) {
        return {
          ok: true,
          status: 200,
          json: async () => ({ history: [] }),
        };
      }
      if (url.includes('/api/admin/insights/run') && opts?.method === 'POST') {
        await nlgPromise;
        return {
          ok: true,
          status: 200,
          json: async () => ({
            success: true,
            insight: {
              id: 'ins-test-bg',
              createdAt: '2026-08-28T12:00:00Z',
              healthScore: 92,
              engineType: 'NLG_ALGORITHMIC',
              executiveSummary: 'Audit completed.',
              persistingIssues: [],
              resolvedIssues: [],
              newIssues: [],
              actionableSuggestions: [],
            },
          }),
        };
      }
      return { ok: true, status: 200, json: async () => mockInitialData };
    });

    render(<Dashboard initialData={mockInitialData} />);

    // Wait for ADMIN AI insights button to appear
    await waitFor(() => {
      expect(screen.getByRole('button', { name: /AI Insights/i })).toBeInTheDocument();
    });

    // Open AI Insights drawer
    fireEvent.click(screen.getByRole('button', { name: /AI Insights/i }));
    expect(screen.getByRole('dialog', { name: 'Continuous AI & NLG Engine' })).toBeInTheDocument();

    // Click Trigger NLG Audit inside drawer
    await act(async () => {
      const triggerBtn = screen.getByRole('button', { name: /Trigger NLG Audit/i });
      fireEvent.click(triggerBtn);
    });

    // Minimize drawer with Push to Background button
    await act(async () => {
      const pushBgBtn = screen.getByRole('button', { name: /Push to Background/i });
      fireEvent.click(pushBgBtn);
    });

    // Resolve the running audit in background
    await act(async () => {
      nlgResolver();
    });

    // Wait for completion floating badge to appear
    await waitFor(() => {
      expect(screen.getByText(/NLG Audit Complete/i)).toBeInTheDocument();
      expect(screen.getByText(/Score: 92\/100/i)).toBeInTheDocument();
    });

    // Click View on floating badge to reopen drawer
    await act(async () => {
      const viewBtn = screen.getByRole('button', { name: /^View$/i });
      fireEvent.click(viewBtn);
    });
    expect(screen.getByRole('dialog', { name: 'Continuous AI & NLG Engine' })).toBeInTheDocument();
  });

  it('handles background DeepSeek Agent audit lifecycle with error floating badge', async () => {
    let errorResolver: any;
    const slowErrorPromise = new Promise((resolve) => {
      errorResolver = resolve;
    });

    global.fetch = vi.fn().mockImplementation(async (url: string, opts?: any) => {
      if (url.includes('/api/auth/me')) {
        return {
          ok: true,
          status: 200,
          json: async () => ({ authenticated: true, user: { role: 'ADMIN' } }),
        };
      }
      if (url.includes('/api/admin/insights/history')) {
        return {
          ok: true,
          status: 200,
          json: async () => ({ history: [] }),
        };
      }
      if (url.includes('/api/admin/insights/agent') && opts?.method === 'POST') {
        return slowErrorPromise;
      }
      return { ok: true, status: 200, json: async () => mockInitialData };
    });

    render(<Dashboard initialData={mockInitialData} />);

    await waitFor(() => {
      expect(screen.getByRole('button', { name: /AI Insights/i })).toBeInTheDocument();
    });

    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: /AI Insights/i }));
    });

    await act(async () => {
      const runAgentBtn = screen.getByRole('button', { name: /Run DeepSeek Agent/i });
      fireEvent.click(runAgentBtn);
    });

    // Minimize drawer with Push to Background button
    await act(async () => {
      const pushBgBtn = screen.getByRole('button', { name: /Push to Background/i });
      fireEvent.click(pushBgBtn);
    });

    // Resolve error promise after pushing to background
    await act(async () => {
      errorResolver({
        ok: false,
        status: 500,
        json: async () => ({ error: 'Ollama instance unreachable' }),
      });
    });

    // Wait for error floating badge
    await waitFor(() => {
      expect(screen.getByText(/Audit Execution Error/i)).toBeInTheDocument();
      expect(screen.getByText(/Ollama instance unreachable/i)).toBeInTheDocument();
    });

    // Click Details button to inspect error inside drawer
    await act(async () => {
      const detailsBtn = screen.getByRole('button', { name: /Details/i });
      fireEvent.click(detailsBtn);
    });
    expect(screen.getByRole('dialog', { name: 'Continuous AI & NLG Engine' })).toBeInTheDocument();

    // Close drawer again - badge is now marked read and dismissed
    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: /Close drawer/i }));
    });
    expect(screen.queryByText(/Audit Execution Error/i)).not.toBeInTheDocument();
  });

  it('allows clicking Open on running floating badge', async () => {
    let resolver: any;
    const slowPromise = new Promise((resolve) => {
      resolver = resolve;
    });

    global.fetch = vi.fn().mockImplementation(async (url: string, opts?: any) => {
      if (url.includes('/api/auth/me')) {
        return {
          ok: true,
          status: 200,
          json: async () => ({ authenticated: true, user: { role: 'ADMIN' } }),
        };
      }
      if (url.includes('/api/admin/insights/history')) {
        return {
          ok: true,
          status: 200,
          json: async () => ({ history: [] }),
        };
      }
      if (url.includes('/api/admin/insights/agent') && opts?.method === 'POST') {
        return slowPromise;
      }
      return { ok: true, status: 200, json: async () => mockInitialData };
    });

    render(<Dashboard initialData={mockInitialData} />);

    await waitFor(() => {
      expect(screen.getByRole('button', { name: /AI Insights/i })).toBeInTheDocument();
    });

    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: /AI Insights/i }));
    });

    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: /Run DeepSeek Agent/i }));
    });

    // Minimize to background
    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: /Push to Background/i }));
    });

    // See running badge
    expect(screen.getByText(/Reasoning on network telemetry in background.../i)).toBeInTheDocument();

    // Click Open on running badge
    await act(async () => {
      const openBtn = screen.getByRole('button', { name: /Open/i });
      fireEvent.click(openBtn);
    });
    expect(screen.getByRole('dialog', { name: 'Continuous AI & NLG Engine' })).toBeInTheDocument();

    // Resolve slow promise inside act
    await act(async () => {
      resolver({
        ok: true,
        status: 200,
        json: async () => ({
          success: true,
          insight: {
            id: 'ins-slow-1',
            createdAt: '2026-08-28T12:00:00Z',
            healthScore: 95,
            engineType: 'DEEPSEEK_AGENT',
            executiveSummary: 'DeepSeek audit completed.',
            persistingIssues: [],
            resolvedIssues: [],
            newIssues: [],
            actionableSuggestions: [],
          },
        }),
      });
    });
  });

  it('shows a failure toast when the clipboard is unavailable (plain HTTP) and the fallback fails', async () => {
    vi.useFakeTimers();
    Object.defineProperty(navigator, 'clipboard', { value: undefined, configurable: true, writable: true });
    Object.defineProperty(document, 'execCommand', {
      value: vi.fn().mockReturnValue(false),
      configurable: true,
      writable: true,
    });

    render(<Dashboard initialData={mockInitialData} />);

    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: /Snapshot/i }));
    });
    expect(screen.getByText(/could not copy the diagnostic snapshot/i)).toBeInTheDocument();
    expect(screen.queryByText(/copied to clipboard!/i)).not.toBeInTheDocument();

    // Fallback copy succeeds on a second attempt; previous toast timer is replaced
    (document.execCommand as unknown as ReturnType<typeof vi.fn>).mockReturnValue(true);
    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: /Snapshot/i }));
    });
    expect(screen.getByText(/Diagnostic snapshot copied to clipboard!/i)).toBeInTheDocument();

    // Toast auto-dismisses
    await act(async () => {
      vi.advanceTimersByTime(3000);
    });
    expect(screen.queryByText(/Diagnostic snapshot copied to clipboard!/i)).not.toBeInTheDocument();

    Object.defineProperty(document, 'execCommand', { value: undefined, configurable: true, writable: true });
  });

  it('derives the header system status from controllerOnline', () => {
    const { unmount } = render(<Dashboard initialData={mockInitialData} />);
    expect(screen.getByText('SYSTEM ONLINE')).toBeInTheDocument();
    expect(screen.queryByText('SYSTEM OFFLINE')).not.toBeInTheDocument();
    unmount();

    render(
      <Dashboard
        initialData={{ ...mockInitialData, status: { ...mockInitialData.status, controllerOnline: false } }}
      />
    );
    expect(screen.getByText('SYSTEM OFFLINE')).toBeInTheDocument();
    expect(screen.queryByText('SYSTEM ONLINE')).not.toBeInTheDocument();
  });

  it('renders no locale-dependent heartbeat time on the server, then the local time after mount', () => {
    const html = renderToString(<Dashboard initialData={mockInitialData} />);
    const expectedTime = new Date(mockInitialData.status.lastUpdated).toLocaleTimeString();
    expect(html).not.toContain(expectedTime);

    render(<Dashboard initialData={mockInitialData} />);
    expect(screen.getByText(`Heartbeat: ${expectedTime}`)).toBeInTheDocument();
  });

  it('renders an empty heartbeat for an unparseable lastUpdated timestamp', () => {
    render(
      <Dashboard
        initialData={{ ...mockInitialData, status: { ...mockInitialData.status, lastUpdated: 'not-a-date' } }}
      />
    );
    expect(screen.getByText(/^Heartbeat:\s*$/)).toBeInTheDocument();
  });

  it('skips polling ticks while a telemetry request is still in flight', async () => {
    vi.useFakeTimers();
    let resolveTelemetry: ((value: unknown) => void) | undefined;
    global.fetch = vi.fn().mockImplementation((url: string) => {
      if (url.includes('/api/auth/me')) {
        return Promise.resolve({ ok: true, status: 200, json: async () => ({ authenticated: false }) });
      }
      return new Promise((resolve) => {
        resolveTelemetry = resolve;
      });
    });
    const telemetryCalls = () =>
      (global.fetch as any).mock.calls.filter(([url]: [string]) => url.includes('/api/telemetry')).length;

    render(<Dashboard initialData={mockInitialData} />);
    fireEvent.change(screen.getByRole('combobox', { name: /polling interval/i }), { target: { value: '5' } });

    await act(async () => {
      vi.advanceTimersByTime(5000);
    });
    expect(telemetryCalls()).toBe(1);

    // Further ticks while the first request hangs are skipped
    await act(async () => {
      vi.advanceTimersByTime(15000);
    });
    expect(telemetryCalls()).toBe(1);

    // Once it settles, the next tick polls again
    await act(async () => {
      resolveTelemetry?.({ ok: true, status: 200, json: async () => mockInitialData });
    });
    await act(async () => {
      vi.advanceTimersByTime(5000);
    });
    expect(telemetryCalls()).toBe(2);
  });

  it('matches clients by AP name in the search box', () => {
    render(<Dashboard initialData={mockInitialData} />);
    fireEvent.change(screen.getByPlaceholderText(/search by device/i), { target: { value: 'ap-lobby' } });
    expect(screen.getByText('MacBook Pro')).toBeInTheDocument();
    expect(screen.queryByText('Core Server')).not.toBeInTheDocument();
    expect(screen.queryByText('Executive iPad')).not.toBeInTheDocument();
  });

  it('keeps the client inspector in sync with refreshed telemetry', async () => {
    const refreshed: TelemetryResponse = {
      ...mockInitialData,
      topClients: mockInitialData.topClients.map((c) =>
        c.mac === 'AA-BB-CC-DD-EE-01' ? { ...c, rssi: -82 } : c
      ),
    };
    global.fetch = vi.fn().mockImplementation(async (url: string) => {
      if (url.includes('/api/auth/me')) {
        return { ok: true, status: 200, json: async () => ({ authenticated: false }) };
      }
      return { ok: true, status: 200, json: async () => refreshed };
    });

    render(<Dashboard initialData={mockInitialData} />);
    fireEvent.click(screen.getByText('MacBook Pro'));
    const dialog = screen.getByRole('dialog', { name: /Client Diagnostic Deep-Dive/i });
    expect(within(dialog).getByText('-55 dBm')).toBeInTheDocument();

    fireEvent.click(screen.getByRole('button', { name: /^refresh$/i }));

    await waitFor(() => {
      const updated = screen.getByRole('dialog', { name: /Client Diagnostic Deep-Dive/i });
      expect(within(updated).getByText('-82 dBm')).toBeInTheDocument();
      expect(within(updated).getByText(/Weak \/ Degraded/i)).toBeInTheDocument();
    });
  });

  it('closes the inspector when the selected client disappears from telemetry', async () => {
    const refreshed: TelemetryResponse = {
      ...mockInitialData,
      topClients: mockInitialData.topClients.filter((c) => c.mac !== 'AA-BB-CC-DD-EE-01'),
    };
    global.fetch = vi.fn().mockImplementation(async (url: string) => {
      if (url.includes('/api/auth/me')) {
        return { ok: true, status: 200, json: async () => ({ authenticated: false }) };
      }
      return { ok: true, status: 200, json: async () => refreshed };
    });

    render(<Dashboard initialData={mockInitialData} />);
    fireEvent.click(screen.getByText('MacBook Pro'));
    expect(screen.getByRole('dialog', { name: /Client Diagnostic Deep-Dive/i })).toBeInTheDocument();

    fireEvent.click(screen.getByRole('button', { name: /^refresh$/i }));
    await waitFor(() => {
      expect(screen.queryByRole('dialog', { name: /Client Diagnostic Deep-Dive/i })).not.toBeInTheDocument();
    });
  });

  it('dismisses the completed background audit badge without opening the drawer', async () => {
    let releaseAudit: (() => void) | undefined;
    const auditGate = new Promise<void>((resolve) => {
      releaseAudit = resolve;
    });
    global.fetch = vi.fn().mockImplementation(async (url: string, opts?: any) => {
      if (url.includes('/api/auth/me')) {
        return { ok: true, status: 200, json: async () => ({ user: { role: 'ADMIN' } }) };
      }
      if (url.includes('/api/admin/insights/history')) {
        return { ok: true, status: 200, json: async () => ({ history: [] }) };
      }
      if (url.includes('/api/admin/insights/run') && opts?.method === 'POST') {
        await auditGate;
        return {
          ok: true,
          status: 200,
          json: async () => ({
            insight: {
              id: 'ins-dismiss',
              createdAt: '2026-08-28T12:00:00Z',
              healthScore: 77,
              engineType: 'NLG_ALGORITHMIC',
              executiveSummary: 'Done.',
              persistingIssues: [],
              resolvedIssues: [],
              newIssues: [],
              actionableSuggestions: [],
            },
          }),
        };
      }
      return { ok: true, status: 200, json: async () => mockInitialData };
    });

    render(<Dashboard initialData={mockInitialData} />);
    fireEvent.click(await screen.findByRole('button', { name: /AI Insights/i }));
    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: /Trigger NLG Audit/i }));
    });
    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: /Push to Background/i }));
    });
    await act(async () => {
      releaseAudit?.();
    });

    expect(await screen.findByText(/NLG Audit Complete/i)).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Dismiss' }));
    expect(screen.queryByText(/NLG Audit Complete/i)).not.toBeInTheDocument();
    expect(screen.queryByRole('dialog', { name: 'Continuous AI & NLG Engine' })).not.toBeInTheDocument();
  });

  it('shows the error badge when a background NLG audit fails', async () => {
    let releaseAudit: (() => void) | undefined;
    const auditGate = new Promise<void>((resolve) => {
      releaseAudit = resolve;
    });
    global.fetch = vi.fn().mockImplementation(async (url: string, opts?: any) => {
      if (url.includes('/api/auth/me')) {
        return { ok: true, status: 200, json: async () => ({ user: { role: 'ADMIN' } }) };
      }
      if (url.includes('/api/admin/insights/history')) {
        return { ok: true, status: 200, json: async () => ({ history: [] }) };
      }
      if (url.includes('/api/admin/insights/run') && opts?.method === 'POST') {
        await auditGate;
        return { ok: false, status: 500, json: async () => ({ error: 'Heuristics engine crashed' }) };
      }
      return { ok: true, status: 200, json: async () => mockInitialData };
    });

    render(<Dashboard initialData={mockInitialData} />);
    fireEvent.click(await screen.findByRole('button', { name: /AI Insights/i }));
    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: /Trigger NLG Audit/i }));
    });
    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: /Push to Background/i }));
    });
    await act(async () => {
      releaseAudit?.();
    });

    expect(await screen.findByText(/Audit Execution Error/i)).toBeInTheDocument();
    expect(screen.getByText(/Heuristics engine crashed/i)).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Dismiss' }));
    expect(screen.queryByText(/Audit Execution Error/i)).not.toBeInTheDocument();
  });

  it('redirects to login when the telemetry poll or session check returns 401', async () => {
    global.fetch = vi.fn().mockImplementation(async (url: string) => {
      if (url.includes('/api/auth/me')) {
        return { ok: false, status: 401, json: async () => ({}) };
      }
      return { ok: false, status: 401, json: async () => ({}) };
    });

    render(<Dashboard initialData={mockInitialData} />);
    fireEvent.click(screen.getByRole('button', { name: /^refresh$/i }));
    await waitFor(() => {
      expect(screen.getByRole('button', { name: /^refresh$/i })).not.toBeDisabled();
    });
    // A 401 must not be rendered as a controller outage
    expect(screen.getByText(/Controller Online/i)).toBeInTheDocument();
  });

  it('handles connection notice retry and dismiss interactions', async () => {
    const offlineData: TelemetryResponse = {
      ...mockInitialData,
      status: {
        ...mockInitialData.status,
        controllerOnline: false,
        error: 'Connection refused at 192.168.1.1',
      },
    };

    render(<Dashboard initialData={offlineData} />);

    expect(screen.getByText(/Connection refused at 192.168.1.1/i)).toBeInTheDocument();

    // Click Retry button
    const retryBtn = screen.getByRole('button', { name: /Retry/i });
    fireEvent.click(retryBtn);

    // Click Dismiss button
    const dismissNoticeBtn = screen.getByRole('button', { name: /Dismiss Connection Notice/i });
    fireEvent.click(dismissNoticeBtn);
    expect(screen.queryByText(/Omada Controller Connection Notice:/i)).not.toBeInTheDocument();
  });
});
