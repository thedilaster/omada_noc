import { findUserById, getUserDeviceTags } from '@/lib/db/queries';
import { normalizeMac } from '@/lib/omada/formatters';
import { SessionPayload, UserRole } from '@/types/auth';
import {
  NetworkStatusSummary,
  NocEventItem,
  OmadaClientDevice,
  OmadaLanNetwork,
  OmadaSsidSetting,
  WanStatusInfo,
} from '@/types/omada';

export interface TelemetryViewer {
  userId: string;
  role: UserRole;
}

export interface TelemetryScopeInput {
  status: NetworkStatusSummary;
  clients: OmadaClientDevice[];
  networks?: OmadaLanNetwork[];
  ssids?: OmadaSsidSetting[];
  wanStatus?: WanStatusInfo;
  events?: NocEventItem[];
}

export interface ScopedTelemetry extends TelemetryScopeInput {
  /** True when the viewer is restricted to their tagged devices (or to nothing, on failure). */
  scoped: boolean;
}

/**
 * Loads the session's account so scoping uses the stored role rather than the JWT claim.
 * Returns null (which scopes to no clients) when there is no session, the account is gone,
 * or the lookup fails.
 */
export async function resolveTelemetryViewer(
  session: SessionPayload | null
): Promise<TelemetryViewer | null> {
  if (!session) return null;
  try {
    const user = await findUserById(session.userId);
    return user ? { userId: user.id, role: user.role } : null;
  } catch (err) {
    console.error('Failed to load session user for telemetry scoping:', err);
    return null;
  }
}

/**
 * Returns the normalized MACs a viewer may see, or null for unrestricted access (admins, and
 * users with nothing tagged: "if nothing is tagged then you get to see everything").
 * Fails closed with an empty allow-list when there is no viewer or the tag lookup throws.
 */
export async function resolveAllowedMacs(viewer: TelemetryViewer | null): Promise<Set<string> | null> {
  if (!viewer) return new Set();
  if (viewer.role === 'ADMIN') return null;

  try {
    const tags = await getUserDeviceTags(viewer.userId);
    if (tags.length === 0) return null;
    return new Set(tags.map((t) => normalizeMac(t.macAddress)));
  } catch (err) {
    console.error('Device tag lookup failed; scoping viewer to no clients:', err);
    return new Set();
  }
}

function zeroWanRates(wan: WanStatusInfo): WanStatusInfo {
  return {
    ...wan,
    primaryWan: { ...wan.primaryWan, rxRate: 0, txRate: 0 },
    ...(wan.backupWan && { backupWan: { ...wan.backupWan, rxRate: 0, txRate: 0 } }),
  };
}

/**
 * Device Tagging Matrix scoping shared by the dashboard page and /api/telemetry.
 * Filters clients to the viewer's tagged MACs, recomputes status KPIs and per-VLAN/per-SSID
 * client counts from the visible clients, and for scoped viewers drops NOC events (they name
 * other clients) and zeroes the site-wide WAN rx/tx rates.
 */
export async function scopeTelemetry(
  viewer: TelemetryViewer | null,
  input: TelemetryScopeInput
): Promise<ScopedTelemetry> {
  const allowedMacs = await resolveAllowedMacs(viewer);
  const scoped = allowedMacs !== null;
  const clients = allowedMacs
    ? input.clients.filter((c) => allowedMacs.has(normalizeMac(c.mac)))
    : input.clients;

  const status: NetworkStatusSummary = scoped
    ? {
        ...input.status,
        totalClients: clients.length,
        wirelessClients: clients.filter((c) => c.wireless).length,
        wiredClients: clients.filter((c) => !c.wireless).length,
        totalActivityRate: clients.reduce((sum, c) => sum + (c.activity || 0), 0),
        totalTrafficDown: clients.reduce((sum, c) => sum + (c.trafficDown || 0), 0),
        totalTrafficUp: clients.reduce((sum, c) => sum + (c.trafficUp || 0), 0),
      }
    : input.status;

  // Live client counts are mapped after scoping so they only reflect visible clients
  const networks =
    input.networks && input.networks.length > 0
      ? input.networks.map((net) => ({
          ...net,
          clientCount: clients.filter((c) => c.vlanId === net.vlan).length,
        }))
      : input.networks;

  const ssids =
    input.ssids && input.ssids.length > 0
      ? input.ssids.map((s) => ({
          ...s,
          clientCount: clients.filter((c) => c.ssid?.toLowerCase() === s.name.toLowerCase()).length,
        }))
      : input.ssids;

  return {
    status,
    clients,
    networks,
    ssids,
    wanStatus: scoped && input.wanStatus ? zeroWanRates(input.wanStatus) : input.wanStatus,
    events: scoped ? undefined : input.events,
    scoped,
  };
}
