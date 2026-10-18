import { getOmadaClient, OmadaClient } from '@/lib/omada/client';
import {
  listAllUsersWithDetails,
  getPaginatedLogins,
  getLatestAiInsight,
  getUserDeviceTags,
} from '@/lib/db/queries';
import {
  ReportSummaryData,
  TopActiveDevice,
  TopVolumeDevice,
  TopActiveUser,
  RfDistribution,
} from '@/types/reports';
import { OmadaClientDevice, OmadaDeviceItem } from '@/types/omada';
import { UserRole } from '@/types/auth';
import { formatUptime, getSignalBand, isDeviceOnline, normalizeMac } from '@/lib/omada/formatters';

/** Who the report is generated for; anything other than an ADMIN gets a scoped report. */
export interface ReportViewer {
  userId: string;
  role: UserRole;
}

/** Instantaneous download + upload rate of a client in bytes/s (activity / uploadActivity). */
function clientRateBytes(c: OmadaClientDevice): number {
  return (c.activity || 0) + (c.uploadActivity || 0);
}

function bytesPerSecToMbps(bytesPerSec: number): number {
  return parseFloat(((bytesPerSec * 8) / 1_000_000).toFixed(2));
}

/**
 * Aggregates live network telemetry, hardware inventory, RF statistics,
 * and user security data into an executive summary report.
 *
 * Non-ADMIN viewers (or no viewer) get a scoped report: clients are limited to the
 * viewer's tagged devices when they have tags, and the operator list, login/security
 * audit and AI narration are omitted.
 */
