import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { z } from 'zod';
import { OmadaClient } from '../lib/omada/client';
import { formatBytes, formatRate, formatUptime, formatMac, isDeviceOnline } from '../lib/omada/formatters';
import { getRecentAiInsights } from '../lib/db/queries';
import { isMemoryFallbackActive } from '../lib/db/pool';

// Initialize the Omada API client from environment variables
export const omadaClient = new OmadaClient();

// Instantiate the MCP Server
export const server = new McpServer({
  name: 'omada-noc-mcp-bridge',
  version: '1.0.0',
});

/**
 * Tool 1: get_network_status
 * Retrieves high-level network health, controller status, client counts, and aggregate throughput.
 */
server.tool(
  'get_network_status',
  'Retrieve real-time Omada controller connectivity status, connected client counts (wired vs wireless), and aggregate bandwidth throughput.',
  {},
  async () => {
    try {
      const status = await omadaClient.getNetworkStatus();

      if (!status.controllerOnline) {
        return {
          content: [
            {
              type: 'text',
              text: `⚠️ Omada Controller is currently offline or unreachable.\nError: ${status.error || 'Connection refused'}\nSite: ${status.siteName || status.siteId}`,
            },
          ],
        };
      }

      const summaryText = [
        `📡 **Omada Network Status**`,
        `- **Controller Status:** Online ✅`,
        `- **Controller ID:** ${status.omadacId || 'N/A'}`,
        `- **Active Site:** ${status.siteName || status.siteId} (ID: ${status.siteId})`,
        `- **Total Connected Clients:** ${status.totalClients}`,
        `  - 📶 Wireless: ${status.wirelessClients}`,
        `  - 🔌 Wired: ${status.wiredClients}`,
        `- **Current Aggregate Throughput:** ${formatRate(status.totalActivityRate)}`,
        `- **Cumulative Transferred Data:**`,
        `  - Download: ${formatBytes(status.totalTrafficDown)}`,
        `  - Upload: ${formatBytes(status.totalTrafficUp)}`,
        `- **Last Telemetry Poll:** ${status.lastUpdated}`,
      ].join('\n');

      return {
        content: [
          {
            type: 'text',
            text: summaryText,
          },
        ],
      };
    } catch (error: unknown) {
      const msg = error instanceof Error ? error.message : 'Unknown error';
      return {
        isError: true,
        content: [
          {
            type: 'text',
            text: `Error querying network status: ${msg}`,
          },
        ],
      };
    }
  }
);

/**
 * Tool 2: get_active_clients
 * Retrieves detailed client device telemetry with filtering and sorting options.
 */
