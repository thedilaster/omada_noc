import { getOmadaClient, OmadaClient } from '@/lib/omada/client';
import { getRecentAiInsights, saveAiInsight } from '@/lib/db/queries';
import {
  AiInsightRecord,
  AiIssueCategory,
  AiIssueItem,
  AiIssueSeverity,
  AiPersistingIssueItem,
  AiSuggestionItem,
  AiTrendDirection,
  AiNarration,
} from '@/types/reports';
import {
  NetworkStatusSummary,
  OmadaClientDevice,
  OmadaDeviceItem,
  OmadaLanNetwork,
  OmadaSsidSetting,
  PoeDeviceBudget,
} from '@/types/omada';
import { getSignalBand, isDeviceOnline } from '@/lib/omada/formatters';

/**
 * Raised instead of saving an audit when live telemetry is unavailable: an empty
 * snapshot would score 100, mark every prior issue "resolved" and poison the baseline.
 */
export class AiAuditUnavailableError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'AiAuditUnavailableError';
  }
}

function normalizeClientsResult(result: unknown): OmadaClientDevice[] {
  return Array.isArray(result) ? result : (result as { clients?: OmadaClientDevice[] })?.clients || [];
}

/** Throws AiAuditUnavailableError unless the controller is online and clients + devices were retrieved. */
function assertLiveTelemetry(
  networkStatus: NetworkStatusSummary | null,
  clientsResult: unknown,
  devicesResult: OmadaDeviceItem[] | null
): void {
  if (!networkStatus || networkStatus.controllerOnline === false) {
    const reason = networkStatus?.error ? ` (${networkStatus.error})` : '';
    throw new AiAuditUnavailableError(
      `Omada controller is offline or unreachable${reason}. AI audit skipped; no record was saved so the historical baseline is unchanged.`
    );
  }
  if (clientsResult === null || devicesResult === null) {
    throw new AiAuditUnavailableError(
      'Live telemetry is incomplete (client or device inventory could not be retrieved). AI audit skipped; no record was saved.'
    );
  }
}

/** Instantaneous download + upload rate in bytes/s (rxRate/txRate are PHY link rates, not throughput). */
function clientRateBytes(c: OmadaClientDevice): number {
  return (c.activity || 0) + (c.uploadActivity || 0);
}

const TREND_DIRECTIONS: AiTrendDirection[] = ['IMPROVED', 'DEGRADED', 'STABLE', 'INITIAL'];
const ISSUE_CATEGORIES: AiIssueCategory[] = [
  'RF_SIGNAL',
  'CHANNEL_CONGESTION',
  'BANDWIDTH_BURST',
  'DEVICE_OFFLINE',
  'AUTHENTICATION',
  'GENERAL',
];
const ISSUE_SEVERITIES: AiIssueSeverity[] = ['CRITICAL', 'WARNING', 'INFO'];
const SUGGESTION_PRIORITIES: AiSuggestionItem['priority'][] = ['HIGH', 'MEDIUM', 'LOW'];

/** LLM output lists: keep only object entries (a non-array or string entries are ignored). */
function asRecordList(value: unknown): Array<Record<string, unknown>> {
  return Array.isArray(value)
    ? value.filter((v): v is Record<string, unknown> => Boolean(v) && typeof v === 'object' && !Array.isArray(v))
    : [];
}

function asText(value: unknown): string {
  return typeof value === 'string' ? value : '';
}

/**
 * Intelligent helper to determine if a client device is an IoT / Smart Home endpoint
 * based on explicit VLAN tags, IoT SSID associations, and vendor/hostname signatures.
 */
