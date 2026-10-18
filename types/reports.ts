export interface TopActiveDevice {
  name: string;
  mac: string;
  ip: string;
  medium: 'Wired' | 'Wireless';
  currentRateMbps: number;
  downloadRateMbps: number;
  uploadRateMbps: number;
  ssidOrPort: string;
  apOrSwitchName: string;
}

export interface TopVolumeDevice {
  name: string;
  mac: string;
  ip: string;
  medium: 'Wired' | 'Wireless';
  totalTrafficMb: number;
  downloadTrafficMb: number;
  uploadTrafficMb: number;
  uptimeSeconds: number;
}

export interface TopActiveUser {
  id: string;
  username: string;
  email: string;
  fullName: string;
  role: 'ADMIN' | 'USER';
  taggedDevicesCount: number;
  lastActiveDate: string;
}

export interface RfDistribution {
  excellent: number; // > -60 dBm
  good: number;      // -60 to -70 dBm
  fair: number;      // -70 to -80 dBm
  poor: number;      // < -80 dBm
  totalWireless: number;
}

export interface ReportSummaryData {
  generatedAt: string;
  siteName: string;
  controllerUptime: string;
  networkHealthScore: number;
  infrastructure: {
    totalAps: number;
    totalSwitches: number;
    totalGateways: number;
    totalClients: number;
    wirelessClients: number;
    wiredClients: number;
    freq2gClients: number;
    freq5gClients: number;
    aggregateThroughputMbps: number;
    totalSessionTrafficGb: number;
  };
  topActiveDevices: TopActiveDevice[];
  topVolumeDevices: TopVolumeDevice[];
  topActiveUsers: TopActiveUser[]; // always [] for non-ADMIN viewers
  rfDistribution: RfDistribution;
  // Omitted for non-ADMIN viewers (operator/login audit data is admin-only)
  securitySummary?: {
    authSuccessRate24h: number;
    totalLogins24h: number;
    failedLogins24h: number;
    activeUsersCount: number;
  };
  narration?: AiNarration;
}

export type AiTrendDirection = 'IMPROVED' | 'DEGRADED' | 'STABLE' | 'INITIAL';
export type AiIssueSeverity = 'CRITICAL' | 'WARNING' | 'INFO';
export type AiIssueCategory =
  | 'RF_SIGNAL'
  | 'CHANNEL_CONGESTION'
  | 'BANDWIDTH_BURST'
  | 'DEVICE_OFFLINE'
  | 'AUTHENTICATION'
  | 'GENERAL';

export interface AiIssueItem {
  id: string;
  category: AiIssueCategory;
  severity: AiIssueSeverity;
  title: string;
  description: string;
  affectedEntities?: string[];
  feedbackState?: 'HELPFUL' | 'EXPECTED_IOT' | 'SUPPRESSED';
}

export interface AiPersistingIssueItem extends AiIssueItem {
  firstObservedAt: string;
  persistedAuditCount: number;
}

export interface AiSuggestionItem {
  id: string;
  priority: 'HIGH' | 'MEDIUM' | 'LOW';
  title: string;
  action: string;
  expectedImpact: string;
}

export interface AiNarration {
  historyContext: string;
  deltaChanges: string;
  currentStatus: string;
  fullNarrative: string;
}

export interface AiInsightRecord {
  id: string;
  createdAt: string;
  triggeredByUserId: string | null;
  healthScore: number;
  previousScore: number | null;
  scoreDelta: number;
  trendDirection: AiTrendDirection;
  executiveSummary: string;
  narration?: AiNarration;
  resolvedIssues: AiIssueItem[];
  persistingIssues: AiPersistingIssueItem[];
  newIssues: AiIssueItem[];
  actionableSuggestions: AiSuggestionItem[];
  metricsSnapshot: Record<string, unknown>;
  userFeedback?: Record<string, 'HELPFUL' | 'EXPECTED_IOT' | 'SUPPRESSED'>;
  engineType?: 'NLG_ALGORITHMIC' | 'DEEPSEEK_AGENT';
  llmModel?: string;
  thinkingProcess?: string;
}