server.tool(
  'get_active_clients',
  'Retrieve a list of active network client devices connected to the Omada network, including IP, MAC, connection type (Wi-Fi/Wired), SSID, signal strength, real-time throughput, and uptime.',
  {
    connection_type: z
      .enum(['all', 'wireless', 'wired'])
      .optional()
      .describe('Filter clients by medium: "all", "wireless", or "wired" (default: "all")'),
    sort_by: z
      .enum(['activity', 'traffic', 'uptime'])
      .optional()
      .describe('Sort clients by: "activity" (current bandwidth rate), "traffic" (cumulative bytes), or "uptime" (default: "activity")'),
    limit: z
      .number()
      .min(1)
      .max(100)
      .optional()
      .describe('Maximum number of client devices to return (default: 10)'),
  },
  async ({ connection_type = 'all', sort_by = 'activity', limit = 10 }) => {
    try {
      const rawClients = await omadaClient.getActiveClients();

      // Filter
      const filtered = rawClients.filter((c) => {
        if (connection_type === 'wireless' && !c.wireless) return false;
        if (connection_type === 'wired' && c.wireless) return false;
        return true;
      });

      // Sort
      filtered.sort((a, b) => {
        if (sort_by === 'traffic') {
          const aTraffic = (a.trafficDown || 0) + (a.trafficUp || 0);
          const bTraffic = (b.trafficDown || 0) + (b.trafficUp || 0);
          return bTraffic - aTraffic;
        }
        if (sort_by === 'uptime') {
          return (b.uptime || 0) - (a.uptime || 0);
        }
        return (b.activity || 0) - (a.activity || 0);
      });

      const topClients = filtered.slice(0, limit);

      if (topClients.length === 0) {
        return {
          content: [
            {
              type: 'text',
              text: `No connected clients found matching filter criteria (medium: ${connection_type}).`,
            },
          ],
        };
      }

      const clientListText = topClients
        .map((c, idx) => {
          const name = c.name || c.hostName || 'Unnamed Device';
          const medium = c.wireless
            ? `📶 Wireless (SSID: ${c.ssid || 'N/A'}${c.rssi ? `, Signal: ${c.rssi} dBm` : ''}${c.apName ? `, AP: ${c.apName}` : ''})`
            : `🔌 Wired (${c.switchName ? `Switch: ${c.switchName}, ` : ''}Port: ${c.port ?? 'N/A'})`;
          
          const throughput = formatRate(c.activity);
          const totalTraffic = formatBytes((c.trafficDown || 0) + (c.trafficUp || 0));
          const down = formatBytes(c.trafficDown);
          const up = formatBytes(c.trafficUp);
          const uptime = formatUptime(c.uptime);

          return [
            `${idx + 1}. **${name}**`,
            `   - **IP:** \`${c.ip || '0.0.0.0'}\` | **MAC:** \`${formatMac(c.mac)}\``,
            `   - **Medium:** ${medium}`,
            `   - **Throughput:** ${throughput}`,
            `   - **Total Traffic:** ${totalTraffic} (Down: ${down} / Up: ${up})`,
            `   - **Uptime:** ${uptime}`,
          ].join('\n');
        })
        .join('\n\n');

      const responseHeader = `📋 **Active Clients (${topClients.length} returned, filtered by ${connection_type}, sorted by ${sort_by}):**\n\n`;

      return {
        content: [
          {
            type: 'text',
            text: responseHeader + clientListText,
          },
        ],
      };
    } catch (error: unknown) {
      const msg = error instanceof Error ? error.message : 'Unknown error';
      return {
        isError: true,
        content: [
          {
            type: 'text',
            text: `Error retrieving active clients: ${msg}`,
          },
        ],
      };
    }
  }
);

/**
 * Tool 3: get_network_devices
 * Retrieves physical infrastructure hardware (Access Points, Switches, Gateway) with CPU, memory, and client load.
 */
server.tool(
  'get_network_devices',
  'Retrieve inventory and status of physical network infrastructure devices (Access Points, Switches, and Gateways) including IP, MAC, model, status, CPU utilization, memory utilization, and client count.',
  {
    device_type: z
      .enum(['all', 'ap', 'switch', 'gateway'])
      .optional()
      .describe('Filter by device category: "all", "ap", "switch", or "gateway" (default: "all")'),
  },
  async ({ device_type = 'all' }) => {
    try {
      const devices = await omadaClient.getDevices(device_type);

      if (devices.length === 0) {
        return {
          content: [
            {
              type: 'text',
              text: `No network infrastructure devices found matching filter (type: ${device_type}).`,
            },
          ],
        };
      }

      const deviceListText = devices
        .map((d, idx) => {
          const typeIcon = d.type === 'ap' ? '📶 Access Point' : d.type === 'switch' ? '🔌 Switch' : '🛡️ Gateway';
          const statusText = isDeviceOnline(d) ? 'Connected ✅' : 'Isolated/Offline ⚠️';
          const cpu = d.cpuUtil !== undefined ? `${d.cpuUtil}%` : 'N/A';
          const mem = d.memUtil !== undefined ? `${d.memUtil}%` : 'N/A';
          const clients = d.clientNum !== undefined ? `${d.clientNum} client(s)` : 'N/A';

          return [
            `${idx + 1}. **${d.name}** (${typeIcon})`,
            `   - **Model:** ${d.model} | **IP:** \`${d.ip}\` | **MAC:** \`${formatMac(d.mac)}\``,
            `   - **Status:** ${statusText} | **Clients Connected:** ${clients}`,
            `   - **Resource Load:** CPU: ${cpu} | Memory: ${mem}`,
          ].join('\n');
        })
        .join('\n\n');

      return {
        content: [
          {
            type: 'text',
            text: `🏢 **Network Infrastructure Devices (${devices.length} found, filter: ${device_type}):**\n\n${deviceListText}`,
          },
        ],
      };
    } catch (error: unknown) {
      const msg = error instanceof Error ? error.message : 'Unknown error';
      return {
        isError: true,
        content: [
          {
            type: 'text',
            text: `Error retrieving network devices: ${msg}`,
          },
        ],
      };
    }
  }
);