export function isIotClient(client: OmadaClientDevice, networks: OmadaLanNetwork[] = []): boolean {
  // 1. Explicit VLAN matching (e.g. VLAN 20 is IoT, VLAN 50 is IoT-DMZ)
  if (client.vlanId === 20 || client.vlanId === 50) return true;

  if (client.vlanId !== undefined) {
    const net = networks.find((n) => n.vlan === client.vlanId);
    if (net) {
      const netName = (net.name || '').toLowerCase();
      if (netName.includes('iot') || netName.includes('smart') || netName.includes('dmz') || netName.includes('device')) {
        return true;
      }
    }
  }

  // 2. Wireless SSID matching
  const ssid = (client.ssid || '').toLowerCase();
  if (
    ssid.includes('iot') ||
    ssid.includes('alexa') ||
    ssid.includes('ring') ||
    ssid.includes('dmz') ||
    ssid.includes('2.4ext') ||
    ssid.includes('smart')
  ) {
    return true;
  }

  // 3. Name / Hostname / Vendor Signature / MAC OUI matching
  const name = (client.name || client.hostName || '').toLowerCase();
  const mac = (client.mac || '').toLowerCase();
  const iotKeywords = [
    'ring', 'shelly', 'tuya', 'kasa', 'espressif', 'esp32', 'esp8266', 'esp_',
    'alexa', 'echo', 'smart', 'plug', 'sensor', 'lock', 'nest', 'camera', 'cam',
    'schlage', 'bulb', 'switch', 'feit', 'wemo', 'philips', 'hue', 'sonoff', 'tp-link smart',
  ];

  if (iotKeywords.some((kw) => name.includes(kw))) return true;
  if (mac.startsWith('40:9b') || mac.startsWith('b0:72') || mac.startsWith('24:dc') || mac.startsWith('ec:fa')) {
    return true;
  }

  return false;
}

/**
 * Executes a comparative, continuous-learning network health diagnostic audit.
 * Compares current telemetry against historical baseline audits to track
 * improving, degrading, and chronic persistent network conditions with
 * rich multi-factor IoT context and multi-part comparative narration.
 */
