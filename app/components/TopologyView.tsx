'use client';

import React, { useState } from 'react';
import { OmadaTopologyNode, OmadaDeviceItem, OmadaClientDevice } from '@/types/omada';
import { formatMac } from '@/lib/omada/formatters';
import { getDeviceStatus } from './uiHelpers';

interface TopologyCardNode {
  type?: string;
  name: string;
  mac: string;
  model: string;
  ip?: string;
  clientCount?: number;
  uplink?: string;
  poeWatts?: string;
  status?: number;
  statusCategory?: number;
}

const STATUS_BADGE = {
  online: { label: 'Online', text: 'text-emerald-400', dot: 'bg-emerald-400 animate-pulse' },
  offline: { label: 'Offline', text: 'text-rose-400', dot: 'bg-rose-500' },
  unknown: { label: 'Unknown', text: 'text-amber-400', dot: 'bg-amber-400' },
} as const;

interface TopologyViewProps {
  topology?: OmadaTopologyNode[];
  devices?: OmadaDeviceItem[];
  clients?: OmadaClientDevice[];
  siteName?: string;
}

export default function TopologyView({
  topology = [],
  devices = [],
  siteName = 'The Farm',
}: TopologyViewProps) {
  const [selectedNode, setSelectedNode] = useState<TopologyCardNode | null>(null);

  const [activeLayerFilter, setActiveLayerFilter] = useState<'all' | 'gateway' | 'switch' | 'ap'>('all');

  // Flatten any custom hierarchical topology passed in
  const flattenTopology = (nodes: OmadaTopologyNode[]): OmadaTopologyNode[] => {
    const result: OmadaTopologyNode[] = [];
    const traverse = (nodeList: OmadaTopologyNode[]) => {
      for (const n of nodeList) {
        result.push(n);
        if (n.successors && n.successors.length > 0) {
          traverse(n.successors);
        }
      }
    };
    traverse(nodes);
    return result;
  };

  const customFlatNodes = topology.length > 0 ? flattenTopology(topology) : [];

  // Map real devices to topology nodes if explicit topology tree not provided
  const flatNodes: TopologyCardNode[] = customFlatNodes.length > 0
    ? customFlatNodes
    : devices.map((d) => ({
        type: d.type || 'ap',
        name: d.name || d.model || 'Device',
        mac: d.mac,
        model: d.model,
        ip: d.ip,
        status: d.status,
        statusCategory: (d as { statusCategory?: number }).statusCategory,
        clientCount: d.clientNum ?? 0,
        uplink: 'Auto-Negotiated Uplink',
        poeWatts: d.totalPoePower ? `${(d.totalPoePower - (d.poeRemain ?? 0)).toFixed(1)}W` : undefined,
      }));

  if (flatNodes.length === 0) {
    return (
      <div className="bg-slate-900/90 border border-slate-800 rounded-2xl p-8 text-center space-y-3">
        <div className="text-3xl">🗺️</div>
        <div className="text-sm font-bold text-slate-200 font-mono">Physical Topology Data Unavailable</div>
        <p className="text-xs text-slate-400 max-w-md mx-auto">
          The Omada Controller did not return an active link-layer topology tree or adopted infrastructure nodes for <strong className="text-cyan-300 font-semibold">{siteName}</strong>.
        </p>
      </div>
    );
  }

  const gatewayNode = flatNodes.find((n) => n.type?.toLowerCase() === 'gateway');
  const switches = flatNodes.filter((n) => n.type?.toLowerCase() === 'switch');
  const coreSwitchNode = switches[0] || null;
  const edgeSwitches = switches.length > 1 ? switches.slice(1) : [];
  const accessPoints = flatNodes.filter((n) => n.type?.toLowerCase() === 'ap');

  const customOthers = customFlatNodes.filter(
    (n) => !['gateway', 'switch', 'ap'].includes(n.type?.toLowerCase() || '')
  );

  const getNodeColor = (type?: string) => {
    switch ((type || '').toLowerCase()) {
      case 'gateway':
        return {
          bg: 'bg-purple-950/70',
          border: 'border-purple-600/70',
          badge: 'bg-purple-900/90 text-purple-200 border-purple-700',
          dot: 'bg-purple-400',
          icon: '🛡️',
        };
      case 'switch':
        return {
          bg: 'bg-emerald-950/70',
          border: 'border-emerald-600/70',
          badge: 'bg-emerald-900/90 text-emerald-200 border-emerald-700',
          dot: 'bg-emerald-400',
          icon: '🔀',
        };
      case 'ap':
        return {
          bg: 'bg-cyan-950/70',
          border: 'border-cyan-600/70',
          badge: 'bg-cyan-900/90 text-cyan-200 border-cyan-700',
          dot: 'bg-cyan-400',
          icon: '📡',
        };
      default:
        return {
          bg: 'bg-slate-950/70',
          border: 'border-slate-700',
          badge: 'bg-slate-800 text-slate-300 border-slate-600',
          dot: 'bg-slate-400',
          icon: '💻',
        };
    }
  };

  const renderCard = (node: TopologyCardNode) => {
    const style = getNodeColor(node.type);
    const isSelected = selectedNode?.mac === node.mac;
    const statusBadge = STATUS_BADGE[getDeviceStatus(node)];

    return (
      <div
        key={node.mac || node.name}
        onClick={() => setSelectedNode(node)}
        className={`p-4 rounded-2xl border transition-all duration-200 cursor-pointer shadow-md min-w-[240px] max-w-[280px] flex-1 ${
          isSelected
            ? 'ring-2 ring-cyan-400 scale-[1.02] ' + style.bg + ' ' + style.border
            : 'hover:border-slate-600 bg-slate-900/90 border-slate-800'
        }`}
      >
        <div className="flex items-start justify-between gap-2 mb-2">
          <div className="flex items-center gap-1.5">
            <span className="text-base">{style.icon}</span>
            <span className={`px-2 py-0.5 rounded-full text-[10px] font-mono font-bold uppercase border ${style.badge}`}>
              {node.type || 'unknown'}
            </span>
          </div>
          <div className={`flex items-center gap-1 text-[11px] font-mono ${statusBadge.text}`}>
            <span className={`w-1.5 h-1.5 rounded-full ${statusBadge.dot}`} />
            <span>{statusBadge.label}</span>
          </div>
        </div>

        <h4 className="font-bold text-slate-100 text-sm truncate font-mono" title={node.name}>
          {node.name}
        </h4>
        <p className="text-xs text-slate-400 font-sans mt-0.5 truncate">{node.model}</p>

        <div className="mt-3 pt-2.5 border-t border-slate-800/80 flex items-center justify-between text-[11px] font-mono text-slate-400">
          <span>IP: <strong className="text-slate-200">{node.ip || 'DHCP'}</strong></span>
          {node.clientCount !== undefined && (
            <span className="px-2 py-0.5 rounded bg-slate-950 border border-slate-800 text-cyan-300 font-semibold">
              {node.clientCount} clients
            </span>
          )}
        </div>
      </div>
    );
  };

  return (
    <div className="space-y-6 animate-in fade-in duration-200">
      {/* Header Banner */}
      <div className="bg-slate-900/90 border border-slate-800/80 rounded-2xl p-5 shadow-md flex flex-col sm:flex-row items-start sm:items-center justify-between gap-4">
        <div>
          <h3 className="text-lg font-black text-white font-mono flex items-center gap-2">
            <span>🗺️</span>
            <span>Physical Network Topology Graph</span>
          </h3>
          <p className="text-xs text-slate-400 mt-1">
            Real-time physical link hierarchy and infrastructure distribution for <strong className="text-cyan-300 font-semibold">{siteName}</strong>
          </p>
        </div>

        {/* Layer Filter Pills */}
        <div className="flex flex-wrap items-center gap-2 text-xs font-mono">
          <button
            onClick={() => setActiveLayerFilter('all')}
            className={`px-3 py-1.5 rounded-xl border transition-all cursor-pointer ${
              activeLayerFilter === 'all'
                ? 'bg-cyan-950 border-cyan-700 text-cyan-300 font-bold'
                : 'bg-slate-950 border-slate-800 text-slate-400 hover:text-white'
            }`}
          >
            All Tiers
          </button>
          <button
            onClick={() => setActiveLayerFilter('gateway')}
            className={`px-3 py-1.5 rounded-xl border transition-all cursor-pointer ${
              activeLayerFilter === 'gateway'
                ? 'bg-purple-950 border-purple-700 text-purple-300 font-bold'
                : 'bg-slate-950 border-slate-800 text-slate-400 hover:text-white'
            }`}
          >
            🛡️ Gateway
          </button>
          <button
            onClick={() => setActiveLayerFilter('switch')}
            className={`px-3 py-1.5 rounded-xl border transition-all cursor-pointer ${
              activeLayerFilter === 'switch'
                ? 'bg-emerald-950 border-emerald-700 text-emerald-300 font-bold'
                : 'bg-slate-950 border-slate-800 text-slate-400 hover:text-white'
            }`}
          >
            🔀 Switches
          </button>
          <button
            onClick={() => setActiveLayerFilter('ap')}
            className={`px-3 py-1.5 rounded-xl border transition-all cursor-pointer ${
              activeLayerFilter === 'ap'
                ? 'bg-sky-950 border-sky-700 text-sky-300 font-bold'
                : 'bg-slate-950 border-slate-800 text-slate-400 hover:text-white'
            }`}
          >
            📡 Access Points
          </button>
        </div>
      </div>

      {/* Selected Node Details Drawer */}
      {selectedNode && (
        <div className="bg-slate-900/95 border border-cyan-700/60 rounded-2xl p-5 shadow-xl animate-in slide-in-from-top duration-150">
          <div className="flex items-start justify-between">
            <div>
              <span className="text-[10px] font-mono uppercase px-2 py-0.5 rounded bg-cyan-950 border border-cyan-800 text-cyan-300 font-bold">
                Focused Node Telemetry & Link Details
              </span>
              <h4 className="text-base font-bold text-white font-mono mt-1">{selectedNode.name}</h4>
              <p className="text-xs text-slate-400">{selectedNode.model}</p>
            </div>
            <button
              onClick={() => setSelectedNode(null)}
              className="text-slate-400 hover:text-white text-xs px-2.5 py-1 rounded-lg bg-slate-800 hover:bg-slate-700 transition-colors cursor-pointer"
            >
              ✕ Close
            </button>
          </div>

          <div className="grid grid-cols-2 sm:grid-cols-4 gap-4 mt-4 pt-4 border-t border-slate-800 text-xs font-mono">
            <div>
              <span className="text-slate-500 block">IP Address</span>
              <strong className="text-slate-200">{selectedNode.ip || 'DHCP'}</strong>
            </div>
            <div>
              <span className="text-slate-500 block">MAC Address</span>
              <strong className="text-slate-200">{formatMac(selectedNode.mac)}</strong>
            </div>
            <div>
              <span className="text-slate-500 block">Uplink Link</span>
              <strong className="text-cyan-300">{selectedNode.uplink || 'Gateway SFP Trunk'}</strong>
            </div>
            <div>
              <span className="text-slate-500 block">PoE Allocation</span>
              <strong className="text-emerald-400">{selectedNode.poeWatts || 'Standard Power'}</strong>
            </div>
          </div>
        </div>
      )}

      {/* Structured Tiered Topology Canvas */}
      <div className="bg-slate-950/80 border border-slate-800/80 rounded-2xl p-6 sm:p-10 shadow-inner space-y-8 overflow-x-auto">
        
        {/* Tier 1: Gateway Router */}
        {(activeLayerFilter === 'all' || activeLayerFilter === 'gateway') && gatewayNode && (
          <div className="flex flex-col items-center">
            <div className="flex items-center gap-2 mb-3 text-xs font-mono text-purple-400 uppercase tracking-wider font-semibold">
              <span>Tier 1: Security Gateway & ISP Uplink</span>
            </div>
            {renderCard(gatewayNode)}

            {/* Vertical Trunk to Core Switch */}
            {activeLayerFilter === 'all' && (coreSwitchNode || edgeSwitches.length > 0 || accessPoints.length > 0) && (
              <div className="flex flex-col items-center my-3">
                <div className="w-0.5 h-8 bg-gradient-to-b from-purple-500 to-emerald-500" />
                <span className="px-2.5 py-0.5 rounded-full bg-slate-900 border border-slate-800 text-[10px] font-mono text-slate-400 shadow-sm">
                  1 Gbps SFP Full Duplex Trunk
                </span>
                <div className="w-0.5 h-8 bg-gradient-to-b from-emerald-500 to-emerald-500" />
              </div>
            )}
          </div>
        )}

        {/* Tier 2: Core Backbone PoE Switch */}
        {(activeLayerFilter === 'all' || activeLayerFilter === 'switch') && coreSwitchNode && (
          <div className="flex flex-col items-center">
            <div className="flex items-center gap-2 mb-3 text-xs font-mono text-emerald-400 uppercase tracking-wider font-semibold">
              <span>Tier 2: Core PoE+ Backbone Switch</span>
            </div>
            {renderCard(coreSwitchNode)}

            {/* Distribution Trunk to Edge Switches */}
            {activeLayerFilter === 'all' && (edgeSwitches.length > 0 || accessPoints.length > 0) && (
              <div className="flex flex-col items-center my-3 w-full">
                <div className="w-0.5 h-6 bg-emerald-500" />
                <span className="px-2.5 py-0.5 rounded-full bg-slate-900 border border-slate-800 text-[10px] font-mono text-cyan-400 shadow-sm">
                  Gigabit Distribution Bus
                </span>
                <div className="w-0.5 h-6 bg-slate-700" />

                {/* Horizontal Distribution Rail */}
                <div className="w-4/5 h-0.5 bg-gradient-to-r from-indigo-500 via-emerald-500 to-cyan-500" />
              </div>
            )}
          </div>
        )}

        {/* Tier 3: Edge & Outbuilding Switches */}
        {(activeLayerFilter === 'all' || activeLayerFilter === 'switch') && edgeSwitches.length > 0 && (
          <div className="space-y-3">
            <div className="flex items-center justify-between border-b border-slate-800/80 pb-2">
              <span className="text-xs font-mono text-indigo-400 uppercase tracking-wider font-semibold">
                Tier 3: Distribution & Outbuilding PoE Switches ({edgeSwitches.length} Managed Nodes)
              </span>
              <span className="text-[11px] font-mono text-slate-500">Connected via Core Switch</span>
            </div>

            <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
              {edgeSwitches.map((edge) => renderCard(edge))}
            </div>

            {activeLayerFilter === 'all' && accessPoints.length > 0 && (
              <div className="flex flex-col items-center my-4">
                <div className="w-full h-0.5 bg-slate-800" />
                <span className="px-2.5 py-0.5 rounded-full bg-slate-900 border border-slate-800 text-[10px] font-mono text-slate-400 -mt-2.5 shadow-sm">
                  802.3at PoE Power & Data Feeds
                </span>
              </div>
            )}
          </div>
        )}

        {/* Tier 4: Wireless Access Points (EAPs) */}
        {(activeLayerFilter === 'all' || activeLayerFilter === 'ap') && accessPoints.length > 0 && (
          <div className="space-y-3">
            <div className="flex items-center justify-between border-b border-slate-800/80 pb-2">
              <span className="text-xs font-mono text-cyan-400 uppercase tracking-wider font-semibold">
                Tier 4: High-Density Wireless APs ({accessPoints.length} Active Broadcast Radios)
              </span>
              <span className="text-[11px] font-mono text-cyan-300 font-bold">
                {accessPoints.reduce((sum, ap) => sum + (ap.clientCount || 0), 0)} Active Wi-Fi Clients
              </span>
            </div>

            <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
              {accessPoints.map((ap) => renderCard(ap))}
            </div>
          </div>
        )}



        {/* Tier 5: Other Connected Infrastructure Devices */}
        {customOthers.length > 0 && (
          <div className="space-y-3">
            <div className="flex items-center justify-between border-b border-slate-800/80 pb-2">
              <span className="text-xs font-mono text-slate-400 uppercase tracking-wider font-semibold">
                Auxiliary Network Infrastructure ({customOthers.length} Nodes)
              </span>
            </div>

            <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
              {customOthers.map((other) => renderCard(other))}
            </div>
          </div>
        )}

      </div>
    </div>
  );
}