/**
 * Tool 4: get_client_detail
 * Deep-dive diagnostic lookup for a specific client device by IP, MAC, or Name.
 */
server.tool(
  'get_client_detail',
  'Retrieve in-depth RF, connection, and traffic telemetry for a single client device matching an IP, MAC address, or hostname.',
  {
    query: z.string().describe('The IP address, MAC address, or hostname/name of the target device to inspect.'),
  },
  async ({ query }) => {
    try {
      const client = await omadaClient.getClientDetail(query);

      if (!client) {
        return {
          content: [
            {
              type: 'text',
              text: `No active device found matching query "${query}".`,
            },
          ],
        };
      }

      const name = client.name || client.hostName || 'Unnamed Device';
      const medium = client.wireless
        ? `📶 Wireless (SSID: ${client.ssid || 'N/A'}, AP: ${client.apName || 'N/A'}, Radio: ${client.wifiMode ? `Wi-Fi ${client.wifiMode}` : 'N/A'})`
        : `🔌 Wired (Switch: ${client.switchName || 'N/A'}, Port: ${client.port ?? 'N/A'})`;

      const detailText = [
        `🔍 **Detailed Device Inspection: ${name}**`,
        `- **IP Address:** \`${client.ip || 'N/A'}\``,
        `- **MAC Address:** \`${formatMac(client.mac)}\``,
        `- **Device Type:** ${client.deviceType || 'Unknown'}`,
        `- **Physical Connection:** ${medium}`,
        client.wireless && client.rssi !== undefined ? `- **Signal Quality:** RSSI: \`${client.rssi} dBm\` | Signal Level: \`${client.signalLevel ?? 'N/A'}%\`` : null,
        client.wireless && client.channel ? `- **RF Channel:** ${client.channel}` : null,
        client.rxRate ? `- **Negotiated PHY Rate:** RX: ${formatRate(client.rxRate * 125)} / TX: ${formatRate((client.txRate || 0) * 125)}` : null,
        `- **Instantaneous Throughput:** ${formatRate(client.activity)}`,
        `- **Cumulative Data Volume:** ${formatBytes((client.trafficDown || 0) + (client.trafficUp || 0))} (Down: ${formatBytes(client.trafficDown)} / Up: ${formatBytes(client.trafficUp)})`,
        `- **Session Uptime:** ${formatUptime(client.uptime)}`,
      ]
        .filter(Boolean)
        .join('\n');

      return {
        content: [
          {
            type: 'text',
            text: detailText,
          },
        ],
      };
    } catch (error: unknown) {
      const msg = error instanceof Error ? error.message : 'Unknown error';
      return {
        isError: true,
        content: [
          {
            type: 'text',
            text: `Error inspecting client detail: ${msg}`,
          },
        ],
      };
    }
  }
);

/**
 * Tool 5: audit_network_health
 * Comprehensive automated inspection evaluating infrastructure health, AP load balancing, RF quality, and actionable optimization tips.
 */
server.tool(
  'audit_network_health',
  'Perform a comprehensive network health audit evaluating controller connectivity, AP load balance, RF signal degradation, and generating actionable optimization suggestions.',
  {},
  async () => {
    try {
      const report = await omadaClient.getNetworkHealthAudit();

      const auditText = [
        `🩺 **Omada Network Health & Performance Audit**`,
        `- **Overall Health Score:** ${report.healthScore}/100`,
        `- **Controller Status:** ${report.controllerStatus}`,
        `- **Monitored Devices:** ${report.totalDevices} infrastructure devices, ${report.totalClients} client devices`,
        `- **Audit Timestamp:** ${report.timestamp}`,
        ``,
        `🚨 **Critical Alerts (${report.alerts.length}):**`,
        report.alerts.length > 0 ? report.alerts.map((a) => `  • ❌ ${a}`).join('\n') : '  • No critical alerts detected. ✅',
        ``,
        `⚠️ **Performance Warnings (${report.warnings.length}):**`,
        report.warnings.length > 0 ? report.warnings.map((w) => `  • ⚠️ ${w}`).join('\n') : '  • No performance warnings detected. ✅',
        ``,
        `💡 **Optimization & Tuning Recommendations:**`,
        report.recommendations.map((r) => `  • 💡 ${r}`).join('\n'),
      ].join('\n');

      return {
        content: [
          {
            type: 'text',
            text: auditText,
          },
        ],
      };
    } catch (error: unknown) {
      const msg = error instanceof Error ? error.message : 'Unknown error';
      return {
        isError: true,
        content: [
          {
            type: 'text',
            text: `Error performing network health audit: ${msg}`,
          },
        ],
      };
    }
  }
);