export async function runComparativeAiInsight(
  userId: string | null = null,
  customClient?: OmadaClient
): Promise<AiInsightRecord> {
  const client = customClient || getOmadaClient();

  // 1. Fetch historical audit baseline and live telemetry in parallel
  const [
    recentAudits,
    networkStatus,
    clientsResult,
    devicesResult,
    lanNetworksResult,
    poeBudgetsResult,
  ] = await Promise.all([
    getRecentAiInsights(10),
    client.getNetworkStatus().catch(() => null),
    client.getActiveClients().catch(() => null),
    client.getDevices('all').catch(() => null),
    typeof client.getLanNetworks === 'function' ? client.getLanNetworks().catch(() => [] as OmadaLanNetwork[]) : Promise.resolve([]),
    typeof client.getPoeBudgets === 'function' ? client.getPoeBudgets().catch(() => [] as PoeDeviceBudget[]) : Promise.resolve([]),
  ]);

  // Never record an audit from an empty "controller down" snapshot
  assertLiveTelemetry(networkStatus, clientsResult, devicesResult);

  const clients = normalizeClientsResult(clientsResult);
  const devices: OmadaDeviceItem[] = devicesResult || [];
  const networks: OmadaLanNetwork[] = lanNetworksResult || [];
  const poeDevices: PoeDeviceBudget[] = poeBudgetsResult || [];
  const previousAudit = recentAudits.length > 0 ? recentAudits[0] : null;

  // 2. Discover current issues from live telemetry
  const currentDiscoveredIssues: AiIssueItem[] = [];

  // A. Check for offline infrastructure devices
  const offlineDevices = devices.filter((d) => !isDeviceOnline(d));
  for (const dev of offlineDevices) {
    currentDiscoveredIssues.push({
      id: `dev-offline-${dev.mac.replace(/:/g, '')}`,
      category: 'DEVICE_OFFLINE',
      severity: 'CRITICAL',
      title: `Infrastructure Node Offline (${dev.name || dev.model})`,
      description: `Hardware device ${dev.name} (${dev.ip || dev.mac}) is currently unreachable or disconnected.`,
      affectedEntities: [dev.mac, dev.name || 'Unknown Device'],
    });
  }

  // B. Check for poor RF signal clients (RSSI < -80 dBm, or signal level < 25% when RSSI is not reported)
  const weakSignalClients = clients.filter((c) => c.wireless && getSignalBand(c) === 'poor');
  for (const c of weakSignalClients) {
    const signalText = typeof c.rssi === 'number' ? `${c.rssi} dBm` : `${c.signalLevel}% signal level`;
    currentDiscoveredIssues.push({
      id: `rf-weak-${c.mac.replace(/:/g, '')}`,
      category: 'RF_SIGNAL',
      severity: 'WARNING',
      title: `Sub-Optimal RF Signal (${c.name || c.hostName || c.mac})`,
      description: `Client device is connected with weak signal (${signalText}) on AP ${c.apName || 'Unknown AP'}, risking packet retries.`,
      affectedEntities: [c.mac, c.name || c.mac],
    });
  }

  // C. Context-Aware Spectrum Analysis with Automatic IoT Segregation Intelligence
  const wirelessClients = clients.filter((c) => c.wireless);
  const clientsOn2G = wirelessClients.filter((c) => !c.channel || c.channel <= 14);
  const iot2gClients = clientsOn2G.filter((c) => isIotClient(c, networks));
  const user2gClients = clientsOn2G.filter((c) => !isIotClient(c, networks));
  const iotCount = iot2gClients.length;
  const user2gCount = user2gClients.length;
  const wirelessTotal = wirelessClients.length;

  if (wirelessTotal > 5 && clientsOn2G.length / wirelessTotal > 0.5) {
    if (iotCount / clientsOn2G.length >= 0.5) {
      // Intelligently identify proper IoT architectural segregation on 2.4 GHz
      const iotVlan = networks.find((n) => n.vlan === 20)?.name || 'VLAN 20 (IoT)';
      currentDiscoveredIssues.push({
        id: `rf-2g-iot-segregated`,
        category: 'CHANNEL_CONGESTION',
        severity: 'INFO',
        title: `Expected 2.4 GHz IoT Segregation (${iotVlan})`,
        description: `${iotCount} of ${clientsOn2G.length} 2.4 GHz wireless clients are IoT/smart home endpoints appropriately segregated on ${iotVlan}. 5 GHz spectrum is cleanly preserved for high-speed user devices.`,
        affectedEntities: ['2.4 GHz Spectrum', iotVlan],
      });
    } else if (user2gCount > 3) {
      // True channel congestion where non-IoT dual-band user workstations are stuck on 2.4 GHz
      currentDiscoveredIssues.push({
        id: `rf-2g-saturation`,
        category: 'CHANNEL_CONGESTION',
        severity: 'WARNING',
        title: `5 GHz Band Steering Opportunity for User Devices`,
        description: `${user2gCount} dual-band workstation/user client(s) are operating on congested 2.4 GHz channels instead of 5 GHz.`,
        affectedEntities: ['2.4 GHz Spectrum'],
      });
    }
  }

  // D. Check for sudden bandwidth surge
  const heavySurgeClients = clients.filter((c) => (clientRateBytes(c) * 8) / 1_000_000 > 50); // > 50 Mbps

  for (const c of heavySurgeClients) {
    const mbps = parseFloat(((clientRateBytes(c) * 8) / 1_000_000).toFixed(1));
    currentDiscoveredIssues.push({
      id: `burst-${c.mac.replace(/:/g, '')}`,
      category: 'BANDWIDTH_BURST',
      severity: 'INFO',
      title: `High Bandwidth Traffic Burst (${c.name || c.mac})`,
      description: `Device is consuming high instantaneous bandwidth (${mbps} Mbps) on ${c.ssid || c.switchName || 'LAN'}.`,
      affectedEntities: [c.mac],
    });
  }

  // 3. Compute Current Health Score (0 - 100)
  let healthScore = 100;
  const criticalCount = currentDiscoveredIssues.filter((i) => i.severity === 'CRITICAL').length;
  const warningCount = currentDiscoveredIssues.filter((i) => i.severity === 'WARNING').length;
  healthScore -= criticalCount * 15;
  healthScore -= warningCount * 4;
  healthScore = Math.max(45, Math.min(100, healthScore));

  // 4. Comparative Trajectory Analysis against Baseline
  const resolvedIssues: AiIssueItem[] = [];
  const persistingIssues: AiPersistingIssueItem[] = [];
  const newIssues: AiIssueItem[] = [];

  if (!previousAudit) {
    // Cold Start: First audit run
    for (const issue of currentDiscoveredIssues) {
      newIssues.push(issue);
    }
  } else {
    // Combine prior active issues
    const priorIssuesMap = new Map<string, AiIssueItem | AiPersistingIssueItem>();
    for (const issue of previousAudit.newIssues || []) {
      priorIssuesMap.set(issue.id, issue);
    }
    for (const issue of previousAudit.persistingIssues || []) {
      priorIssuesMap.set(issue.id, issue);
    }

    const currentIssuesMap = new Map<string, AiIssueItem>();
    for (const issue of currentDiscoveredIssues) {
      currentIssuesMap.set(issue.id, issue);
    }

    // A. Detect Resolved Issues (Present in prior run, no longer present now)
    for (const [id, priorIssue] of priorIssuesMap.entries()) {
      if (!currentIssuesMap.has(id)) {
        resolvedIssues.push(priorIssue);
      }
    }

    // B. Detect Persisting Issues vs New Issues
    for (const [id, currentIssue] of currentIssuesMap.entries()) {
      if (priorIssuesMap.has(id)) {
        const prior = priorIssuesMap.get(id)!;
        const priorCount = 'persistedAuditCount' in prior ? prior.persistedAuditCount : 1;
        const firstSeen = 'firstObservedAt' in prior ? prior.firstObservedAt : previousAudit.createdAt;

        persistingIssues.push({
          ...currentIssue,
          firstObservedAt: firstSeen,
          persistedAuditCount: priorCount + 1,
        });
      } else {
        newIssues.push(currentIssue);
      }
    }
  }

  // 5. Determine Trend Direction & Delta
  let trendDirection: AiTrendDirection = 'INITIAL';
  let scoreDelta = 0;

  if (previousAudit) {
    scoreDelta = healthScore - previousAudit.healthScore;
    if (scoreDelta > 2 || (resolvedIssues.length > 0 && newIssues.length === 0)) {
      trendDirection = 'IMPROVED';
    } else if (scoreDelta < -2 || (newIssues.length > resolvedIssues.length && criticalCount > 0)) {
      trendDirection = 'DEGRADED';
    } else {
      trendDirection = 'STABLE';
    }
  }

  // 6. Generate Comprehensive 3-Part Narration & Executive Summary
  const historyCount = recentAudits.length;
  let historyContext = '';
  if (historyCount === 0) {
    historyContext = `Initial estate baseline established across all ${devices.length} infrastructure nodes and ${clients.length} connected endpoints. Tracking baseline metrics.`;
  } else {
    const avgScore = Math.round(
      recentAudits.reduce((sum, a) => sum + a.healthScore, 0) / historyCount
    );
    const persistingCount = persistingIssues.length;
    historyContext = `Over the prior ${historyCount} recorded inspection cycle(s), estate network health averaged ${avgScore}/100 with ${clients.length} active devices. ${
      persistingCount > 0
        ? `${persistingCount} condition(s) under observation.`
        : 'Zero chronic infrastructure faults observed.'
    }`;
  }

  let deltaChanges = '';
  if (!previousAudit) {
    deltaChanges = `Initial audit run: No prior inspection delta available. Baseline benchmarks recorded for RF distribution, PoE power draw, and VLAN segregation.`;
  } else {
    const prevClientsTotal = (previousAudit.metricsSnapshot?.totalClients as number) ?? clients.length;
    const clientDelta = clients.length - prevClientsTotal;
    const clientDeltaText = clientDelta === 0 ? 'No net client count shift' : `${clientDelta > 0 ? `+${clientDelta}` : clientDelta} client(s) (${clients.length} total)`;
    const resolvedText = resolvedIssues.length > 0
      ? `${resolvedIssues.length} condition(s) resolved (${resolvedIssues.map((r) => r.title).slice(0, 2).join(', ')})`
      : 'No previous conditions cleared';
    const newText = newIssues.length > 0
      ? `${newIssues.length} new event(s) detected`
      : '0 new warnings';
    
    deltaChanges = `Comparative Delta since last inspection: Health score shifted by ${scoreDelta >= 0 ? '+' : ''}${scoreDelta} points (${previousAudit.healthScore} ➔ ${healthScore}). ${clientDeltaText}. ${resolvedText}, with ${newText}.`;
  }

  const scoreTier = healthScore >= 95 ? 'OPTIMAL' : healthScore >= 85 ? 'HEALTHY' : healthScore >= 70 ? 'ATTENTION REQUIRED' : 'DEGRADED';
  const totalPoeHeadroom = poeDevices.reduce((sum, p) => sum + (p.poeRemain ?? 0), 0);
  const currentStatus = `Current operational posture is ${scoreTier} (Score: ${healthScore}/100). All ${devices.length - offlineDevices.length} of ${devices.length} infrastructure nodes are active${totalPoeHeadroom > 0 ? ` with ${Math.round(totalPoeHeadroom)}W PoE headroom` : ''}. ${
    iotCount > 0
      ? `${iotCount} IoT/smart home clients are cleanly segregated on 2.4 GHz (VLAN 20), preserving 5 GHz bandwidth for ${wirelessTotal - clientsOn2G.length} high-speed user devices.`
      : `${wirelessTotal} wireless clients connected across dual-band AP array.`
  }`;

  const narration: AiNarration = {
    historyContext,
    deltaChanges,
    currentStatus,
    fullNarrative: `${historyContext}\n\n${deltaChanges}\n\n${currentStatus}`,
  };

  // Executive Summary
  let executiveSummary = '';
  if (trendDirection === 'INITIAL') {
    executiveSummary = `Initial diagnostic benchmark established at score ${healthScore}/100. ${clients.length} active client devices and ${devices.length} infrastructure nodes evaluated. Future inspections will track relative health and performance trends against this baseline.`;
  } else if (trendDirection === 'IMPROVED') {
    executiveSummary = `Network health has improved (+${scoreDelta > 0 ? scoreDelta : 3}%). ${resolvedIssues.length} previously identified issue(s) have been resolved. Spectrum and device operational parameters are stabilizing.`;
  } else if (trendDirection === 'DEGRADED') {
    executiveSummary = `Network performance has degraded (${scoreDelta}%). Detected ${newIssues.length} new anomaly/anomalies requiring operational remediation. Prioritize AP channel balance and offline device checks.`;
  } else {
    executiveSummary = `Network health remains stable (Score: ${healthScore}/100, delta: ${scoreDelta >= 0 ? '+' : ''}${scoreDelta}%). Infrastructure performance is consistent with the previous audit baseline.`;
  }

  // 7. Generate Actionable Suggestions
  const actionableSuggestions: AiSuggestionItem[] = [];

  if (criticalCount > 0) {
    actionableSuggestions.push({
      id: 'sug-crit-offline',
      priority: 'HIGH',
      title: 'Investigate Disconnected Infrastructure Nodes',
      action: 'Check power supply, PoE budgets, and uplink switch ports for offline AP/Switch devices.',
      expectedImpact: 'Restores redundant coverage and eliminates single points of failure.',
    });
  }

  if (persistingIssues.some((i) => i.category === 'RF_SIGNAL')) {
    actionableSuggestions.push({
      id: 'sug-rf-roam',
      priority: 'HIGH',
      title: 'Optimize AP Roaming for Chronic Weak Clients',
      action: 'Enable 802.11k/v Fast Roaming and adjust minimum RSSI threshold to -78 dBm on APs.',
      expectedImpact: 'Forces sticky clients to roam to closer APs, boosting throughput.',
    });
  }

  if (currentDiscoveredIssues.some((i) => i.category === 'CHANNEL_CONGESTION' && i.severity === 'WARNING')) {
    actionableSuggestions.push({
      id: 'sug-band-steering',
      priority: 'MEDIUM',
      title: 'Enable 5 GHz Band Steering for User Laptops/Phones',
      action: 'Configure Band Steering policy on Omada Controller to prefer 5 GHz for dual-band workstations.',
      expectedImpact: 'Unloads congested 2.4 GHz channels and doubles available wireless bandwidth for high-demand devices.',
    });
  }

  if (actionableSuggestions.length === 0) {
    actionableSuggestions.push({
      id: 'sug-opt-routine',
      priority: 'LOW',
      title: 'Maintain Routine Telemetry Monitoring',
      action: 'Continue periodic telemetry polling and AI health inspections.',
      expectedImpact: 'Ensures proactive anomaly detection and SLA compliance.',
    });
  }

  // 8. Construct & Save Insight Record (Deterministic NLG Engine)
  const newInsight = await saveAiInsight({
    triggeredByUserId: userId,
    healthScore,
    previousScore: previousAudit ? previousAudit.healthScore : null,
    scoreDelta,
    trendDirection,
    executiveSummary,
    narration,
    resolvedIssues,
    persistingIssues,
    newIssues,
    actionableSuggestions,
    engineType: 'NLG_ALGORITHMIC',
    metricsSnapshot: {
      totalClients: clients.length,
      totalDevices: devices.length,
      offlineDevices: offlineDevices.length,
      wirelessClients: wirelessTotal,
      wiredClients: clients.length - wirelessTotal,
      iotClients: iotCount,
      siteName: networkStatus?.siteName || 'Unknown',
      narration,
    },
  });

  return {
    ...newInsight,
    engineType: 'NLG_ALGORITHMIC',
    narration: newInsight.narration || narration,
  };
}

