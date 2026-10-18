'use client';

import React from 'react';
import { PoeDeviceBudget, OmadaDeviceItem } from '@/types/omada';
import { formatUptime, formatMac } from '@/lib/omada/formatters';
import { getDeviceStatus } from './uiHelpers';

const STATUS_PILL = {
  online: { label: 'Online', className: 'bg-emerald-950 border-emerald-800 text-emerald-300' },
  offline: { label: 'Offline', className: 'bg-rose-950 border-rose-800 text-rose-300' },
  unknown: { label: 'Unknown', className: 'bg-amber-950 border-amber-800 text-amber-300' },
} as const;

interface HardwarePoeViewProps {
  poeDevices?: PoeDeviceBudget[];
  devices?: OmadaDeviceItem[];
  siteName?: string;
}

export default function HardwarePoeView({
  poeDevices = [],
  devices = [],
  siteName = 'The Farm',
}: HardwarePoeViewProps) {
  const displayPoe = poeDevices;
  const displayNodes = devices;
  const totalHeadroom = displayPoe.reduce((sum, d) => sum + d.poeRemain, 0);

  return (
    <div className="space-y-8 animate-in fade-in duration-200">
      {/* Section 1: PoE Switch Power Budget Overview */}
      <div>
        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 mb-4">
          <div>
            <h3 className="text-base font-black text-white font-mono flex items-center gap-2">
              <span>⚡</span>
              <span>PoE Switch Power Budget & Headroom</span>
            </h3>
            <p className="text-xs text-slate-400 mt-0.5">
              Power over Ethernet allocation, wattage draw, and power headroom for <strong className="text-cyan-300 font-semibold">{siteName}</strong>
            </p>
          </div>

          {displayPoe.length > 0 && (
            <div className="flex items-center gap-2 font-mono text-xs">
              <span className="px-3 py-1 rounded-xl bg-emerald-950/80 border border-emerald-800 text-emerald-300 font-bold">
                {totalHeadroom.toFixed(1)} W Available Headroom
              </span>
            </div>
          )}
        </div>

        {displayPoe.length === 0 ? (
          <div className="p-6 rounded-2xl bg-slate-900/60 border border-slate-800 text-center">
            <p className="text-xs text-slate-400 font-mono">
              ⚡ No PoE switch telemetry reporting on this site. (Ensure switches support PoE and SNMP/API polling is active).
            </p>
          </div>
        ) : (
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            {displayPoe.map((dev) => {
              const total = dev.totalPoePower || 65;
              const used = dev.poePowerUsed !== undefined ? dev.poePowerUsed : Math.max(0, +(total - dev.poeRemain).toFixed(1));
              const pct = Math.min(100, Math.round((used / total) * 100));
              const statusPill = STATUS_PILL[getDeviceStatus(dev)];

              return (
                <div
                  key={dev.mac}
                  className="bg-slate-900/90 border border-slate-800/90 hover:border-slate-700 rounded-2xl p-5 shadow-md transition-all duration-200"
                >
                  <div className="flex items-start justify-between gap-3 mb-3">
                    <div>
                      <div className="flex items-center gap-2">
                        <h4 className="text-sm font-bold text-white font-mono">{dev.name}</h4>
                        <span className={`px-2 py-0.5 rounded-full text-[10px] font-mono border font-semibold ${statusPill.className}`}>
                          {statusPill.label}
                        </span>
                      </div>
                      <p className="text-xs text-slate-400 font-mono mt-0.5">
                        {dev.model} • <span className="text-cyan-300">{dev.ip}</span> • MAC: {formatMac(dev.mac)}
                      </p>
                    </div>
                    <div className="text-right">
                      <div className="text-lg font-black text-cyan-300 font-mono">
                        {used}W <span className="text-xs text-slate-400 font-normal">/ {total}W</span>
                      </div>
                      <div className="text-[10px] text-emerald-400 font-mono font-semibold">
                        {dev.poeRemain.toFixed(1)}W Remainder
                      </div>
                    </div>
                  </div>

                  {/* Visual Power Gauge Bar */}
                  <div className="space-y-1.5 pt-1">
                    <div className="flex justify-between text-[11px] font-mono">
                      <span className="text-slate-400">PoE Power Load:</span>
                      <span className={pct > 80 ? 'text-rose-400 font-bold' : pct > 60 ? 'text-amber-400 font-bold' : 'text-emerald-400 font-bold'}>
                        {pct}% Capacity Used
                      </span>
                    </div>
                    <div className="h-2 w-full bg-slate-950 rounded-full overflow-hidden border border-slate-800">
                      <div
                        className={`h-full rounded-full transition-all duration-500 ${
                          pct > 80 ? 'bg-rose-500' : pct > 60 ? 'bg-amber-500' : 'bg-gradient-to-r from-cyan-500 to-emerald-500'
                        }`}
                        style={{ width: `${pct}%` }}
                      />
                    </div>
                  </div>

                  {/* Switch Sub-Metrics */}
                  <div className="grid grid-cols-3 gap-2 mt-4 pt-3 border-t border-slate-800/80 text-[11px] font-mono text-slate-300">
                    <div>
                      <span className="text-slate-500 block text-[10px]">Active Clients</span>
                      <span className="font-semibold text-slate-200">{dev.clientNum} Devices</span>
                    </div>
                    <div>
                      <span className="text-slate-500 block text-[10px]">CPU / Mem</span>
                      <span className="font-semibold text-slate-200">{dev.cpuUtil}% / {dev.memUtil}%</span>
                    </div>
                    <div>
                      <span className="text-slate-500 block text-[10px]">Uptime</span>
                      <span className="font-semibold text-slate-200">{formatUptime(dev.uptime)}</span>
                    </div>
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </div>

      {/* Section 2: Physical Hardware Node Inventory */}
      <div>
        <div className="flex items-center justify-between gap-3 mb-4">
          <div>
            <h3 className="text-base font-black text-white font-mono flex items-center gap-2">
              <span>🖥️</span>
              <span>Physical Hardware Node Inventory</span>
            </h3>
            <p className="text-xs text-slate-400 mt-0.5">
              Discovered physical infrastructure controllers, access points, and switches
            </p>
          </div>
          <span className="text-xs font-mono px-3 py-1 rounded-xl bg-slate-900 border border-slate-800 text-slate-300 font-semibold">
            {displayNodes.length} Total Nodes
          </span>
        </div>

        {displayNodes.length === 0 ? (
          <div className="p-6 rounded-2xl bg-slate-900/60 border border-slate-800 text-center">
            <p className="text-xs text-slate-400 font-mono">
              🖥️ No physical hardware nodes discovered on this site.
            </p>
          </div>
        ) : (
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4">
            {displayNodes.map((node) => (
              <div
                key={node.mac}
                className="bg-slate-900/80 border border-slate-800 hover:border-slate-700 rounded-2xl p-4 shadow-sm transition-all"
              >
                <div className="flex items-center justify-between gap-2 mb-2">
                  <span className="text-xs font-bold text-slate-200 font-mono truncate">{node.name}</span>
                  <span className="text-[10px] font-mono px-2 py-0.5 rounded-full bg-slate-950 text-cyan-400 border border-cyan-900/50 uppercase font-semibold">
                    {node.type}
                  </span>
                </div>
                <div className="space-y-1 text-[11px] font-mono text-slate-400">
                  <div>Model: <span className="text-slate-300">{node.model}</span></div>
                  <div>IP: <span className="text-cyan-300">{node.ip}</span></div>
                  <div>Firmware: <span className="text-slate-300 text-[10px]">{node.firmwareVersion || 'Current'}</span></div>
                  <div>Uptime: <span className="text-slate-300">{formatUptime(node.uptime)}</span></div>
                </div>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