/**
 * Tool 6: get_audit_history
 * Continuous memory audit retrieval showing chronological health score trajectory and resolved/persisting issues.
 */
server.tool(
  'get_audit_history',
  'Retrieve the chronological history and trajectory of previous AI network health audits, score trends, resolved issues, and persisting warnings.',
  {
    limit: z
      .number()
      .int()
      .min(1)
      .max(100)
      .optional()
      .describe('Maximum number of past audit records to retrieve (1-100, default: 5).'),
  },
  async ({ limit = 5 }) => {
    try {
      const history = await getRecentAiInsights(limit);

      // Without PostgreSQL the MCP process only has its own empty in-memory store
      if (history.length === 0 && isMemoryFallbackActive()) {
        return {
          content: [
            {
              type: 'text',
              text: '⚠️ **Audit history requires the PostgreSQL database.** The database is unavailable to the MCP server (check DATABASE_URL), so saved audits from the dashboard cannot be read.',
            },
          ],
        };
      }

      if (history.length === 0) {
        return {
          content: [
            {
              type: 'text',
              text: '📋 **No prior AI network audit history found in database.** Run an audit to initialize the baseline.',
            },
          ],
        };
      }

      const historyText = history
        .map((h, idx) => {
          const deltaSign = h.scoreDelta > 0 ? `+${h.scoreDelta}` : `${h.scoreDelta}`;
          const trendIcon =
            h.trendDirection === 'IMPROVED'
              ? '📈 IMPROVED'
              : h.trendDirection === 'DEGRADED'
              ? '📉 DEGRADED'
              : h.trendDirection === 'INITIAL'
              ? '🔵 INITIAL'
              : '⚖️ STABLE';

          const resolved =
            h.resolvedIssues && h.resolvedIssues.length > 0
              ? h.resolvedIssues.map((r) => `    - 🟢 [Resolved] ${r.title}`).join('\n')
              : '    - None';

          const persisting =
            h.persistingIssues && h.persistingIssues.length > 0
              ? h.persistingIssues.map((p) => `    - 🟡 [Persisting #${p.persistedAuditCount}] ${p.title}`).join('\n')
              : '    - None';

          const newItems =
            h.newIssues && h.newIssues.length > 0
              ? h.newIssues.map((n) => `    - 🔴 [New Anomaly] ${n.title}`).join('\n')
              : '    - None';

          return [
            `### Audit #${idx + 1} • ${new Date(h.createdAt).toLocaleString()} [${trendIcon} (${deltaSign}%)]`,
            `- **Health Score:** ${h.healthScore}/100 (Previous: ${h.previousScore ?? 'N/A'})`,
            `- **Executive Summary:** ${h.executiveSummary}`,
            `- **Resolved Issues:**\n${resolved}`,
            `- **Persisting Issues:**\n${persisting}`,
            `- **New Issues:**\n${newItems}`,
          ].join('\n');
        })
        .join('\n\n---\n\n');

      return {
        content: [
          {
            type: 'text',
            text: `🧠 **Omada AI Continuous Memory Audit Timeline (${history.length} audit(s) retrieved):**\n\n${historyText}`,
          },
        ],
      };
    } catch (error: unknown) {
      const msg = error instanceof Error ? error.message : 'Unknown error';
      return {
        isError: true,
        content: [
          {
            type: 'text',
            text: `Error retrieving AI audit history: ${msg}`,
          },
        ],
      };
    }
  }
);

// Start the server using stdio transport
export async function startMcpServer() {
  const transport = new StdioServerTransport();
  await server.connect(transport);
  console.error('Omada NOC MCP Bridge running on stdio');
}
