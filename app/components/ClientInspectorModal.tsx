'use client';

import React, { useState } from 'react';
import { OmadaClientDevice, OmadaLanNetwork } from '@/types/omada';
import { formatBytes, formatRate, formatUptime, formatMac } from '@/lib/omada/formatters';
import { copyText, formatLinkRateKbps, MISSING_VALUE } from './uiHelpers';

interface ClientInspectorModalProps {
  client: OmadaClientDevice | null;
  networks?: OmadaLanNetwork[];
  onClose: () => void;
}

export default function ClientInspectorModal({
  client,
  networks = [],
  onClose,
}: ClientInspectorModalProps) {
  const [copyResult, setCopyResult] = useState<{ key: string; ok: boolean } | null>(null);

  if (!client) return null;

  const handleCopy = async (text: string, key: string) => {
    const ok = await copyText(text);
    setCopyResult({ key, ok });
    setTimeout(() => setCopyResult((prev) => (prev?.key === key ? null : prev)), 2000);
  };

  const copyLabel = (key: string) =>
    copyResult?.key === key ? (copyResult.ok ? '✓' : 'Failed') : 'Copy';

  // Resolve VLAN description
  const vlan = networks.find((n) => n.vlan === (client.vlanId ?? 1));
  const vlanName = vlan ? `${vlan.name} (VLAN ${vlan.vlan})` : `VLAN ${client.vlanId ?? 1}`;

  // Resolve Wi-Fi Mode
  const getWifiModeText = (mode?: number) => {
    switch (mode) {
      case 7:
        return 'Wi-Fi 7 (802.11be)';
      case 6:
        return 'Wi-Fi 6 (802.11ax)';
      case 5:
        return 'Wi-Fi 5 (802.11ac)';
      case 4:
        return 'Wi-Fi 4 (802.11n)';
      default:
        return client.wireless ? 'Wi-Fi (standard not reported)' : 'Wired Ethernet';
    }
  };

  // Signal Strength Quality
  const getRssiQuality = (rssi?: number) => {
    if (rssi === undefined || rssi === null) return { label: 'Signal not reported', color: 'text-slate-400', pct: 0 };
    if (rssi >= -60) return { label: 'Excellent (-50 to -60 dBm)', color: 'text-emerald-400', pct: 95 };
    if (rssi >= -70) return { label: 'Good (-60 to -70 dBm)', color: 'text-cyan-400', pct: 75 };
    if (rssi >= -80) return { label: 'Fair (-70 to -80 dBm)', color: 'text-amber-400', pct: 45 };
    return { label: 'Weak / Degraded (< -80 dBm)', color: 'text-rose-400', pct: 20 };
  };

  const signal = getRssiQuality(client.rssi);

  // Attachment point as reported by the controller: AP (+SSID) for Wi-Fi, switch (+port) for wired
  const getUplinkHop = (): string | null => {
    if (client.wireless) {
      const ap = client.apName || (client.apMac ? formatMac(client.apMac) : '');
      if (!ap) return null;
      return client.ssid ? `${ap} (SSID: ${client.ssid})` : ap;
    }
    const sw = client.switchName || (client.switchMac ? formatMac(client.switchMac) : '');
    if (!sw) return null;
    return typeof client.port === 'number' ? `${sw} Port ${client.port}` : sw;
  };
  const uplinkHop = getUplinkHop();

  // Vendor OUI inference from MAC or Name
  const getVendorName = () => {
    const name = (client.name || client.hostName || '').toLowerCase();
    const mac = (client.mac || '').toLowerCase();
    if (name.includes('apple') || name.includes('macbook') || name.includes('iphone') || name.includes('ipad')) return 'Apple Inc.';
    if (name.includes('ring') || mac.startsWith('40:9b') || mac.startsWith('b0:72')) return 'Ring (Amazon)';
    if (name.includes('alexa') || name.includes('echo') || name.includes('firetv')) return 'Amazon Technologies';
    if (name.includes('esp') || name.includes('shelly') || mac.startsWith('24:dc') || mac.startsWith('ec:fa')) return 'Espressif Systems';
    if (name.includes('samsung') || name.includes('galaxy')) return 'Samsung Electronics';
    if (name.includes('google') || name.includes('nest') || name.includes('pixel')) return 'Google LLC';
    if (name.includes('starlink') || name.includes('tp-link')) return 'TP-Link Corporation';
    return client.deviceType || 'Standard Network Client';
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-slate-950/80 backdrop-blur-sm animate-in fade-in duration-150">
      <div
        role="dialog"
        aria-modal="true"
        aria-label="Client Diagnostic Deep-Dive"
        className="bg-slate-900 border border-cyan-800/80 rounded-3xl p-6 max-w-2xl w-full shadow-2xl space-y-6 relative overflow-hidden"
      >
        {/* Top Header */}
        <div className="flex items-start justify-between gap-4 border-b border-slate-800 pb-4">
          <div className="flex items-center gap-3">
            <div className="w-12 h-12 rounded-2xl bg-cyan-950/80 border border-cyan-700/80 flex items-center justify-center text-2xl shrink-0">
              {client.wireless ? '📡' : '🔌'}
            </div>
            <div>
              <div className="flex items-center gap-2">
                <h3 className="text-lg font-black text-white font-mono truncate">
                  {client.name || client.hostName || 'Unnamed Device'}
                </h3>
                <span className="px-2 py-0.5 rounded-full text-[10px] font-mono font-bold bg-cyan-950 border border-cyan-800 text-cyan-300">
                  {getWifiModeText(client.wifiMode)}
                </span>
              </div>
              <p className="text-xs text-slate-400 font-sans mt-0.5">{getVendorName()}</p>
            </div>
          </div>

          <button
            onClick={onClose}
            className="p-2 text-slate-400 hover:text-white rounded-xl bg-slate-800/80 hover:bg-slate-700 transition-colors cursor-pointer"
            aria-label="Close modal"
          >
            ✕
          </button>
        </div>

        {/* Diagnostic Metrics Grid */}
        <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 text-xs font-mono">
          <div className="bg-slate-950/80 border border-slate-800/90 rounded-xl p-3">
            <span className="text-slate-500 block text-[10px]">IP ADDRESS</span>
            <div className="flex items-center justify-between mt-1">
              <strong className="text-slate-200">{client.ip || '--'}</strong>
              <button
                onClick={() => handleCopy(client.ip, 'ip')}
                className="text-[10px] text-cyan-400 hover:underline cursor-pointer"
              >
                {copyLabel('ip')}
              </button>
            </div>
          </div>

          <div className="bg-slate-950/80 border border-slate-800/90 rounded-xl p-3">
            <span className="text-slate-500 block text-[10px]">MAC ADDRESS</span>
            <div className="flex items-center justify-between mt-1">
              <strong className="text-slate-200 truncate">{formatMac(client.mac)}</strong>
              <button
                onClick={() => handleCopy(client.mac, 'mac')}
                className="text-[10px] text-cyan-400 hover:underline cursor-pointer"
              >
                {copyLabel('mac')}
              </button>
            </div>
          </div>

          <div className="bg-slate-950/80 border border-slate-800/90 rounded-xl p-3">
            <span className="text-slate-500 block text-[10px]">VLAN SEGMENT</span>
            <strong className="text-indigo-400 mt-1 block truncate" title={vlanName}>
              {vlanName}
            </strong>
          </div>

          <div className="bg-slate-950/80 border border-slate-800/90 rounded-xl p-3">
            <span className="text-slate-500 block text-[10px]">SESSION UPTIME</span>
            <strong className="text-slate-200 mt-1 block">{formatUptime(client.uptime)}</strong>
          </div>
        </div>

        {/* RF Signal Strength & Wireless Link Telemetry */}
        {client.wireless && (
          <div className="bg-slate-950/80 border border-slate-800/90 rounded-2xl p-4 space-y-3 font-mono text-xs">
            <div className="flex items-center justify-between">
              <span className="text-cyan-400 font-bold flex items-center gap-1.5">
                <span>📶</span> RF Signal Strength & Radio Link
              </span>
              <span className={`font-bold ${signal.color}`}>{signal.label}</span>
            </div>

            {/* Signal Meter Bar */}
            <div className="w-full bg-slate-900 rounded-full h-2 overflow-hidden border border-slate-800">
              <div
                className={`h-full rounded-full transition-all duration-300 ${
                  signal.pct >= 70 ? 'bg-cyan-400' : signal.pct >= 40 ? 'bg-amber-400' : 'bg-rose-500'
                }`}
                style={{ width: `${signal.pct}%` }}
              />
            </div>

            <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 pt-2 text-[11px] text-slate-400">
              <div>RSSI: <strong className="text-slate-200">{typeof client.rssi === 'number' ? `${client.rssi} dBm` : MISSING_VALUE}</strong></div>
              <div>SNR: <strong className="text-slate-200">{typeof client.snr === 'number' ? `${client.snr} dB` : MISSING_VALUE}</strong></div>
              <div>PHY Tx Rate: <strong className="text-emerald-400">{formatLinkRateKbps(client.txRate)}</strong></div>
              <div>PHY Rx Rate: <strong className="text-cyan-400">{formatLinkRateKbps(client.rxRate)}</strong></div>
            </div>
          </div>
        )}

        {/* Uplink path, built only from the attachment point the controller reported */}
        {uplinkHop && (
          <div className="bg-slate-950/80 border border-slate-800/90 rounded-2xl p-4 space-y-2 font-mono text-xs">
            <span className="text-purple-400 font-bold flex items-center gap-1.5">
              <span>🗺️</span> Uplink Attachment Point
            </span>
            <div className="flex flex-wrap items-center gap-2 pt-1 text-[11px]">
              <span className="px-2.5 py-1 rounded-lg bg-slate-900 border border-slate-700 text-slate-200 font-bold">
                {client.name || client.hostName || 'Client'}
              </span>
              <span className="text-cyan-400">➔</span>
              <span
                className={`px-2.5 py-1 rounded-lg border ${
                  client.wireless
                    ? 'bg-cyan-950 border-cyan-800 text-cyan-300'
                    : 'bg-emerald-950 border-emerald-800 text-emerald-300'
                }`}
              >
                {uplinkHop}
              </span>
            </div>
          </div>
        )}

        {/* Bandwidth Throughput Totals */}
        <div className="grid grid-cols-3 gap-3 font-mono text-xs">
          <div className="bg-slate-950/80 border border-slate-800/90 rounded-xl p-3 text-center">
            <span className="text-slate-500 block text-[10px]">CURRENT RATE</span>
            <strong className="text-cyan-300 text-sm mt-0.5 block">{formatRate(client.activity)}</strong>
          </div>
          <div className="bg-slate-950/80 border border-slate-800/90 rounded-xl p-3 text-center">
            <span className="text-slate-500 block text-[10px]">DOWNLOADED</span>
            <strong className="text-emerald-400 text-sm mt-0.5 block">{formatBytes(client.trafficDown)}</strong>
          </div>
          <div className="bg-slate-950/80 border border-slate-800/90 rounded-xl p-3 text-center">
            <span className="text-slate-500 block text-[10px]">UPLOADED</span>
            <strong className="text-purple-400 text-sm mt-0.5 block">{formatBytes(client.trafficUp)}</strong>
          </div>
        </div>

        {/* Footer Actions */}
        <div className="flex items-center justify-end gap-3 pt-2">
          <button
            onClick={onClose}
            className="px-5 py-2 rounded-xl bg-cyan-500 hover:bg-cyan-400 text-slate-950 font-bold font-mono text-xs transition-colors cursor-pointer"
          >
            Done
          </button>
        </div>
      </div>
    </div>
  );
}
