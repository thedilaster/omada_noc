import { describe, it, expect } from 'vitest';
import { generateNocPdfReport } from '@/lib/reports/pdf';
import { ReportSummaryData } from '@/types/reports';

describe('PDF Generation Engine (lib/reports/pdf.ts)', () => {
  it('generates a valid jsPDF document with headers, tables, and footer metadata', () => {
    const mockData: ReportSummaryData = {
      generatedAt: '2026-08-28T12:00:00Z',
      siteName: 'The Farm',
      controllerUptime: '12d 6h 30m',
      networkHealthScore: 94,
      infrastructure: {
        totalAps: 9,
        totalSwitches: 4,
        totalGateways: 1,
        totalClients: 72,
        wirelessClients: 58,
        wiredClients: 14,
        freq2gClients: 22,
        freq5gClients: 36,
        aggregateThroughputMbps: 142.5,
        totalSessionTrafficGb: 48.2,
      },
      topActiveDevices: [
        {
          name: 'Core-Server',
          mac: 'AA:BB:CC:DD:EE:01',
          ip: '192.168.1.10',
          medium: 'Wired',
          currentRateMbps: 85.4,
          downloadRateMbps: 50.0,
          uploadRateMbps: 35.4,
          ssidOrPort: 'Port 1',
          apOrSwitchName: 'Main Switch',
        },
      ],
      topVolumeDevices: [
        {
          name: 'Core-Server',
          mac: 'AA:BB:CC:DD:EE:01',
          ip: '192.168.1.10',
          medium: 'Wired',
          totalTrafficMb: 12500.5,
          downloadTrafficMb: 8000.0,
          uploadTrafficMb: 4500.5,
          uptimeSeconds: 86400,
        },
      ],
      topActiveUsers: [
        {
          id: 'u-1',
          username: 'admin',
          email: 'admin@omadanoc.com',
          fullName: 'Lead Engineer',
          role: 'ADMIN',
          taggedDevicesCount: 3,
          lastActiveDate: '2026-08-28T12:00:00Z',
        },
      ],
      rfDistribution: {
        excellent: 35,
        good: 18,
        fair: 4,
        poor: 1,
        totalWireless: 58,
      },
      securitySummary: {
        authSuccessRate24h: 98,
        totalLogins24h: 42,
        failedLogins24h: 1,
        activeUsersCount: 4,
      },
    };

    const doc = generateNocPdfReport(mockData);

    expect(doc).toBeDefined();
    expect(doc.getNumberOfPages()).toBeGreaterThanOrEqual(1);
  });

  it('handles amber (75-89) and rose (<75) health scores with empty table lists', () => {
    const amberData: ReportSummaryData = {
      generatedAt: '2026-08-28T12:00:00Z',
      siteName: 'Backup Site',
      controllerUptime: '1d',
      networkHealthScore: 82, // amber
      infrastructure: {
        totalAps: 1,
        totalSwitches: 1,
        totalGateways: 1,
        totalClients: 0,
        wirelessClients: 0,
        wiredClients: 0,
        freq2gClients: 0,
        freq5gClients: 0,
        aggregateThroughputMbps: 0,
        totalSessionTrafficGb: 0,
      },
      topActiveDevices: [],
      topVolumeDevices: [],
      topActiveUsers: [],
      rfDistribution: { excellent: 0, good: 0, fair: 0, poor: 0, totalWireless: 0 },
      securitySummary: { authSuccessRate24h: 100, totalLogins24h: 0, failedLogins24h: 0, activeUsersCount: 0 },
    };

    const docAmber = generateNocPdfReport(amberData);
    expect(docAmber).toBeDefined();

    const roseData: ReportSummaryData = {
      ...amberData,
      networkHealthScore: 60, // rose
      narration: {
        historyContext: 'Baseline averaged 90/100.',
        deltaChanges: '3 new clients joined.',
        currentStatus: 'Optimal posture.',
        fullNarrative: 'Full narrative text.',
      },
    };
    const docRose = generateNocPdfReport(roseData);
    expect(docRose).toBeDefined();
  });

  it('skips the operator/security section for scoped (non-admin) reports and labels the footer as a Report ID', () => {
    const scopedData: ReportSummaryData = {
      generatedAt: '2026-08-28T12:00:00Z',
      siteName: 'Scoped Site',
      controllerUptime: 'Unknown',
      networkHealthScore: 100,
      infrastructure: {
        totalAps: 0,
        totalSwitches: 0,
        totalGateways: 0,
        totalClients: 0,
        wirelessClients: 0,
        wiredClients: 0,
        freq2gClients: 0,
        freq5gClients: 0,
        aggregateThroughputMbps: 0,
        totalSessionTrafficGb: 0,
      },
      topActiveDevices: [],
      topVolumeDevices: [],
      topActiveUsers: [],
      rfDistribution: { excellent: 0, good: 0, fair: 0, poor: 0, totalWireless: 0 },
    };

    const doc = generateNocPdfReport(scopedData);
    const pdfSource = doc.output();
    expect(pdfSource).not.toContain('Multi-Tenant Scoping');
    expect(pdfSource).not.toContain('No user accounts registered');
    expect(pdfSource).toContain('Report ID:');
    expect(pdfSource).not.toContain('SHA256');

    const adminDoc = generateNocPdfReport({
      ...scopedData,
      securitySummary: { authSuccessRate24h: 100, totalLogins24h: 0, failedLogins24h: 0, activeUsersCount: 0 },
    });
    expect(adminDoc.output()).toContain('Multi-Tenant Scoping');
  });
});