export async function getReportSummary(
  customClient?: OmadaClient,
  viewer?: ReportViewer
): Promise<ReportSummaryData> {
  const client = customClient || getOmadaClient();
  const isAdmin = viewer?.role === 'ADMIN';

  // Fetch live network telemetry in parallel (operator/audit data only for admins)
  const [networkStatus, clientsResult, devicesResult, usersWithDetails, loginsResult, latestInsight, viewerTags] =
    await Promise.all([
      client.getNetworkStatus().catch(() => null),
      client.getActiveClients().catch(() => [] as OmadaClientDevice[]),
      client.getDevices('all').catch(() => [] as OmadaDeviceItem[]),
      isAdmin ? listAllUsersWithDetails().catch(() => []) : Promise.resolve([]),
      isAdmin
        ? getPaginatedLogins(1, 100).catch(() => ({ items: [], total: 0, page: 1, pageSize: 100, totalPages: 1 }))
        : Promise.resolve(null),
      isAdmin ? getLatestAiInsight().catch(() => null) : Promise.resolve(null),
      !isAdmin && viewer ? getUserDeviceTags(viewer.userId) : Promise.resolve([]),
    ]);

  const allClients: OmadaClientDevice[] = Array.isArray(clientsResult)
    ? clientsResult
    : (clientsResult as { clients?: OmadaClientDevice[] })?.clients || [];
  const devices: OmadaDeviceItem[] = devicesResult || [];

  // Scope non-admin viewers to their tagged devices (same rule as the telemetry API)
  const taggedMacs = new Set(viewerTags.map((t) => normalizeMac(t.macAddress)));
  const clients =
    taggedMacs.size > 0 ? allClients.filter((c) => taggedMacs.has(normalizeMac(c.mac))) : allClients;

  // 1. Infrastructure counts
  const totalAps = devices.filter((d) => d.type === 'ap').length;
  const totalSwitches = devices.filter((d) => d.type === 'switch').length;
  const totalGateways = devices.filter((d) => d.type === 'gateway').length;
  const totalClients = clients.length;
  const wirelessClients = clients.filter((c) => c.wireless).length;
  const wiredClients = totalClients - wirelessClients;

  // 2. Band distribution
  let freq2gClients = 0;
  let freq5gClients = 0;
  for (const c of clients) {
    if (c.wireless) {
      if (c.channel && c.channel > 14) {
        freq5gClients++;
      } else {
        freq2gClients++;
      }
    }
  }

  // 3. Top 5 Real-Time Active Devices (Rate-based in Mbps, from activity / uploadActivity bytes/s;
  //    rxRate/txRate are negotiated PHY link rates in Kbps, not throughput)
  const sortedByActivity = [...clients].sort((a, b) => clientRateBytes(b) - clientRateBytes(a));

  const topActiveDevices: TopActiveDevice[] = sortedByActivity.slice(0, 5).map((c) => ({
    name: c.name || c.hostName || c.mac,
    mac: c.mac,
    ip: c.ip || '0.0.0.0',
    medium: c.wireless ? 'Wireless' : 'Wired',
    currentRateMbps: bytesPerSecToMbps(clientRateBytes(c)),
    downloadRateMbps: bytesPerSecToMbps(c.activity || 0),
    uploadRateMbps: bytesPerSecToMbps(c.uploadActivity || 0),
    ssidOrPort: c.wireless ? (c.ssid || 'Wi-Fi') : (c.port ? `Port ${c.port}` : 'Ethernet'),
    apOrSwitchName: c.apName || c.switchName || 'Main Switch',
  }));

  // 4. Top 5 Heaviest Bandwidth Consumers (Cumulative Volume in MB)
  const sortedByVolume = [...clients].sort((a, b) => {
    const volA = (a.trafficDown || 0) + (a.trafficUp || 0);
    const volB = (b.trafficDown || 0) + (b.trafficUp || 0);
    return volB - volA;
  });

  const topVolumeDevices: TopVolumeDevice[] = sortedByVolume.slice(0, 5).map((c) => {
    const downBytes = c.trafficDown || 0;
    const upBytes = c.trafficUp || 0;
    const totalBytes = downBytes + upBytes;

    return {
      name: c.name || c.hostName || c.mac,
      mac: c.mac,
      ip: c.ip || '0.0.0.0',
      medium: c.wireless ? 'Wireless' : 'Wired',
      totalTrafficMb: parseFloat((totalBytes / (1024 * 1024)).toFixed(1)),
      downloadTrafficMb: parseFloat((downBytes / (1024 * 1024)).toFixed(1)),
      uploadTrafficMb: parseFloat((upBytes / (1024 * 1024)).toFixed(1)),
      uptimeSeconds: c.uptime || 0,
    };
  });

  // 5. Top 5 System Users / Operators (by Tagged Devices & Activity) — admin only
  const sortedUsers = [...usersWithDetails].sort((a, b) => {
    return (b.taggedDevices?.length || 0) - (a.taggedDevices?.length || 0);
  });

  const topActiveUsers: TopActiveUser[] = sortedUsers.slice(0, 5).map((u) => ({
    id: u.id,
    username: u.username,
    email: u.email,
    fullName: u.profile?.fullName || u.username,
    role: u.role,
    taggedDevicesCount: u.taggedDevices?.length || 0,
    lastActiveDate: u.updatedAt || u.createdAt,
  }));

  // 6. Wireless RF Signal Distribution (clients reporting neither RSSI nor signal level are not banded)
  const rfDistribution: RfDistribution = {
    excellent: 0,
    good: 0,
    fair: 0,
    poor: 0,
    totalWireless: 0,
  };

  for (const c of clients) {
    if (c.wireless) {
      rfDistribution.totalWireless++;
      const band = getSignalBand(c);
      if (band) {
        rfDistribution[band]++;
      }
    }
  }

  // 7. Security Summary & Login Audits — admin only
  const logins = loginsResult?.items || [];
  const failedLogins24h = logins.filter((l) => l.loginStatus === 'FAILED').length;

  // 8. Health Score Calculation (0 - 100)
  let healthScore = 100;
  if (rfDistribution.poor > 0) {
    healthScore -= Math.min(15, rfDistribution.poor * 3);
  }
  if (failedLogins24h > 5) {
    healthScore -= 10;
  }
  const offlineDevices = devices.filter((d) => !isDeviceOnline(d)).length;
  if (offlineDevices > 0) {
    healthScore -= offlineDevices * 10;
  }
  healthScore = Math.max(50, Math.min(100, healthScore));

  const totalSessionTrafficGb = parseFloat(
    (
      clients.reduce((acc, c) => acc + (c.trafficDown || 0) + (c.trafficUp || 0), 0) /
      (1024 * 1024 * 1024)
    ).toFixed(2)
  );

  const aggregateThroughputMbps = bytesPerSecToMbps(clients.reduce((acc, c) => acc + clientRateBytes(c), 0));

  const maxUptime = Math.max(0, ...devices.map((d) => d.uptime || 0), ...clients.map((c) => c.uptime || 0));
  const controllerUptime = maxUptime > 0 ? formatUptime(maxUptime) : 'Unknown';

  const report: ReportSummaryData = {
    generatedAt: new Date().toISOString(),
    siteName: networkStatus?.siteName || 'Unknown',
    controllerUptime,
    networkHealthScore: healthScore,
    infrastructure: {
      totalAps,
      totalSwitches,
      totalGateways,
      totalClients,
      wirelessClients,
      wiredClients,
      freq2gClients,
      freq5gClients,
      aggregateThroughputMbps,
      totalSessionTrafficGb,
    },
    topActiveDevices,
    topVolumeDevices,
    topActiveUsers,
    rfDistribution,
  };

  if (isAdmin) {
    const successfulLogins = logins.filter((l) => l.loginStatus === 'SUCCESS').length;
    const totalLogins24h = logins.length;
    report.securitySummary = {
      authSuccessRate24h: totalLogins24h > 0 ? Math.round((successfulLogins / totalLogins24h) * 100) : 100,
      totalLogins24h,
      failedLogins24h,
      activeUsersCount: usersWithDetails.length,
    };
    report.narration = latestInsight?.narration || undefined;
  }

  return report;
}
