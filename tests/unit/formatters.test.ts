import { describe, it, expect } from 'vitest';
import {
  formatBytes,
  formatRate,
  formatUptime,
  formatMac,
  normalizeMac,
  isDeviceOnline,
  getSignalBand,
  resolveClientVlan,
} from '@/lib/omada/formatters';

describe('formatters', () => {
  describe('formatBytes', () => {
    it('returns "0 B" for undefined, null, NaN, and 0', () => {
      expect(formatBytes(undefined)).toBe('0 B');
      expect(formatBytes(null)).toBe('0 B');
      expect(formatBytes(NaN)).toBe('0 B');
      expect(formatBytes(0)).toBe('0 B');
    });

    it('formats bytes, kilobytes, megabytes, gigabytes, and terabytes', () => {
      expect(formatBytes(500)).toBe('500 B');
      expect(formatBytes(1024)).toBe('1 KB');
      expect(formatBytes(1536)).toBe('1.5 KB');
      expect(formatBytes(1048576)).toBe('1 MB');
      expect(formatBytes(1073741824)).toBe('1 GB');
      expect(formatBytes(1099511627776)).toBe('1 TB');
      expect(formatBytes(1125899906842624)).toBe('1 PB');
      expect(formatBytes(1125899906842624 * 1024)).toBe('1024 PB'); // Clamps to largest unit
    });

    it('keeps sub-1 values in the base unit instead of an undefined unit', () => {
      expect(formatBytes(0.5)).toBe('0.5 B');
      expect(formatBytes(-0.25)).toBe('-0.25 B');
    });

    it('handles custom decimal places and negative decimal edge case', () => {
      expect(formatBytes(1536, 0)).toBe('2 KB');
      expect(formatBytes(1536, 3)).toBe('1.5 KB');
      expect(formatBytes(1536, -1)).toBe('2 KB');
    });
  });

  describe('formatRate', () => {
    it('returns "0 B/s" for undefined, null, NaN, and 0', () => {
      expect(formatRate(undefined)).toBe('0 B/s');
      expect(formatRate(null)).toBe('0 B/s');
      expect(formatRate(NaN)).toBe('0 B/s');
      expect(formatRate(0)).toBe('0 B/s');
    });

    it('keeps sub-1 rates in B/s instead of an undefined unit', () => {
      expect(formatRate(0.5)).toBe('0.5 B/s');
      expect(formatRate(0.04)).toBe('0 B/s');
    });

    it('formats rates across units with default and custom decimals', () => {
      expect(formatRate(512)).toBe('512 B/s');
      expect(formatRate(2048)).toBe('2 KB/s');
      expect(formatRate(2560, 2)).toBe('2.5 KB/s');
      expect(formatRate(1048576 * 5)).toBe('5 MB/s');
      expect(formatRate(1073741824 * 2.5, 1)).toBe('2.5 GB/s');
      expect(formatRate(1073741824 * 1024, -1)).toBe('1024 GB/s'); // negative decimal clamped to 0
    });
  });

  describe('formatUptime', () => {
    it('returns "0s" for undefined, null, 0, or negative seconds', () => {
      expect(formatUptime(undefined)).toBe('0s');
      expect(formatUptime(null)).toBe('0s');
      expect(formatUptime(0)).toBe('0s');
      expect(formatUptime(-50)).toBe('0s');
    });

    it('formats seconds only', () => {
      expect(formatUptime(45)).toBe('45s');
    });

    it('formats minutes and seconds for durations under 5 minutes', () => {
      expect(formatUptime(150)).toBe('2m 30s');
    });

    it('formats minutes only for durations over 5 minutes without hours', () => {
      expect(formatUptime(600)).toBe('10m');
    });

    it('formats hours and minutes', () => {
      expect(formatUptime(3720)).toBe('1h 2m');
    });

    it('formats days and hours', () => {
      expect(formatUptime(90000)).toBe('1d 1h');
      expect(formatUptime(172800)).toBe('2d');
    });
  });

  describe('isDeviceOnline', () => {
    it('prefers statusCategory and falls back to v5 connected codes 14-17', () => {
      expect(isDeviceOnline({ status: 0, statusCategory: 1 })).toBe(true);
      expect(isDeviceOnline({ status: 14, statusCategory: 0 })).toBe(false);
      expect(isDeviceOnline({ status: 14 })).toBe(true);
      expect(isDeviceOnline({ status: 17 })).toBe(true);
      expect(isDeviceOnline({ status: 1 })).toBe(false);
      expect(isDeviceOnline({ status: 30 })).toBe(false);
      expect(isDeviceOnline({})).toBe(false);
      expect(isDeviceOnline(null)).toBe(false);
    });
  });

  describe('getSignalBand', () => {
    it('bands RSSI in dBm', () => {
      expect(getSignalBand({ rssi: -55 })).toBe('excellent');
      expect(getSignalBand({ rssi: -60 })).toBe('good');
      expect(getSignalBand({ rssi: -75 })).toBe('fair');
      expect(getSignalBand({ rssi: -81 })).toBe('poor');
    });

    it('bands signalLevel percentage separately when RSSI is missing', () => {
      expect(getSignalBand({ signalLevel: 90 })).toBe('excellent');
      expect(getSignalBand({ signalLevel: 60 })).toBe('good');
      expect(getSignalBand({ signalLevel: 30 })).toBe('fair');
      expect(getSignalBand({ signalLevel: 10 })).toBe('poor');
      // RSSI wins when both are present
      expect(getSignalBand({ rssi: -85, signalLevel: 90 })).toBe('poor');
    });

    it('returns null when no signal data is reported', () => {
      expect(getSignalBand({})).toBeNull();
    });
  });

  describe('normalizeMac', () => {
    it('strips separators and uppercases so Omada and user formats match', () => {
      expect(normalizeMac('30-68-93-e8-29-54')).toBe('306893E82954');
      expect(normalizeMac('30:68:93:E8:29:54')).toBe('306893E82954');
      expect(normalizeMac(undefined)).toBe('');
      expect(normalizeMac(null)).toBe('');
    });
  });

  describe('formatMac', () => {
    it('returns placeholder for undefined, null, or empty string', () => {
      expect(formatMac(undefined)).toBe('--:--:--:--:--:--');
      expect(formatMac(null)).toBe('--:--:--:--:--:--');
      expect(formatMac('')).toBe('--:--:--:--:--:--');
    });

    it('formats 12-character hex strings with colons', () => {
      expect(formatMac('aabbccddeeff')).toBe('AA:BB:CC:DD:EE:FF');
      expect(formatMac('001122334455')).toBe('00:11:22:33:44:55');
    });

    it('cleans up already colon/hyphen separated MACs and capitalizes', () => {
      expect(formatMac('aa-bb-cc-dd-ee-ff')).toBe('AA:BB:CC:DD:EE:FF');
      expect(formatMac('AA:BB:CC:DD:EE:FF')).toBe('AA:BB:CC:DD:EE:FF');
    });

    it('returns original uppercase MAC if irregular format', () => {
      expect(formatMac('invalid-mac-string')).toBe('INVALID-MAC-STRING');
    });
  });

  describe('resolveClientVlan', () => {
    const networks = [
      { vlan: 1, gatewaySubnet: '192.168.100.1/24' },
      { vlan: 10, gatewaySubnet: '192.168.110.1/24' },
      { vlan: 20, gatewaySubnet: '192.168.120.1/24' },
      { vlan: 50, gatewaySubnet: '192.168.150.1/24' },
    ];

    const ssids = [
      { name: 'TheFarmStrlnk', vlanId: 1 },
      { name: 'TheFarmIot', vlanId: 20 },
      { name: 'iot-dmz', vlanId: 50 },
    ];

    it('returns explicit vlanId if present and > 1', () => {
      expect(resolveClientVlan({ vlanId: 20, ip: '192.168.100.5' }, networks, ssids)).toBe(20);
      expect(resolveClientVlan({ vid: 50 }, networks, ssids)).toBe(50);
    });

    it('resolves VLAN from Wi-Fi SSID mapping', () => {
      expect(resolveClientVlan({ ssid: 'TheFarmIot' }, networks, ssids)).toBe(20);
      expect(resolveClientVlan({ ssid: 'iot-dmz' }, networks, ssids)).toBe(50);
      expect(resolveClientVlan({ ssid: 'TheFarmStrlnk' }, networks, ssids)).toBe(1);
    });

    it('resolves VLAN from IP subnet prefix match', () => {
      expect(resolveClientVlan({ ip: '192.168.120.45' }, networks, ssids)).toBe(20);
      expect(resolveClientVlan({ ip: '192.168.150.12' }, networks, ssids)).toBe(50);
      expect(resolveClientVlan({ ip: '192.168.110.88' }, networks, ssids)).toBe(10);
      expect(resolveClientVlan({ ip: '192.168.100.22' }, networks, ssids)).toBe(1);
    });

    it('falls back to 1 when no rules match', () => {
      expect(resolveClientVlan({ ip: '10.0.0.1' }, networks, ssids)).toBe(1);
      expect(resolveClientVlan({}, networks, ssids)).toBe(1);
    });
  });
});
