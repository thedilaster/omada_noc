/**
 * Format bytes into human-readable strings (e.g. 1024 -> "1.00 KB")
 */
export function formatBytes(bytes: number | undefined | null, decimals = 2): string {
  if (bytes === undefined || bytes === null || isNaN(bytes) || bytes === 0) {
    return '0 B';
  }

  const k = 1024;
  const dm = decimals < 0 ? 0 : decimals;
  const sizes = ['B', 'KB', 'MB', 'GB', 'TB', 'PB'];

  const i = Math.floor(Math.log(Math.abs(bytes)) / Math.log(k));
  // |bytes| < 1 yields a negative index; clamp to the base unit
  const clampedIndex = Math.max(0, Math.min(i, sizes.length - 1));

  return `${parseFloat((bytes / Math.pow(k, clampedIndex)).toFixed(dm))} ${sizes[clampedIndex]}`;
}

/**
 * Format bandwidth rate into human-readable strings (e.g. 204800 -> "200.00 KB/s")
 */
export function formatRate(bytesPerSecond: number | undefined | null, decimals = 1): string {
  if (bytesPerSecond === undefined || bytesPerSecond === null || isNaN(bytesPerSecond) || bytesPerSecond === 0) {
    return '0 B/s';
  }

  const k = 1024;
  const dm = decimals < 0 ? 0 : decimals;
  const sizes = ['B/s', 'KB/s', 'MB/s', 'GB/s'];

  const i = Math.floor(Math.log(Math.abs(bytesPerSecond)) / Math.log(k));
  // |rate| < 1 yields a negative index; clamp to the base unit
  const clampedIndex = Math.max(0, Math.min(i, sizes.length - 1));

  return `${parseFloat((bytesPerSecond / Math.pow(k, clampedIndex)).toFixed(dm))} ${sizes[clampedIndex]}`;
}

/**
 * Format seconds of uptime into a human-readable duration (e.g. 90061 -> "1d 1h 1m")
 */
export function formatUptime(seconds: number | undefined | null): string {
  if (!seconds || seconds <= 0) return '0s';

  const days = Math.floor(seconds / 86400);
  const hours = Math.floor((seconds % 86400) / 3600);
  const minutes = Math.floor((seconds % 3600) / 60);
  const remainingSeconds = Math.floor(seconds % 60);

  const parts: string[] = [];
  if (days > 0) parts.push(`${days}d`);
  if (hours > 0) parts.push(`${hours}h`);
  if (minutes > 0 && days === 0) parts.push(`${minutes}m`);
  if (parts.length === 0 || (days === 0 && hours === 0 && minutes < 5)) {
    parts.push(`${remainingSeconds}s`);
  }

  return parts.join(' ');
}

/**
 * Whether an Omada device is connected. Prefers `statusCategory` (1 = connected) when the
 * controller supplies it; otherwise accepts the v5 "Connected" status codes 14-17
 * (wired, wireless/mesh, and their migrating variants).
 */
export function isDeviceOnline(device: { status?: number; statusCategory?: number } | null | undefined): boolean {
  if (!device) return false;
  if (typeof device.statusCategory === 'number') return device.statusCategory === 1;
  return typeof device.status === 'number' && device.status >= 14 && device.status <= 17;
}

export type SignalBand = 'excellent' | 'good' | 'fair' | 'poor';

/**
 * Classify a wireless client's signal quality. `rssi` is dBm (> -60 excellent, -60..-70 good,
 * -70..-80 fair, < -80 poor); when only `signalLevel` (0-100 %) is reported it is banded
 * separately (>= 75 excellent, >= 50 good, >= 25 fair, < 25 poor). Returns null when neither is known.
 */
export function getSignalBand(client: { rssi?: number; signalLevel?: number }): SignalBand | null {
  if (typeof client.rssi === 'number') {
    if (client.rssi > -60) return 'excellent';
    if (client.rssi >= -70) return 'good';
    if (client.rssi >= -80) return 'fair';
    return 'poor';
  }
  if (typeof client.signalLevel === 'number') {
    if (client.signalLevel >= 75) return 'excellent';
    if (client.signalLevel >= 50) return 'good';
    if (client.signalLevel >= 25) return 'fair';
    return 'poor';
  }
  return null;
}

/**
 * Normalize a MAC address to 12 uppercase hex characters for comparison
 * (Omada returns "AA-BB-CC-DD-EE-FF" while users often type "aa:bb:cc:dd:ee:ff")
 */
export function normalizeMac(mac: string | undefined | null): string {
  return (mac || '').replace(/[^a-fA-F0-9]/g, '').toUpperCase();
}

/**
 * Format MAC address with standard colons and uppercase (e.g. "AA:BB:CC:DD:EE:FF")
 */
export function formatMac(mac: string | undefined | null): string {
  if (!mac) return '--:--:--:--:--:--';
  const clean = mac.replace(/[^a-fA-F0-9]/g, '').toUpperCase();
  if (clean.length === 12) {
    return clean.match(/.{1,2}/g)?.join(':') || mac;
  }
  return mac.toUpperCase();
}

/**
 * Accurately resolves a client's VLAN ID using explicit vlanId/vid, SSID mapping, or IP subnet matching.
 */
export function resolveClientVlan(
  client: { vlanId?: number; vid?: number; ssid?: string; ip?: string },
  networks?: Array<{ vlan: number; gatewaySubnet?: string }>,
  ssids?: Array<{ name: string; vlanId?: number }>
): number {
  // 1. Direct explicit vlanId or vid (if valid and not 0)
  const explicitVlan = client.vlanId ?? client.vid;
  if (typeof explicitVlan === 'number' && explicitVlan > 0 && explicitVlan !== 1) {
    return explicitVlan;
  }

  // 2. Match via Wi-Fi SSID configuration
  if (client.ssid && ssids && ssids.length > 0) {
    const matchedSsid = ssids.find((s) => s.name.toLowerCase() === client.ssid?.toLowerCase());
    if (matchedSsid?.vlanId && matchedSsid.vlanId > 0) {
      return matchedSsid.vlanId;
    }
  }

  // 3. Match via IP Subnet prefix from LAN network gateway definitions
  if (client.ip && networks && networks.length > 0) {
    const clientParts = client.ip.split('.');
    if (clientParts.length === 4) {
      const clientSubnet3 = clientParts.slice(0, 3).join('.');
      for (const net of networks) {
        if (net.gatewaySubnet) {
          const gwIp = net.gatewaySubnet.split('/')[0];
          const gwParts = gwIp.split('.');
          if (gwParts.length === 4 && gwParts.slice(0, 3).join('.') === clientSubnet3) {
            return net.vlan;
          }
        }
      }
    }
  }

  // 4. Default to explicit vlan if 1, or fallback to 1 (Default / Management)
  return typeof explicitVlan === 'number' && explicitVlan > 0 ? explicitVlan : 1;
}
