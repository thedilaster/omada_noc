'use client';

import React, { useState, useEffect } from 'react';
import { ReportSummaryData } from '@/types/reports';
import { generateNocPdfReport } from '@/lib/reports/pdf';
import { formatUptime } from '@/lib/omada/formatters';

interface ReportsModalProps {
  isOpen: boolean;
  onClose: () => void;
}

export function ReportsModal({ isOpen, onClose }: ReportsModalProps) {
  const [report, setReport] = useState<ReportSummaryData | null>(null);
  const [loading, setLoading] = useState<boolean>(true);
  const [error, setError] = useState<string | null>(null);
  const [activeTab, setActiveTab] = useState<'devices' | 'volume' | 'users' | 'rf'>('devices');

  // Reset transient fetch state whenever the modal is reopened (adjusting state on prop change)
  const [wasOpen, setWasOpen] = useState<boolean>(isOpen);
  if (wasOpen !== isOpen) {
    setWasOpen(isOpen);
    if (isOpen) {
      setLoading(true);
      setError(null);
    }
  }

  useEffect(() => {
    if (!isOpen) return;

    let isMounted = true;
    const load = async () => {
      try {
        const res = await fetch('/api/reports/summary');
        if (!res.ok) {
          const body = await res.json().catch(() => ({}));
          throw new Error(body.error || `Failed to fetch report (${res.status})`);
        }
        const data = await res.json();
        if (isMounted) {
          setReport(data.report);
          setLoading(false);
        }
      } catch (err: unknown) {
        if (isMounted) {
          setError(err instanceof Error ? err.message : 'Failed to load report summary.');
          setLoading(false);
        }
      }
    };

    load();

    return () => {
      isMounted = false;
    };
  }, [isOpen]);

  if (!isOpen) return null;

  const handleDownloadPdf = () => {
    if (!report) return;
    try {
      const doc = generateNocPdfReport(report);
      doc.save(`omada-executive-report-${new Date().toISOString().split('T')[0]}.pdf`);
    } catch (err) {
      console.error('PDF export failed:', err);
    }
  };

  return (
    <div
      role="dialog"
      aria-modal="true"
      className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-slate-950/80 backdrop-blur-md animate-fade-in"
    >
      <div className="bg-slate-900 border border-slate-800 rounded-2xl w-full max-w-5xl max-h-[90vh] shadow-2xl flex flex-col overflow-hidden">
        {/* Header */}
        <div className="flex items-center justify-between px-6 py-4 border-b border-slate-800 bg-slate-900/60">
          <div className="flex items-center space-x-3">
            <div className="w-9 h-9 rounded-xl bg-cyan-500/10 border border-cyan-500/30 flex items-center justify-center text-cyan-400">
              <span className="text-lg">📊</span>
            </div>
            <div>
              <h2 className="text-base font-bold text-slate-100 flex items-center gap-2">
                Executive Telemetry & SLA Report
                <span className="text-[10px] font-mono font-semibold px-2 py-0.5 rounded-full bg-cyan-950/80 text-cyan-400 border border-cyan-800/60">
                  LIVE AGGREGATION
                </span>
              </h2>
              <p className="text-xs text-slate-400">
                Site: {report?.siteName || 'The Farm'} • Uptime: {report?.controllerUptime || 'Loading...'}
              </p>
            </div>
          </div>

          <div className="flex items-center space-x-3">
            <button
              onClick={handleDownloadPdf}
              disabled={loading || !report}
              className="flex items-center space-x-2 px-3.5 py-1.5 rounded-xl bg-gradient-to-r from-cyan-600 to-blue-600 hover:from-cyan-500 hover:to-blue-500 text-white text-xs font-semibold shadow-lg shadow-cyan-500/20 disabled:opacity-50 disabled:cursor-not-allowed transition-all cursor-pointer"
            >
              <span>📥</span>
              <span>Download PDF Report</span>
            </button>
            <button
              onClick={onClose}
              className="p-1.5 rounded-lg text-slate-400 hover:text-slate-200 hover:bg-slate-800 transition-colors"
            >
              ✕
            </button>
          </div>
        </div>

        {/* Modal Body */}
        <div className="flex-1 overflow-y-auto p-6 space-y-6">
          {loading && (
            <div className="py-20 flex flex-col items-center justify-center space-y-3">
              <div className="w-8 h-8 border-2 border-cyan-500/30 border-t-cyan-500 rounded-full animate-spin" />
              <p className="text-xs text-slate-400 font-mono">Aggregating hardware telemetry & database records...</p>
            </div>
          )}

          {error && (
            <div className="p-4 rounded-xl bg-rose-500/10 border border-rose-500/30 text-rose-300 text-xs">
              ⚠️ {error}
            </div>
          )}

          {report && !loading && (
            <>
              {/* Executive KPI Banner */}
              <div className="grid grid-cols-2 md:grid-cols-5 gap-3">
                <div className="p-3.5 rounded-xl bg-slate-950/70 border border-slate-800">
                  <div className="text-[11px] font-semibold text-slate-400 mb-1">Health Score</div>
                  <div className="text-xl font-black text-emerald-400 font-mono">
                    {report.networkHealthScore}
                    <span className="text-xs font-normal text-slate-500">/100</span>
                  </div>
                </div>

                <div className="p-3.5 rounded-xl bg-slate-950/70 border border-slate-800">
                  <div className="text-[11px] font-semibold text-slate-400 mb-1">Connected Clients</div>
                  <div className="text-xl font-bold text-slate-100 font-mono">
                    {report.infrastructure.totalClients}
                  </div>
                  <div className="text-[10px] text-slate-500 mt-0.5">
                    {report.infrastructure.wirelessClients} Wi-Fi • {report.infrastructure.wiredClients} Wired
                  </div>
                </div>

                <div className="p-3.5 rounded-xl bg-slate-950/70 border border-slate-800">
                  <div className="text-[11px] font-semibold text-slate-400 mb-1">Managed Nodes</div>
                  <div className="text-xl font-bold text-cyan-400 font-mono">
                    {report.infrastructure.totalAps +
                      report.infrastructure.totalSwitches +
                      report.infrastructure.totalGateways}
                  </div>
                  <div className="text-[10px] text-slate-500 mt-0.5">
                    {report.infrastructure.totalAps} AP • {report.infrastructure.totalSwitches} Switch • {report.infrastructure.totalGateways} GW
                  </div>
                </div>

                <div className="p-3.5 rounded-xl bg-slate-950/70 border border-slate-800">
                  <div className="text-[11px] font-semibold text-slate-400 mb-1">Live Rate</div>
                  <div className="text-xl font-bold text-indigo-400 font-mono">
                    {report.infrastructure.aggregateThroughputMbps}{' '}
                    <span className="text-xs font-normal text-slate-500">Mbps</span>
                  </div>
                </div>

                <div className="p-3.5 rounded-xl bg-slate-950/70 border border-slate-800">
                  <div className="text-[11px] font-semibold text-slate-400 mb-1">Session Volume</div>
                  <div className="text-xl font-bold text-teal-400 font-mono">
                    {report.infrastructure.totalSessionTrafficGb}{' '}
                    <span className="text-xs font-normal text-slate-500">GB</span>
                  </div>
                </div>
              </div>

              {/* AI Audit Comparative Narration Banner */}
              {report.narration && (
                <div className="p-4 rounded-2xl bg-gradient-to-b from-slate-950 to-slate-900/90 border border-purple-800/50 shadow-md space-y-3">
                  <div className="flex items-center gap-2 border-b border-slate-800 pb-2">
                    <span className="text-base">🎙️</span>
                    <h3 className="text-xs font-bold text-purple-300 uppercase tracking-wider font-mono">
                      AI Audit Comparative Narration
                    </h3>
                  </div>
                  <div className="grid grid-cols-1 md:grid-cols-3 gap-3 text-xs">
                    <div className="bg-slate-950/70 p-3 rounded-xl border border-slate-800 space-y-1">
                      <span className="text-cyan-400 font-bold font-mono text-[10px] block">🕒 HISTORICAL BASELINE</span>
                      <p className="text-slate-300 text-[11px] leading-relaxed">{report.narration.historyContext}</p>
                    </div>
                    <div className="bg-slate-950/70 p-3 rounded-xl border border-slate-800 space-y-1">
                      <span className="text-amber-400 font-bold font-mono text-[10px] block">🔄 COMPARATIVE DELTA</span>
                      <p className="text-slate-300 text-[11px] leading-relaxed">{report.narration.deltaChanges}</p>
                    </div>
                    <div className="bg-slate-950/70 p-3 rounded-xl border border-slate-800 space-y-1">
                      <span className="text-emerald-400 font-bold font-mono text-[10px] block">🌐 CURRENT POSTURE</span>
                      <p className="text-slate-300 text-[11px] leading-relaxed">{report.narration.currentStatus}</p>
                    </div>
                  </div>
                </div>
              )}

              {/* Sub-Navigation Tabs */}
              <div className="flex border-b border-slate-800 space-x-1">
                <button
                  onClick={() => setActiveTab('devices')}
                  className={`px-4 py-2 text-xs font-semibold border-b-2 transition-colors cursor-pointer ${
                    activeTab === 'devices'
                      ? 'border-cyan-500 text-cyan-400'
                      : 'border-transparent text-slate-400 hover:text-slate-200'
                  }`}
                >
                  🚀 Top 5 Active Devices (Rate)
                </button>
                <button
                  onClick={() => setActiveTab('volume')}
                  className={`px-4 py-2 text-xs font-semibold border-b-2 transition-colors cursor-pointer ${
                    activeTab === 'volume'
                      ? 'border-cyan-500 text-cyan-400'
                      : 'border-transparent text-slate-400 hover:text-slate-200'
                  }`}
                >
                  📦 Top 5 Heavy Consumers (Volume)
                </button>
                <button
                  onClick={() => setActiveTab('rf')}
                  className={`px-4 py-2 text-xs font-semibold border-b-2 transition-colors cursor-pointer ${
                    activeTab === 'rf'
                      ? 'border-cyan-500 text-cyan-400'
                      : 'border-transparent text-slate-400 hover:text-slate-200'
                  }`}
                >
                  📶 Wireless RF Spectrum Quality
                </button>
                <button
                  onClick={() => setActiveTab('users')}
                  className={`px-4 py-2 text-xs font-semibold border-b-2 transition-colors cursor-pointer ${
                    activeTab === 'users'
                      ? 'border-cyan-500 text-cyan-400'
                      : 'border-transparent text-slate-400 hover:text-slate-200'
                  }`}
                >
                  👥 Top Operators & Security
                </button>
              </div>

              {/* Tab 1: Top 5 Active Devices */}
              {activeTab === 'devices' && (
                <div className="rounded-xl border border-slate-800 overflow-hidden bg-slate-950/40">
                  <table className="w-full text-left text-xs">
                    <thead className="bg-slate-900/90 text-slate-400 uppercase text-[10px] font-semibold border-b border-slate-800">
                      <tr>
                        <th className="px-4 py-3">Device</th>
                        <th className="px-4 py-3">IP / MAC Address</th>
                        <th className="px-4 py-3">Connection Point</th>
                        <th className="px-4 py-3 text-right">Throughput Rate</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-slate-800/60 font-mono">
                      {report.topActiveDevices.map((d, index) => (
                        <tr key={d.mac} className="hover:bg-slate-800/30 transition-colors">
                          <td className="px-4 py-3">
                            <div className="font-semibold text-slate-200 font-sans flex items-center space-x-2">
                              <span className="text-[10px] px-1.5 py-0.5 rounded bg-cyan-950 text-cyan-400 border border-cyan-800">
                                #{index + 1}
                              </span>
                              <span>{d.name}</span>
                            </div>
                            <span className="text-[10px] text-slate-500">{d.medium}</span>
                          </td>
                          <td className="px-4 py-3 text-slate-300">
                            <div>{d.ip}</div>
                            <div className="text-[10px] text-slate-500">{d.mac}</div>
                          </td>
                          <td className="px-4 py-3 text-slate-300 font-sans text-[11px]">
                            <div>{d.ssidOrPort}</div>
                            <div className="text-[10px] text-slate-500">{d.apOrSwitchName}</div>
                          </td>
                          <td className="px-4 py-3 text-right">
                            <span className="text-cyan-400 font-bold">{d.currentRateMbps} Mbps</span>
                            <div className="text-[10px] text-slate-500">
                              ↓ {d.downloadRateMbps} • ↑ {d.uploadRateMbps}
                            </div>
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}

              {/* Tab 2: Top 5 Volume Devices */}
              {activeTab === 'volume' && (
                <div className="rounded-xl border border-slate-800 overflow-hidden bg-slate-950/40">
                  <table className="w-full text-left text-xs">
                    <thead className="bg-slate-900/90 text-slate-400 uppercase text-[10px] font-semibold border-b border-slate-800">
                      <tr>
                        <th className="px-4 py-3">Device</th>
                        <th className="px-4 py-3">IP / MAC</th>
                        <th className="px-4 py-3">Session Uptime</th>
                        <th className="px-4 py-3 text-right">Total Cumulative Volume</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-slate-800/60 font-mono">
                      {report.topVolumeDevices.map((d, index) => (
                        <tr key={d.mac} className="hover:bg-slate-800/30 transition-colors">
                          <td className="px-4 py-3">
                            <div className="font-semibold text-slate-200 font-sans flex items-center space-x-2">
                              <span className="text-[10px] px-1.5 py-0.5 rounded bg-indigo-950 text-indigo-400 border border-indigo-800">
                                #{index + 1}
                              </span>
                              <span>{d.name}</span>
                            </div>
                            <span className="text-[10px] text-slate-500">{d.medium}</span>
                          </td>
                          <td className="px-4 py-3 text-slate-300">
                            <div>{d.ip}</div>
                            <div className="text-[10px] text-slate-500">{d.mac}</div>
                          </td>
                          <td className="px-4 py-3 text-slate-300 font-sans text-[11px]">
                            {formatUptime(d.uptimeSeconds)}
                          </td>
                          <td className="px-4 py-3 text-right">
                            <span className="text-teal-400 font-bold">{d.totalTrafficMb} MB</span>
                            <div className="text-[10px] text-slate-500">
                              ↓ {d.downloadTrafficMb} MB • ↑ {d.uploadTrafficMb} MB
                            </div>
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}

              {/* Tab 3: Wireless RF Spectrum */}
              {activeTab === 'rf' && (
                <div className="space-y-4">
                  <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
                    <div className="p-4 rounded-xl bg-slate-950/70 border border-slate-800">
                      <div className="text-xs text-emerald-400 font-semibold mb-1">Excellent (&gt; -60 dBm)</div>
                      <div className="text-2xl font-black text-slate-100 font-mono">
                        {report.rfDistribution.excellent}
                      </div>
                      <div className="text-[10px] text-slate-400 mt-1">Maximum PHY speed, lowest latency</div>
                    </div>

                    <div className="p-4 rounded-xl bg-slate-950/70 border border-slate-800">
                      <div className="text-xs text-cyan-400 font-semibold mb-1">Good (-60 to -70 dBm)</div>
                      <div className="text-2xl font-black text-slate-100 font-mono">
                        {report.rfDistribution.good}
                      </div>
                      <div className="text-[10px] text-slate-400 mt-1">Reliable, stable wireless connection</div>
                    </div>

                    <div className="p-4 rounded-xl bg-slate-950/70 border border-slate-800">
                      <div className="text-xs text-amber-400 font-semibold mb-1">Fair (-70 to -80 dBm)</div>
                      <div className="text-2xl font-black text-slate-100 font-mono">
                        {report.rfDistribution.fair}
                      </div>
                      <div className="text-[10px] text-slate-400 mt-1">Moderate signal; candidate for AP roaming</div>
                    </div>

                    <div className="p-4 rounded-xl bg-slate-950/70 border border-slate-800">
                      <div className="text-xs text-rose-400 font-semibold mb-1">Poor (&lt; -80 dBm)</div>
                      <div className="text-2xl font-black text-slate-100 font-mono">
                        {report.rfDistribution.poor}
                      </div>
                      <div className="text-[10px] text-slate-400 mt-1">High packet retry risk, potential drops</div>
                    </div>
                  </div>
                </div>
              )}

              {/* Tab 4: Top Operators & Security */}
              {activeTab === 'users' && (
                <div className="space-y-4">
                  {!report.securitySummary ? (
                    <div className="p-4 rounded-xl bg-slate-950/70 border border-slate-800 text-xs text-slate-400 font-mono">
                      🔒 Operator and authentication audit data is only available to administrators.
                    </div>
                  ) : (
                    <div className="grid grid-cols-3 gap-3">
                      <div className="p-3.5 rounded-xl bg-slate-950/70 border border-slate-800">
                        <div className="text-[11px] font-semibold text-slate-400">24h Auth Success Rate</div>
                        <div className="text-xl font-bold text-emerald-400 font-mono mt-1">
                          {report.securitySummary.authSuccessRate24h}%
                        </div>
                      </div>
                      <div className="p-3.5 rounded-xl bg-slate-950/70 border border-slate-800">
                        <div className="text-[11px] font-semibold text-slate-400">Total Auth Events (24h)</div>
                        <div className="text-xl font-bold text-slate-100 font-mono mt-1">
                          {report.securitySummary.totalLogins24h}
                        </div>
                      </div>
                      <div className="p-3.5 rounded-xl bg-slate-950/70 border border-slate-800">
                        <div className="text-[11px] font-semibold text-slate-400">Registered Operators</div>
                        <div className="text-xl font-bold text-cyan-400 font-mono mt-1">
                          {report.securitySummary.activeUsersCount}
                        </div>
                      </div>
                    </div>
                  )}

                  <div className="rounded-xl border border-slate-800 overflow-hidden bg-slate-950/40">
                    <table className="w-full text-left text-xs">
                      <thead className="bg-slate-900/90 text-slate-400 uppercase text-[10px] font-semibold border-b border-slate-800">
                        <tr>
                          <th className="px-4 py-3">Operator Name</th>
                          <th className="px-4 py-3">Email Address</th>
                          <th className="px-4 py-3">Role</th>
                          <th className="px-4 py-3 text-right">Tagged Devices</th>
                        </tr>
                      </thead>
                      <tbody className="divide-y divide-slate-800/60">
                        {report.topActiveUsers.map((u) => (
                          <tr key={u.id} className="hover:bg-slate-800/30 transition-colors">
                            <td className="px-4 py-3 font-semibold text-slate-200">{u.fullName}</td>
                            <td className="px-4 py-3 text-slate-400 font-mono">{u.email}</td>
                            <td className="px-4 py-3">
                              <span
                                className={`text-[10px] font-semibold px-2 py-0.5 rounded-full ${
                                  u.role === 'ADMIN'
                                    ? 'bg-cyan-950 text-cyan-400 border border-cyan-800'
                                    : 'bg-slate-800 text-slate-300'
                                }`}
                              >
                                {u.role}
                              </span>
                            </td>
                            <td className="px-4 py-3 text-right font-mono text-cyan-400 font-semibold">
                              {u.taggedDevicesCount} device(s)
                            </td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                </div>
              )}
            </>
          )}
        </div>
      </div>
    </div>
  );
}
