'use client';

import React from 'react';
import { OmadaLanNetwork, OmadaSsidSetting } from '@/types/omada';

interface VlanWifiViewProps {
  networks?: OmadaLanNetwork[];
  ssids?: OmadaSsidSetting[];
  siteName?: string;
}

export default function VlanWifiView({
  networks = [],
  ssids = [],
  siteName = 'The Farm',
}: VlanWifiViewProps) {
  const displayNetworks = networks;
  const displaySsids = ssids;

  return (
    <div className="space-y-8 animate-in fade-in duration-200">
      {/* Section 1: VLAN Subnet Segmentation Matrix */}
      <div>
        <div className="flex items-center justify-between gap-3 mb-4">
          <div>
            <h3 className="text-base font-black text-white font-mono flex items-center gap-2">
              <span>🛡️</span>
              <span>VLAN Network Segmentation Matrix</span>
            </h3>
            <p className="text-xs text-slate-400 mt-0.5">
              Isolated layer-2 subnets, gateway addressing, and DHCP pools at <strong className="text-cyan-300 font-semibold">{siteName}</strong>
            </p>
          </div>
          <span className="text-xs font-mono px-3 py-1 rounded-xl bg-slate-900 border border-slate-800 text-slate-300 font-semibold">
            {displayNetworks.length} Active Subnets
          </span>
        </div>

        {displayNetworks.length === 0 ? (
          <div className="p-6 rounded-2xl bg-slate-900/60 border border-slate-800 text-center">
            <p className="text-xs text-slate-400 font-mono">
              🛡️ No managed VLAN networks detected on this site.
            </p>
          </div>
        ) : (
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
            {displayNetworks.map((net) => (
              <div
                key={net.id}
                className="bg-slate-900/90 border border-slate-800/90 hover:border-slate-700 rounded-2xl p-5 shadow-md transition-all duration-200"
              >
                <div className="flex items-start justify-between gap-2 mb-3">
                  <div className="flex items-center gap-2">
                    <span className="px-2 py-0.5 rounded-md bg-purple-950/90 border border-purple-800 text-purple-300 text-xs font-mono font-bold">
                      VLAN {net.vlan}
                    </span>
                    {net.vlan === 1 && (
                      <span className="px-2 py-0.5 rounded-md bg-cyan-950/80 border border-cyan-800 text-cyan-300 text-[10px] font-mono">
                        Management
                      </span>
                    )}
                    {net.vlan === 50 && (
                      <span className="px-2 py-0.5 rounded-md bg-rose-950/80 border border-rose-800 text-rose-300 text-[10px] font-mono">
                        DMZ
                      </span>
                    )}
                  </div>

                  {net.clientCount !== undefined && (
                    <span className="px-2.5 py-0.5 rounded-full bg-emerald-950/80 border border-emerald-800/80 text-emerald-300 text-xs font-mono font-bold">
                      {net.clientCount} clients
                    </span>
                  )}
                </div>

                <h4 className="font-bold text-white text-base truncate font-mono">{net.name}</h4>
                <p className="text-xs text-slate-400 font-mono mt-1">Gateway: <strong className="text-slate-200">{net.gatewaySubnet}</strong></p>

                <div className="mt-4 pt-3 border-t border-slate-800/80 text-xs font-mono space-y-1.5 text-slate-400">
                  <div className="flex justify-between gap-2">
                    <span className="shrink-0">DHCP Range:</span>
                    {net.dhcpEnable ? (
                      <span
                        className="text-slate-200 truncate"
                        title={net.ipaddrStart && net.ipaddrEnd ? `${net.ipaddrStart} - ${net.ipaddrEnd}` : undefined}
                      >
                        {net.ipaddrStart && net.ipaddrEnd
                          ? `${net.ipaddrStart} - ${net.ipaddrEnd}`
                          : 'Enabled'}
                      </span>
                    ) : (
                      <span className="text-amber-300">Disabled</span>
                    )}
                  </div>
                  {net.domain && (
                    <div className="flex justify-between">
                      <span>Domain:</span>
                      <span className="text-cyan-300 truncate max-w-[160px]" title={net.domain}>{net.domain}</span>
                    </div>
                  )}
                </div>
              </div>
            ))}
          </div>
        )}
      </div>

      {/* Section 2: Wireless SSID Fleet Configuration */}
      <div>
        <div className="flex items-center justify-between gap-3 mb-4">
          <div>
            <h3 className="text-base font-black text-white font-mono flex items-center gap-2">
              <span>📶</span>
              <span>Wireless SSID Fleet Configuration</span>
            </h3>
            <p className="text-xs text-slate-400 mt-0.5">
              Active wireless broadcast networks, security profiles, and VLAN bindings
            </p>
          </div>
          <span className="text-xs font-mono px-3 py-1 rounded-xl bg-slate-900 border border-slate-800 text-slate-300 font-semibold">
            {displaySsids.length} Broadcast SSIDs
          </span>
        </div>

        {displaySsids.length === 0 ? (
          <div className="p-6 rounded-2xl bg-slate-900/60 border border-slate-800 text-center">
            <p className="text-xs text-slate-400 font-mono">
              📶 No wireless SSIDs detected on this site.
            </p>
          </div>
        ) : (
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
            {displaySsids.map((ssid) => (
              <div
                key={ssid.id}
                className="bg-slate-900/90 border border-slate-800/90 hover:border-slate-700 rounded-2xl p-5 shadow-md transition-all duration-200"
              >
                <div className="flex items-start justify-between gap-2 mb-3">
                  <span className="text-xs font-mono px-2 py-0.5 rounded-md bg-cyan-950/80 border border-cyan-800 text-cyan-300 font-semibold">
                    {ssid.bandText || (ssid.band === 1 ? '2.4 GHz' : 'Dual-Band')}
                  </span>

                  <span className={`px-2 py-0.5 rounded-full text-[10px] font-mono font-bold ${
                    ssid.broadcast
                      ? 'bg-emerald-950/80 border border-emerald-800 text-emerald-300'
                      : 'bg-amber-950/80 border border-amber-800 text-amber-300'
                  }`}>
                    {ssid.broadcast ? 'Broadcast' : 'Hidden'}
                  </span>
                </div>

                <h4 className="font-bold text-white text-base truncate font-mono">{ssid.name}</h4>
                <p className="text-xs text-slate-400 font-mono mt-1">
                  Security: <span className="text-slate-200">{ssid.securityText || 'WPA2/WPA3'}</span>
                </p>

                <div className="mt-4 pt-3 border-t border-slate-800/80 text-xs font-mono flex items-center justify-between text-slate-400">
                  <div>
                    VLAN Tag: <strong className="text-purple-300">{ssid.vlanEnable ? `VLAN ${ssid.vlanId}` : 'Untagged (VLAN 1)'}</strong>
                  </div>
                  {ssid.clientCount !== undefined && (
                    <div className="font-bold text-cyan-400">
                      {ssid.clientCount} active clients
                    </div>
                  )}
                </div>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