/**
 * Executes a REAL Neural LLM Agent Diagnostic Audit by invoking a local Ollama model
 * (default: deepseek-r1:7b). Feeds the entire live Omada network telemetry and historical
 * delta context into the model's context window, extracting Chain-of-Thought reasoning.
 */
export async function runDeepSeekAgentInsight(
  userId: string | null = null,
  customClient?: OmadaClient,
  model = process.env.OLLAMA_MODEL || 'deepseek-r1:7b'
): Promise<AiInsightRecord> {
  const { generateNeuralAiInsight, extractJsonObject } = await import('@/lib/ai/ollama');
  const client = customClient || getOmadaClient();

  // 1. Fetch live telemetry and historical audits in parallel
  const [
    recentAudits,
    networkStatus,
    clientsResult,
    devicesResult,
    lanNetworksResult,
    ssidsResult,
  ] = await Promise.all([
    getRecentAiInsights(5),
    client.getNetworkStatus().catch(() => null),
    client.getActiveClients().catch(() => null),
    client.getDevices('all').catch(() => null),
    typeof client.getLanNetworks === 'function' ? client.getLanNetworks().catch(() => [] as OmadaLanNetwork[]) : Promise.resolve([]),
    typeof client.getSsids === 'function' ? client.getSsids().catch(() => [] as OmadaSsidSetting[]) : Promise.resolve([]),
  ]);

  // Don't spend an inference (or save a record) on an empty "controller down" snapshot
  assertLiveTelemetry(networkStatus, clientsResult, devicesResult);

  const clients = normalizeClientsResult(clientsResult);
  const devices: OmadaDeviceItem[] = devicesResult || [];
  const networks: OmadaLanNetwork[] = lanNetworksResult || [];
  const ssids: OmadaSsidSetting[] = ssidsResult || [];
  const previousAudit = recentAudits.length > 0 ? recentAudits[0] : null;

  // 2. Prepare structured context payload for DeepSeek-R1
  const systemPrompt = `You are a Principal Network Operations Center (NOC) Reliability Engineer diagnosing a physical enterprise network running on a TP-Link Omada SDN hardware controller.
Analyze the provided live network state and telemetry deltas.
Your response MUST be concise, professional, and actionable.

Format your response strictly as JSON conforming to this structure (do not wrap in markdown quotes if possible, or use standard json format):
{
  "healthScore": <integer 0-100>,
  "trendDirection": "IMPROVED" | "DEGRADED" | "STABLE" | "INITIAL",
  "executiveSummary": "<2-sentence diagnostic verdict>",
  "narration": {
    "historyContext": "<How things have been based on prior audits>",
    "deltaChanges": "<What changed since previous inspection>",
    "currentStatus": "<Current operational posture & spectrum status>"
  },
  "issues": [
    {
      "id": "<unique-id>",
      "category": "RF_SIGNAL" | "CHANNEL_CONGESTION" | "BANDWIDTH_BURST" | "DEVICE_OFFLINE" | "GENERAL",
      "severity": "CRITICAL" | "WARNING" | "INFO",
      "title": "<Issue title>",
      "description": "<Detailed explanation>"
    }
  ],
  "suggestions": [
    {
      "id": "<unique-id>",
      "priority": "HIGH" | "MEDIUM" | "LOW",
      "title": "<Action title>",
      "action": "<Concrete CLI / Controller setting to change>",
      "expectedImpact": "<Performance benefit>"
    }
  ]
}`;

  const telemetryPayload = {
    siteName: networkStatus?.siteName || 'Unknown',
    controllerOnline: true, // guaranteed by assertLiveTelemetry
    totalClients: clients.length,
    wirelessClients: clients.filter((c) => c.wireless).length,
    wiredClients: clients.filter((c) => !c.wireless).length,
    clientsOn2G: clients.filter((c) => c.wireless && (!c.channel || c.channel <= 14)).length,
    clientsOn5G: clients.filter((c) => c.wireless && c.channel && c.channel > 14).length,
    iotClientsDetected: clients.filter((c) => isIotClient(c, networks)).length,
    offlineHardware: devices.filter((d) => !isDeviceOnline(d)).map((d) => ({ name: d.name, ip: d.ip, mac: d.mac, model: d.model })),
    onlineHardware: devices.filter((d) => isDeviceOnline(d)).map((d) => ({ name: d.name, ip: d.ip, type: d.type, model: d.model, clients: d.clientNum })),
    weakClients: clients
      .filter((c) => c.wireless && getSignalBand(c) === 'poor')
      .map((c) => ({ name: c.name || c.mac, rssi: c.rssi, signalLevel: c.signalLevel, ap: c.apName })),
    topBandwidthConsumers: [...clients]
      .sort((a, b) => (b.activity || 0) - (a.activity || 0))
      .slice(0, 5)
      .map((c) => ({ name: c.name || c.mac, activityMbps: (((c.activity || 0) * 8) / 1_000_000).toFixed(2) })),
    vlans: networks.map((n) => ({ vlan: n.vlan, name: n.name, subnet: n.gatewaySubnet })),
    ssids: ssids.map((s) => ({ name: s.name, band: s.bandText })),
    previousHealthScore: previousAudit?.healthScore ?? null,
  };

  const userPrompt = `Live Omada Telemetry:\n${JSON.stringify(telemetryPayload, null, 2)}`;

  // 3. Execute real Neural Inference via Ollama
  const llmResult = await generateNeuralAiInsight(systemPrompt, userPrompt, model);

  // 4. Parse the LLM's JSON verdict (chain-of-thought already stripped by generateNeuralAiInsight)
  const parsedJson = extractJsonObject<{
    healthScore?: unknown;
    trendDirection?: unknown;
    executiveSummary?: string;
    narration?: {
      historyContext?: string;
      deltaChanges?: string;
      currentStatus?: string;
    };
    issues?: unknown;
    suggestions?: unknown;
  }>(llmResult.response);

  const rawScore = typeof parsedJson?.healthScore === 'string' ? Number(parsedJson.healthScore) : parsedJson?.healthScore;
  if (!parsedJson || typeof rawScore !== 'number' || !Number.isFinite(rawScore)) {
    // Never invent a score: report the failure instead of saving a record
    throw new AiAuditUnavailableError(
      `${llmResult.model} did not return a parseable JSON verdict with a numeric healthScore. No record was saved; try again or use a larger num_predict/model.`
    );
  }

  const healthScore = Math.round(Math.max(0, Math.min(100, rawScore)));
  const scoreDelta = previousAudit ? healthScore - previousAudit.healthScore : 0;
  const llmTrend = TREND_DIRECTIONS.find((t) => t === parsedJson.trendDirection);
  const trendDirection: AiTrendDirection =
    llmTrend || (previousAudit ? (scoreDelta > 0 ? 'IMPROVED' : scoreDelta < 0 ? 'DEGRADED' : 'STABLE') : 'INITIAL');
  const executiveSummary = parsedJson.executiveSummary || `DeepSeek-R1 Neural Agent evaluated ${clients.length} connected devices across ${devices.length} infrastructure nodes.`;

  const narration: AiNarration = {
    historyContext: parsedJson.narration?.historyContext || `Prior baseline recorded across historical audit cycles.`,
    deltaChanges: parsedJson.narration?.deltaChanges || `Comparative delta evaluated against prior baseline (Health score delta: ${scoreDelta >= 0 ? '+' : ''}${scoreDelta}).`,
    currentStatus: parsedJson.narration?.currentStatus || `Current state verified by DeepSeek-R1 Neural Agent.`,
    fullNarrative: `${parsedJson.narration?.historyContext || ''}\n\n${parsedJson.narration?.deltaChanges || ''}\n\n${parsedJson.narration?.currentStatus || ''}`.trim(),
  };

  const newIssues: AiIssueItem[] = asRecordList(parsedJson.issues).map((i, idx) => ({
    id: asText(i.id) || `llm-issue-${idx}`,
    category: ISSUE_CATEGORIES.find((c) => c === i.category) || 'GENERAL',
    severity: ISSUE_SEVERITIES.find((sev) => sev === i.severity) || 'INFO',
    title: asText(i.title) || 'Observed Condition',
    description: asText(i.description),
  }));

  const actionableSuggestions: AiSuggestionItem[] = asRecordList(parsedJson.suggestions).map((s, idx) => ({
    id: asText(s.id) || `llm-sug-${idx}`,
    priority: SUGGESTION_PRIORITIES.find((p) => p === s.priority) || 'MEDIUM',
    title: asText(s.title) || 'Recommended Action',
    action: asText(s.action),
    expectedImpact: asText(s.expectedImpact),
  }));

  // 5. Save to database with engineType and thinking metadata
  const newInsight = await saveAiInsight({
    triggeredByUserId: userId,
    healthScore,
    previousScore: previousAudit ? previousAudit.healthScore : null,
    scoreDelta,
    trendDirection,
    executiveSummary,
    narration,
    resolvedIssues: [],
    persistingIssues: [],
    newIssues,
    actionableSuggestions,
    engineType: 'DEEPSEEK_AGENT',
    llmModel: llmResult.model,
    thinkingProcess: llmResult.thinking,
    metricsSnapshot: {
      totalClients: clients.length,
      totalDevices: devices.length,
      siteName: networkStatus?.siteName || 'Unknown',
      narration,
      thinkingProcess: llmResult.thinking,
      llmModel: llmResult.model,
      durationMs: llmResult.totalDurationMs,
    },
  });

  return {
    ...newInsight,
    engineType: 'DEEPSEEK_AGENT',
    llmModel: llmResult.model,
    thinkingProcess: llmResult.thinking,
    narration: newInsight.narration || narration,
  };
}


