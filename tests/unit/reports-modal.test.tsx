import React from 'react';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { ReportsModal } from '@/app/components/ReportsModal';
import * as pdfModule from '@/lib/reports/pdf';

describe('ReportsModal Component', () => {
  const mockReport = {
    generatedAt: '2026-08-28T12:00:00Z',
    siteName: 'The Farm',
    controllerUptime: '10d 2h',
    networkHealthScore: 96,
    infrastructure: {
      totalAps: 9,
      totalSwitches: 4,
      totalGateways: 1,
      totalClients: 65,
      wirelessClients: 50,
      wiredClients: 15,
      freq2gClients: 18,
      freq5gClients: 32,
      aggregateThroughputMbps: 120.4,
      totalSessionTrafficGb: 35.8,
    },
    topActiveDevices: [
      {
        name: 'Workstation-Dev',
        mac: 'AA:BB:CC:DD:EE:01',
        ip: '192.168.1.50',
        medium: 'Wired',
        currentRateMbps: 45.2,
        downloadRateMbps: 30.0,
        uploadRateMbps: 15.2,
        ssidOrPort: 'Port 3',
        apOrSwitchName: 'Main Switch',
      },
    ],
    topVolumeDevices: [
      {
        name: 'Workstation-Dev',
        mac: 'AA:BB:CC:DD:EE:01',
        ip: '192.168.1.50',
        medium: 'Wired',
        totalTrafficMb: 8500.2,
        downloadTrafficMb: 5000.0,
        uploadTrafficMb: 3500.2,
        uptimeSeconds: 36000,
      },
    ],
    topActiveUsers: [
      {
        id: 'u-1',
        username: 'admin',
        email: 'admin@omadanoc.com',
        fullName: 'System Admin',
        role: 'ADMIN',
        taggedDevicesCount: 2,
        lastActiveDate: '2026-08-28T12:00:00Z',
      },
    ],
    rfDistribution: {
      excellent: 30,
      good: 15,
      fair: 4,
      poor: 1,
      totalWireless: 50,
    },
    securitySummary: {
      authSuccessRate24h: 100,
      totalLogins24h: 12,
      failedLogins24h: 0,
      activeUsersCount: 3,
    },
    narration: {
      historyContext: 'Historical baseline averaged 96/100.',
      deltaChanges: '+1 new client connected.',
      currentStatus: 'Optimal performance across all physical nodes.',
      fullNarrative: 'Full report narration.',
    },
  };

  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('renders nothing when isOpen is false', () => {
    const { container } = render(<ReportsModal isOpen={false} onClose={vi.fn()} />);
    expect(container.firstChild).toBeNull();
  });

  it('fetches report summary, renders KPI cards, switches tabs, and triggers PDF export', async () => {
    global.fetch = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({ success: true, report: mockReport }),
    });

    const mockSave = vi.fn();
    vi.spyOn(pdfModule, 'generateNocPdfReport').mockReturnValue({ save: mockSave } as any);

    const { unmount } = render(<ReportsModal isOpen={true} onClose={vi.fn()} />);

    expect(screen.getByText(/Aggregating hardware telemetry/i)).toBeInTheDocument();

    await waitFor(() => {
      expect(screen.getByText('Executive Telemetry & SLA Report')).toBeInTheDocument();
      expect(screen.getByText(/AI Audit Comparative Narration/i)).toBeInTheDocument();
      expect(screen.getByText(/Historical baseline averaged 96\/100/i)).toBeInTheDocument();
    });

    expect(screen.getByText('Workstation-Dev')).toBeInTheDocument();

    // Switch to Volume Tab
    fireEvent.click(screen.getByRole('button', { name: /Top 5 Heavy Consumers/i }));
    expect(screen.getByText('8500.2 MB')).toBeInTheDocument();

    // Switch to RF Spectrum Tab
    fireEvent.click(screen.getByRole('button', { name: /Wireless RF Spectrum Quality/i }));
    expect(screen.getByText('Excellent (> -60 dBm)')).toBeInTheDocument();

    // Switch to Operators Tab
    fireEvent.click(screen.getByRole('button', { name: /Top Operators & Security/i }));
    expect(screen.getByText('System Admin')).toBeInTheDocument();

    // Switch back to Devices Tab
    fireEvent.click(screen.getByRole('button', { name: /Top 5 Active Devices/i }));
    expect(screen.getByText('Workstation-Dev')).toBeInTheDocument();

    // Trigger PDF download
    const downloadBtn = screen.getByRole('button', { name: /Download PDF Report/i });
    fireEvent.click(downloadBtn);

    expect(pdfModule.generateNocPdfReport).toHaveBeenCalled();
    expect(mockSave).toHaveBeenCalled();

    // Close button
    const closeBtn = screen.getByRole('button', { name: '✕' });
    fireEvent.click(closeBtn);

    unmount();
  });

  it('renders error message when report summary fetch fails with invalid JSON', async () => {
    global.fetch = vi.fn().mockResolvedValue({
      ok: false,
      status: 500,
      json: async () => {
        throw new Error('Invalid JSON');
      },
    });

    render(<ReportsModal isOpen={true} onClose={vi.fn()} />);

    await waitFor(() => {
      expect(screen.getByText(/Failed to fetch report \(500\)/i)).toBeInTheDocument();
    });
  });

  it('renders error message when report summary fetch fails', async () => {
    global.fetch = vi.fn().mockResolvedValue({
      ok: false,
      status: 500,
      json: async () => ({ error: 'Hardware unreachable' }),
    });

    render(<ReportsModal isOpen={true} onClose={vi.fn()} />);

    await waitFor(() => {
      expect(screen.getByText(/Hardware unreachable/i)).toBeInTheDocument();
    });
  });

  it('clears a stale error and shows loading again when reopened', async () => {
    global.fetch = vi.fn().mockResolvedValue({
      ok: false,
      status: 500,
      json: async () => ({ error: 'Hardware unreachable' }),
    });
    const { rerender } = render(<ReportsModal isOpen={true} onClose={vi.fn()} />);
    await waitFor(() => {
      expect(screen.getByText(/Hardware unreachable/i)).toBeInTheDocument();
    });

    rerender(<ReportsModal isOpen={false} onClose={vi.fn()} />);
    global.fetch = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({ success: true, report: mockReport }),
    });
    rerender(<ReportsModal isOpen={true} onClose={vi.fn()} />);

    expect(screen.queryByText(/Hardware unreachable/i)).not.toBeInTheDocument();
    expect(screen.getByText(/Aggregating hardware telemetry/i)).toBeInTheDocument();
    await waitFor(() => {
      expect(screen.getByText('Workstation-Dev')).toBeInTheDocument();
    });
  });

  it('shows an admin-only notice when the security summary is omitted (non-ADMIN viewer)', async () => {
    const reportWithoutSecurity: Partial<typeof mockReport> = { ...mockReport, topActiveUsers: [] };
    delete reportWithoutSecurity.securitySummary;
    global.fetch = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({ success: true, report: reportWithoutSecurity }),
    });

    render(<ReportsModal isOpen={true} onClose={vi.fn()} />);
    await waitFor(() => {
      expect(screen.getByText('Workstation-Dev')).toBeInTheDocument();
    });
    fireEvent.click(screen.getByRole('button', { name: /Top Operators & Security/i }));
    expect(screen.getByText(/only available to administrators/i)).toBeInTheDocument();
    expect(screen.queryByText(/24h Auth Success Rate/i)).not.toBeInTheDocument();
  });

  it('catches PDF generation errors gracefully', async () => {
    const consoleSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
    global.fetch = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({ success: true, report: mockReport }),
    });

    vi.spyOn(pdfModule, 'generateNocPdfReport').mockImplementation(() => {
      throw new Error('PDF Engine Crash');
    });

    render(<ReportsModal isOpen={true} onClose={vi.fn()} />);

    await waitFor(() => {
      expect(screen.getByText('Executive Telemetry & SLA Report')).toBeInTheDocument();
    });

    const downloadBtn = screen.getByRole('button', { name: /Download PDF Report/i });
    fireEvent.click(downloadBtn);

    expect(consoleSpy).toHaveBeenCalled();
  });
});
