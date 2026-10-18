import {
  OmadaApiResponse,
  OmadaInfoResult,
  OmadaLoginResult,
  OmadaSiteItem,
  OmadaClientDevice,
  OmadaDeviceItem,
  WirelessHealthSummary,
  NetworkAuditReport,
  NetworkStatusSummary,
  OmadaTopologyNode,
  OmadaLanNetwork,
  OmadaSsidSetting,
  PoeDeviceBudget,
  WanPortInfo,
  WanStatusInfo,
  NocEventItem,
} from '@/types/omada';
import { isDeviceOnline } from '@/lib/omada/formatters';
import fs from 'fs';
import path from 'path';

// Automatically load .env.local in environments where Next.js or dotenv hasn't already loaded it (e.g. standalone scripts, CLI)
if (typeof process !== 'undefined') {
  if (!process.env.OMADA_URL) {
    try {
      const envPath = path.resolve(process.cwd(), '.env.local');
      if (fs.existsSync(envPath) && typeof process.loadEnvFile === 'function') {
        process.loadEnvFile(envPath);
      }
    } catch {
      // Ignore error if loading env file fails
    }
  }
}

/** Upper bound on pages read from paginated endpoints (guards against runaway loops) */
const MAX_PAGES = 20;

/** Omada error codes meaning the session/token is no longer valid */
const SESSION_EXPIRED_CODES = [-30000, -30001, -39000, -1000];
// After the controller rejects credentials, stop retrying for a while: dashboard polling would
// otherwise keep failing logins and trip (or extend) the controller's brute-force lockout
export const LOGIN_FAILURE_BACKOFF_MS = 5 * 60 * 1000;

/**
 * Whether an Omada API errorCode means "login required" / session expired
 * (the classic session codes plus the -1200..-1299 login-required range).
 */
export function isLoginRequiredErrorCode(code: number | undefined): boolean {
  if (typeof code !== 'number') return false;
  return SESSION_EXPIRED_CODES.includes(code) || (code <= -1200 && code >= -1299);
}

/** The controller answered with a non-2xx HTTP status */
export class OmadaHttpError extends Error {
  readonly status: number;

  constructor(status: number, message: string) {
    super(message);
    this.name = 'OmadaHttpError';
    this.status = status;
  }
}

/** The controller could not be reached at all (DNS failure, connection refused, timeout) */
export class OmadaNetworkError extends Error {
  readonly timedOut: boolean;

  constructor(message: string, timedOut: boolean) {
    super(message);
    this.name = 'OmadaNetworkError';
    this.timedOut = timedOut;
  }
}

function getControllerTimeoutMs(): number {
  const ms = Number(process.env.OMADA_TIMEOUT_MS);
  return Number.isFinite(ms) && ms > 0 ? ms : 8000;
}

/** HTTP statuses that mean "this endpoint is not available here" (worth trying an alternative endpoint) */
function isEndpointUnsupported(err: unknown): boolean {
  return err instanceof OmadaHttpError && [400, 404, 405, 501].includes(err.status);
}

const SSID_BAND_LABELS: Record<number, string> = {
  1: '2.4 GHz Only',
  2: '5 GHz Only',
  3: 'Dual-Band (2.4G + 5G)',
  4: '6 GHz Only',
  5: 'Dual-Band (2.4G + 6G)',
  6: 'Dual-Band (5G + 6G)',
  7: 'Tri-Band (2.4G + 5G + 6G)',
};

const WAN_PROTO_LABELS: Record<string, WanPortInfo['proto']> = {
  dhcp: 'DHCP',
  static: 'Static',
  pppoe: 'PPPoE',
};

/** WAN port entry from the gateway detail `portStats` list (fields read defensively) */
interface RawGatewayPort {
  port?: number;
  name?: string;
  type?: number; // 0 = WAN
  mode?: number; // 0 = WAN (WAN/LAN combo ports)
  status?: number; // 1 = link up
  internetState?: number; // 1 = internet reachable
  ip?: string;
  gateway?: string;
  dns1?: string;
  dns2?: string;
  proto?: string;
  latency?: number;
  loss?: number;
  uptime?: number;
}

type ApiAttempt<T> =
  | { kind: 'data'; data: OmadaApiResponse<T>; loginRequired: boolean }
  | { kind: 'challenge'; status: number };

export interface OmadaConfig {
  baseUrl?: string;
  username?: string;
  password?: string;
  siteNameOrId?: string;
  allowInsecureSsl?: boolean;
}

export class OmadaClient {
  private baseUrl: string;
  private username: string;
  private password: string;
  private siteNameOrId: string;
  private allowInsecureSsl: boolean;

  private omadacId: string | null = null;
  private token: string | null = null;
  private cookie: string | null = null;
  private resolvedSiteId: string | null = null;
  private resolvedSiteName: string = 'Default';
  private loginPromise: Promise<void> | null = null;
  private loginBlockedUntil = 0;
  private lastLoginError: Error | null = null;

  constructor(config?: OmadaConfig) {
    let rawUrl = config?.baseUrl || process.env.OMADA_URL || 'https://192.168.100.2';
    if (!/^https?:\/\//i.test(rawUrl)) {
      rawUrl = `https://${rawUrl}`;
    }
    this.baseUrl = rawUrl.replace(/\/+$/, '');

    // No default credentials: guessing (e.g. admin/password) burns attempts and locks the controller
    this.username = config?.username || process.env.OMADA_USER || '';
    this.password = config?.password || process.env.OMADA_PASS || '';
    this.siteNameOrId = config?.siteNameOrId || process.env.OMADA_SITE || 'Default';
    // TLS verification stays on unless explicitly opted out
    this.allowInsecureSsl = config?.allowInsecureSsl ?? process.env.OMADA_ALLOW_INSECURE_SSL === 'true';

    if (this.allowInsecureSsl && typeof process !== 'undefined') {
      // Opt-in only: accepts the self-signed certificate of a hardware controller (process-wide)
      process.env.NODE_TLS_REJECT_UNAUTHORIZED = '0';
    }
  }

  private getHeaders(customHeaders?: Record<string, string>): HeadersInit {
    const headers: Record<string, string> = {
      'Content-Type': 'application/json',
      'Accept': 'application/json',
      ...customHeaders,
    };

    if (this.token) {
      headers['Csrf-Token'] = this.token;
    }
    if (this.cookie) {
      headers['Cookie'] = this.cookie;
    }

    return headers;
  }

  /**
   * fetch() against the controller with a bounded timeout (OMADA_TIMEOUT_MS, default 8s).
   * Transport failures are rethrown as OmadaNetworkError so callers can tell them apart from HTTP errors.
   */
  private async controllerFetch(url: string, init: RequestInit = {}): Promise<Response> {
    const timeoutMs = getControllerTimeoutMs();
    try {
      return await fetch(url, {
        ...init,
        cache: 'no-store',
        signal: AbortSignal.timeout(timeoutMs),
      });
    } catch (err: unknown) {
      const name = (err as { name?: string } | null)?.name;
      if (name === 'TimeoutError' || name === 'AbortError') {
        throw new OmadaNetworkError(`Omada controller did not respond within ${timeoutMs}ms (${url})`, true);
      }
      throw new OmadaNetworkError(err instanceof Error ? err.message : 'Unknown connection error', false);
    }
  }

  /**
   * Helper to safely parse JSON responses from the Omada controller,
   * avoiding cryptic "Unexpected token '<'" SyntaxErrors if the server returns HTML.
   */
  private async safeParseJson<T>(res: Response, endpointDesc: string): Promise<T> {
    if (typeof res.text === 'function') {
      const rawText = await res.text();
      const trimmed = rawText.trim();

      if (trimmed.startsWith('<') || res.headers?.get?.('content-type')?.includes('text/html')) {
        const titleMatch = trimmed.match(/<title>([^<]+)<\/title>/i);
        const title = titleMatch ? ` ("${titleMatch[1].trim()}")` : '';
        throw new Error(
          `Controller at ${this.baseUrl} returned HTML${title} instead of JSON API response at ${endpointDesc}. Check host URL and port.`
        );
      }

      try {
        return JSON.parse(rawText) as T;
      } catch (err: unknown) {
        const msg = err instanceof Error ? err.message : String(err);
        throw new Error(`Invalid JSON received from Omada Controller at ${endpointDesc}: ${msg}`);
      }
    }

    if (typeof res.json === 'function') {
      return (await res.json()) as T;
    }

    throw new Error(`Response at ${endpointDesc} cannot be parsed as JSON`);
  }

  private async fetchControllerInfo(baseUrl: string): Promise<OmadaApiResponse<OmadaInfoResult>> {
    const infoUrl = `${baseUrl}/api/info`;
    const res = await this.controllerFetch(infoUrl, { method: 'GET', headers: this.getHeaders() });
    if (!res?.ok) {
      throw new Error(`Failed to reach Omada Controller info endpoint at ${infoUrl} (${res?.status} ${res?.statusText})`);
    }
    return this.safeParseJson<OmadaApiResponse<OmadaInfoResult>>(res, infoUrl);
  }

  /**
   * Performs the Omada v5 authentication handshake:
   * 1. GET /api/info -> discovers omadacId (with automatic port detection fallback if port omitted)
   * 2. POST /{omadacId}/api/v2/login -> retrieves CSRF token & session cookie
   *
   * Single-flight: concurrent callers (forced or not) share one in-flight login.
   */
  async login(force = false): Promise<void> {
    if (this.loginPromise) {
      return this.loginPromise;
    }
    if (!this.username || !this.password) {
      throw new Error('Omada credentials are not configured: set OMADA_USER and OMADA_PASS');
    }
    if (this.lastLoginError && Date.now() < this.loginBlockedUntil) {
      throw this.lastLoginError;
    }
    if (!force && this.token && this.cookie && this.omadacId) {
      return;
    }

    if (force) {
      this.token = null;
      this.cookie = null;
    }

    const promise: Promise<void> = this.performLogin().finally(() => {
      // Only clear our own promise, never a newer login's
      if (this.loginPromise === promise) {
        this.loginPromise = null;
      }
    });
    this.loginPromise = promise;
    return promise;
  }

  private async performLogin(): Promise<void> {
    // Step 1: Discover Controller ID
    let successfulBaseUrl = this.baseUrl;
    let infoData: OmadaApiResponse<OmadaInfoResult> | null = null;

    try {
      infoData = await this.fetchControllerInfo(this.baseUrl);
    } catch (initialErr: unknown) {
      const hasExplicitPort = /:\d+$/.test(this.baseUrl);
      // A timeout means the host itself is unreachable: probing other ports would only multiply the wait
      const hostUnreachable = initialErr instanceof OmadaNetworkError && initialErr.timedOut;
      if (!hasExplicitPort && !hostUnreachable) {
        // Try common alternative controller ports (:8043, :443)
        for (const port of ['8043', '443']) {
          const candidateUrl = `${this.baseUrl}:${port}`;
          try {
            const fbData = await this.fetchControllerInfo(candidateUrl);
            if (fbData.errorCode === 0 && fbData.result?.omadacId) {
              successfulBaseUrl = candidateUrl;
              infoData = fbData;
              break;
            }
          } catch (fbErr: unknown) {
            if (fbErr instanceof OmadaNetworkError && fbErr.timedOut) break;
            // Continue to next fallback
          }
        }
      }

      if (!infoData) {
        throw initialErr;
      }
    }

    if (infoData.errorCode !== 0 || !infoData.result?.omadacId) {
      throw new Error(`Omada Info Error: ${infoData.msg || 'Missing omadacId in response'}`);
    }

    this.baseUrl = successfulBaseUrl;
    this.omadacId = infoData.result.omadacId;

    // Step 2: Login to obtain token and session cookie
    const loginUrl = `${this.baseUrl}/${this.omadacId}/api/v2/login`;
    const loginRes = await this.controllerFetch(loginUrl, {
      method: 'POST',
      headers: this.getHeaders(),
      body: JSON.stringify({
        username: this.username,
        password: this.password,
      }),
    });

    if (!loginRes.ok) {
      throw new Error(`Omada Login HTTP error: ${loginRes.status} ${loginRes.statusText}`);
    }

    const loginData = await this.safeParseJson<OmadaApiResponse<OmadaLoginResult>>(loginRes, loginUrl);

    if (loginData.errorCode !== 0 || !loginData.result?.token) {
      this.lastLoginError = new Error(`Omada Login Failed: ${loginData.msg || `Error code ${loginData.errorCode}`}`);
      this.loginBlockedUntil = Date.now() + LOGIN_FAILURE_BACKOFF_MS;
      throw this.lastLoginError;
    }

    this.token = loginData.result.token;
    this.lastLoginError = null;

    // Extract session cookie (e.g. TPOMADA_SESSIONID or TPEAP_SESSIONID)
    const setCookieHeader = loginRes.headers.get('set-cookie');
    if (setCookieHeader) {
      this.cookie = setCookieHeader.split(';')[0];
    }

    // Reset resolved site so it re-verifies against the new session
    this.resolvedSiteId = null;
  }

  /**
   * Re-authenticates after an auth challenge without stampeding the controller:
   * joins an in-flight login, and skips it entirely when another request already
   * replaced the token that the failing request was sent with.
   */
  private async reloginIfStale(tokenUsed: string | null): Promise<void> {
    if (this.loginPromise) {
      return this.loginPromise;
    }
    if (this.token !== tokenUsed) {
      return this.login();
    }
    return this.login(true);
  }

  private async sendApiRequest<T>(endpoint: string, options: RequestInit): Promise<ApiAttempt<T>> {
    const url = `${this.baseUrl}/${this.omadacId}${endpoint.startsWith('/') ? endpoint : `/${endpoint}`}`;
    const res = await this.controllerFetch(url, {
      ...options,
      headers: this.getHeaders(options.headers as Record<string, string>),
    });

    // HTTP 401 / 403 / 302, or a redirect to the login page
    const isAuthChallenge =
      res.status === 401 ||
      res.status === 403 ||
      res.status === 302 ||
      Boolean(res.redirected) ||
      Boolean(res.url && res.url.includes('/login'));
    if (isAuthChallenge) {
      return { kind: 'challenge', status: res.status };
    }

    // 404 / 5xx are real failures: no re-login
    if (!res.ok) {
      throw new OmadaHttpError(res.status, `Omada API request failed: ${res.status} ${res.statusText} at ${endpoint}`);
    }

    const data = await this.safeParseJson<OmadaApiResponse<T>>(res, url);
    return { kind: 'data', data, loginRequired: isLoginRequiredErrorCode(data.errorCode) };
  }

  /**
   * Authenticated fetch with automatic session recovery: re-logs in once on
   * HTTP 401/403/302 (login redirect) or a login-required errorCode, then retries.
   */
  private async authenticatedFetch<T>(endpoint: string, options: RequestInit = {}): Promise<OmadaApiResponse<T>> {
    await this.login();

    const tokenUsed = this.token;
    const first = await this.sendApiRequest<T>(endpoint, options);
    if (first.kind === 'data' && !first.loginRequired) {
      return first.data;
    }

    await this.reloginIfStale(tokenUsed);

    const retry = await this.sendApiRequest<T>(endpoint, options);
    if (retry.kind === 'data') {
      // May still carry a login-required errorCode; callers report it like any other API error
      return retry.data;
    }
    throw new OmadaHttpError(
      retry.status,
      `Omada controller rejected the session after re-login (HTTP ${retry.status}) at ${endpoint}`
    );
  }

  /**
   * Reads every page of a paginated endpoint (until totalRows is reached, capped at MAX_PAGES).
   * Endpoints that return a plain array are treated as unpaginated. A non-zero errorCode is
   * returned as-is so callers can surface it.
   */
  private async fetchAllPages<T>(
    endpointForPage: (page: number) => string,
    pageSize: number
  ): Promise<OmadaApiResponse<T[]>> {
    const items: T[] = [];

    for (let page = 1; page <= MAX_PAGES; page++) {
      const res = await this.authenticatedFetch<T[] | { data?: T[]; totalRows?: number }>(endpointForPage(page));
      if (res.errorCode !== 0) {
        return { errorCode: res.errorCode, msg: res.msg, result: items };
      }

      if (Array.isArray(res.result)) {
        items.push(...res.result);
        return { errorCode: 0, msg: res.msg, result: items };
      }

      const data = Array.isArray(res.result?.data) ? res.result.data : [];
      items.push(...data);

      const totalRows = res.result?.totalRows;
      const done =
        data.length === 0 || (typeof totalRows === 'number' ? items.length >= totalRows : data.length < pageSize);
      if (done) {
        return { errorCode: 0, msg: res.msg, result: items };
      }
    }

    console.warn(`[Omada] Stopped paging after ${MAX_PAGES} pages (${items.length} rows) at ${endpointForPage(1)}`);
    return { errorCode: 0, msg: 'Success', result: items };
  }

  /**
   * Query all accessible sites on the controller
   */
  async getSites(): Promise<OmadaSiteItem[]> {
    type RawSite = { id?: string; siteId?: string; name: string; siteKey?: string };
    const toSiteItem = (s: RawSite): OmadaSiteItem => ({
      siteId: s.id || s.siteId || '',
      name: s.name,
      siteKey: s.siteKey,
    });

    try {
      const response = await this.fetchAllPages<RawSite>(
        (page) => `/api/v2/sites?currentPage=${page}&currentPageSize=100`,
        100
      );
      if (response.errorCode === 0 && response.result.length > 0) {
        return response.result.map(toSiteItem);
      }
    } catch (err: unknown) {
      // Unreachable controller: no point trying another endpoint
      if (err instanceof OmadaNetworkError) throw err;
    }

    // /sites restricted (site-scoped account), failed, or empty: fall back to the current user's sites
    try {
      const userRes = await this.authenticatedFetch<{
        privilege?: { sites?: RawSite[] };
        sites?: RawSite[];
      }>('/api/v2/users/current');
      const userSites = userRes.result?.privilege?.sites ?? userRes.result?.sites;
      if (userRes.errorCode === 0 && Array.isArray(userSites)) {
        return userSites.map(toSiteItem);
      }
    } catch (err: unknown) {
      if (err instanceof OmadaNetworkError) throw err;
    }
    return [];
  }

  /**
   * Resolves the configured site name/ID to the internal Omada siteId
   */
  async getResolvedSiteId(): Promise<string> {
    if (this.resolvedSiteId) {
      return this.resolvedSiteId;
    }

    const sites = (await this.getSites()).filter((s) => s.siteId);
    if (sites.length > 0) {
      const wanted = this.siteNameOrId.toLowerCase();
      // Find matching site by ID or name
      const matched = sites.find(
        (s) =>
          s.siteId === this.siteNameOrId ||
          s.name?.toLowerCase() === wanted ||
          s.siteKey?.toLowerCase() === wanted
      );

      // If no exact match, fall back to the first available site (and say so)
      const site = matched ?? sites[0];
      if (!matched) {
        console.warn(
          `[Omada] Site "${this.siteNameOrId}" not found on controller; using "${site.name}". Available sites: ${sites
            .map((s) => s.name)
            .join(', ')}`
        );
      }

      this.resolvedSiteId = site.siteId;
      this.resolvedSiteName = site.name;
      return this.resolvedSiteId;
    }

    // No site list available: use the configured value for this call only (never cache e.g. the literal 'Default')
    return this.siteNameOrId;
  }

  /**
   * Fetches active connected clients from Omada controller (all pages)
   */
  async getActiveClients(): Promise<OmadaClientDevice[]> {
    const siteId = await this.getResolvedSiteId();
    const base = `/api/v2/sites/${encodeURIComponent(siteId)}/clients`;
    const pageSize = 1000;

    type RawClient = OmadaClientDevice & { active?: boolean };
    let res: OmadaApiResponse<RawClient[]>;
    try {
      res = await this.fetchAllPages<RawClient>(
        (page) => `${base}?currentPage=${page}&currentPageSize=${pageSize}&filters.active=true`,
        pageSize
      );
    } catch (err: unknown) {
      // Only an endpoint-level "not found / unsupported" justifies the unfiltered list; network errors propagate
      if (!isEndpointUnsupported(err)) throw err;
      res = await this.fetchAllPages<RawClient>(
        (page) => `${base}?currentPage=${page}&currentPageSize=${pageSize}`,
        pageSize
      );
    }

    if (res.errorCode !== 0) {
      throw new Error(`Failed to retrieve clients: ${res.msg || 'General error'} (code ${res.errorCode})`);
    }

    // Never report known-but-offline clients as connected
    return res.result.filter((c) => c.active !== false);
  }

  /**
   * Fetches physical hardware devices (Access Points, Switches, Gateway)
   */
  async getDevices(typeFilter: 'all' | 'ap' | 'switch' | 'gateway' = 'all'): Promise<OmadaDeviceItem[]> {
    const siteId = await this.getResolvedSiteId();
    const res = await this.fetchAllPages<OmadaDeviceItem>(
      (page) => `/api/v2/sites/${encodeURIComponent(siteId)}/devices?currentPage=${page}&currentPageSize=100`,
      100
    );
    if (res.errorCode !== 0) {
      throw new Error(`Failed to retrieve devices: ${res.msg} (code ${res.errorCode})`);
    }

    const list = res.result;
    if (typeFilter !== 'all') {
      return list.filter((d) => d.type?.toLowerCase() === typeFilter.toLowerCase());
    }

    return list;
  }

  /**
   * Fetches hierarchical physical network topology
   */
  async getTopology(): Promise<OmadaTopologyNode[]> {
    try {
      const siteId = await this.getResolvedSiteId();
      const res = await this.authenticatedFetch<OmadaTopologyNode[] | { data: OmadaTopologyNode[] }>(
        `/api/v2/sites/${encodeURIComponent(siteId)}/topology`
      );

      if (Array.isArray(res.result)) {
        return res.result;
      }
      if (res.result && Array.isArray((res.result as { data: OmadaTopologyNode[] }).data)) {
        return (res.result as { data: OmadaTopologyNode[] }).data;
      }
      return [];
    } catch {
      return [];
    }
  }

  /**
   * Fetches LAN Subnets and VLAN definitions
   */
  async getLanNetworks(): Promise<OmadaLanNetwork[]> {
    try {
      const siteId = await this.getResolvedSiteId();
      interface RawLanItem {
        id?: string;
        name?: string;
        vlan?: number;
        gatewaySubnet?: string;
        dhcpSettings?: { enable?: boolean; ipaddrStart?: string; ipaddrEnd?: string };
        domain?: string;
        purpose?: string;
      }

      const res = await this.fetchAllPages<RawLanItem>(
        (page) =>
          `/api/v2/sites/${encodeURIComponent(siteId)}/setting/lan/networks?currentPage=${page}&currentPageSize=100`,
        100
      );

      return res.result.map((n) => ({
        id: n.id || String(n.vlan),
        name: n.name || `VLAN ${n.vlan}`,
        vlan: n.vlan ?? 1,
        gatewaySubnet: n.gatewaySubnet || 'Unknown',
        dhcpEnable: Boolean(n.dhcpSettings?.enable),
        ipaddrStart: n.dhcpSettings?.ipaddrStart,
        ipaddrEnd: n.dhcpSettings?.ipaddrEnd,
        domain: n.domain,
        purpose: n.purpose,
      }));
    } catch {
      return [];
    }
  }

  /**
   * Fetches Wireless SSIDs configuration
   */
  async getSsids(): Promise<OmadaSsidSetting[]> {
    try {
      const siteId = await this.getResolvedSiteId();
      const wlansRes = await this.authenticatedFetch<{ data: Array<{ id: string; name: string }> }>(
        `/api/v2/sites/${encodeURIComponent(siteId)}/setting/wlans`
      );

      const wlanId = wlansRes.result?.data?.[0]?.id || 'Default';

      interface RawSsidItem {
        id?: string;
        index?: number;
        name?: string;
        band?: number;
        security?: number;
        broadcast?: boolean;
        vlanEnable?: boolean;
        vlanId?: number;
        vlanSetting?: { currentVlanId?: number };
      }

      const ssidsRes = await this.authenticatedFetch<RawSsidItem[] | { data: RawSsidItem[] }>(
        `/api/v2/sites/${encodeURIComponent(siteId)}/setting/wlans/${encodeURIComponent(wlanId)}/ssids`
      );

      let rawList: RawSsidItem[] = [];
      if (Array.isArray(ssidsRes.result)) {
        rawList = ssidsRes.result;
      } else if (ssidsRes.result && Array.isArray(ssidsRes.result.data)) {
        rawList = ssidsRes.result.data;
      }

      const secLabels: Record<number, string> = {
        0: 'Open (No Security)',
        1: 'WEP',
        2: 'WPA-PSK',
        3: 'WPA2-PSK / AES',
        4: 'WPA3-SAE / WPA2',
        5: 'Enterprise (802.1X)',
      };

      return rawList.map((s) => ({
        id: s.id || String(s.index || s.name || 'ssid'),
        name: s.name || 'Unnamed SSID',
        band: s.band ?? 3,
        // band is a bitmask: 1 = 2.4G, 2 = 5G, 4 = 6G
        bandText: (s.band !== undefined && SSID_BAND_LABELS[s.band]) || 'Dual-Band',
        security: s.security ?? 3,
        securityText: (s.security !== undefined && secLabels[s.security]) || 'WPA2-PSK',
        broadcast: s.broadcast !== false,
        vlanEnable: Boolean(s.vlanEnable),
        vlanId: s.vlanId || (s.vlanSetting?.currentVlanId ?? undefined),
      }));
    } catch {
      return [];
    }
  }

  /**
   * Fetches PoE switch power consumption & headroom. Only switches that actually report
   * their remaining PoE budget are listed (an unknown budget is not shown as fully used).
   */
  async getPoeBudgets(): Promise<PoeDeviceBudget[]> {
    try {
      const devices = await this.getDevices('switch');
      return devices
        .filter((d): d is OmadaDeviceItem & { poeRemain: number } => typeof d.poeRemain === 'number')
        .map((d) => {
          const poeRemain = d.poeRemain;
          const totalPower = d.model?.includes('2218') ? 150 : d.model?.includes('205') ? 65 : 120;
          const powerUsed = Math.max(0, +(totalPower - poeRemain).toFixed(1));
          return {
            mac: d.mac,
            name: d.name,
            model: d.model,
            ip: d.ip,
            poeRemain,
            totalPoePower: totalPower,
            poePowerUsed: powerUsed,
            clientNum: d.clientNum ?? 0,
            cpuUtil: d.cpuUtil ?? 0,
            memUtil: d.memUtil ?? 0,
            uptime: d.uptime ?? 0,
            status: d.status ?? 0,
            statusCategory: d.statusCategory,
          };
        });
    } catch {
      return [];
    }
  }

  /**
   * Deep dive lookup for a single client by IP, MAC, or Hostname
   */
  async getClientDetail(query: string): Promise<OmadaClientDevice | null> {
    const clients = await this.getActiveClients();
    const cleanQuery = query.trim().toLowerCase();

    return (
      clients.find(
        (c) =>
          c.mac?.toLowerCase() === cleanQuery ||
          c.mac?.toLowerCase().replace(/[:-]/g, '') === cleanQuery.replace(/[:-]/g, '') ||
          c.ip?.toLowerCase() === cleanQuery ||
          c.name?.toLowerCase() === cleanQuery ||
          c.hostName?.toLowerCase() === cleanQuery
      ) || null
    );
  }

  /**
   * Computes comprehensive Wi-Fi health insights across APs and wireless clients
   */
  async getWirelessHealth(): Promise<WirelessHealthSummary> {
    const [clients, devices] = await Promise.all([this.getActiveClients(), this.getDevices('ap')]);

    const wirelessClients = clients.filter((c) => c.wireless);
    const weakSignalClients = wirelessClients
      .filter((c) => (c.rssi !== undefined && c.rssi < -70) || (c.signalLevel !== undefined && c.signalLevel < 50))
      .map((c) => ({
        name: c.name || c.hostName || 'Unnamed Device',
        ip: c.ip || 'N/A',
        mac: c.mac,
        rssi: c.rssi,
        ssid: c.ssid,
        apName: c.apName,
        wifiMode: c.wifiMode,
      }));

    const criticalSignalCount = wirelessClients.filter(
      (c) => (c.rssi !== undefined && c.rssi < -80) || (c.signalLevel !== undefined && c.signalLevel < 25)
    ).length;

    const apLoadDistribution = devices.map((ap) => ({
      apName: ap.name,
      clientCount: ap.clientNum || 0,
      model: ap.model,
      cpuUtil: ap.cpuUtil,
      memUtil: ap.memUtil,
    }));

    return {
      totalWirelessClients: wirelessClients.length,
      weakSignalCount: weakSignalClients.length,
      criticalSignalCount,
      weakSignalClients,
      apLoadDistribution,
    };
  }

  /**
   * Generates a holistic network health audit with actionable optimization recommendations
   */
  async getNetworkHealthAudit(): Promise<NetworkAuditReport> {
    const emptyWirelessHealth: WirelessHealthSummary = {
      totalWirelessClients: 0,
      weakSignalCount: 0,
      criticalSignalCount: 0,
      weakSignalClients: [],
      apLoadDistribution: [],
    };

    // Sub-queries must not reject: an unreachable controller should yield the offline alert, not a raw fetch error
    const [status, devicesResult, wirelessHealth] = await Promise.all([
      this.getNetworkStatus(),
      this.getDevices().catch(() => null),
      this.getWirelessHealth().catch(() => emptyWirelessHealth),
    ]);
    const devices: OmadaDeviceItem[] = devicesResult ?? [];

    const alerts: string[] = [];
    const warnings: string[] = [];
    const recommendations: string[] = [];

    let healthScore = 100;

    // 1. Controller & Infrastructure Health
    if (!status.controllerOnline) {
      alerts.push('Omada Controller is offline or unreachable.');
      healthScore -= 50;
    } else if (devicesResult === null) {
      warnings.push('Infrastructure device inventory could not be retrieved; hardware health was not evaluated.');
    }

    const offlineDevices = devices.filter((d) => !isDeviceOnline(d));
    if (offlineDevices.length > 0) {
      alerts.push(`${offlineDevices.length} infrastructure device(s) are isolated or offline: ${offlineDevices.map((d) => d.name).join(', ')}`);
      healthScore -= offlineDevices.length * 10;
    }

    // 2. High CPU / Resource Constraints
    const highCpuDevices = devices.filter((d) => (d.cpuUtil || 0) > 80);
    if (highCpuDevices.length > 0) {
      warnings.push(`High CPU load detected on: ${highCpuDevices.map((d) => `${d.name} (${d.cpuUtil}%)`).join(', ')}`);
      healthScore -= 10;
    }

    // 3. AP Load Distribution & Imbalance
    const activeAps = devices.filter((d) => d.type === 'ap');
    if (activeAps.length > 1) {
      const maxAp = activeAps.reduce((prev, curr) => ((curr.clientNum || 0) > (prev.clientNum || 0) ? curr : prev), activeAps[0]);
      if ((maxAp.clientNum || 0) > 25 && status.wirelessClients > 0) {
        const ratio = Math.round(((maxAp.clientNum || 0) / status.wirelessClients) * 100);
        if (ratio > 50) {
          warnings.push(`AP Load Imbalance: "${maxAp.name}" handles ${maxAp.clientNum} of ${status.wirelessClients} wireless clients (${ratio}% of all Wi-Fi traffic).`);
          recommendations.push(`Enable 802.11k/v Fast Roaming and consider adjusting Minimum RSSI threshold on "${maxAp.name}" to balance load to adjacent APs.`);
          healthScore -= 10;
        }
      }
    }

    // 4. Wi-Fi RF Signal Quality
    if (wirelessHealth.criticalSignalCount > 0) {
      warnings.push(`${wirelessHealth.criticalSignalCount} client(s) have critical Wi-Fi signal (< -80 dBm), causing airtime hogging and packet retransmissions.`);
      healthScore -= 10;
    }

    if (wirelessHealth.weakSignalCount > 0 && recommendations.length === 0) {
      recommendations.push(`Review AP placement or increase transmit power for APs serving weak clients: ${wirelessHealth.weakSignalClients.slice(0, 3).map((c) => c.name).join(', ')}.`);
    }

    if (recommendations.length === 0) {
      recommendations.push('Network topology is balanced and operating within optimal performance thresholds.');
    }

    return {
      timestamp: new Date().toISOString(),
      healthScore: Math.max(0, healthScore),
      controllerStatus: status.controllerOnline ? 'Online ✅' : 'Offline ❌',
      totalDevices: devices.length,
      totalClients: status.totalClients,
      alerts,
      warnings,
      recommendations,
    };
  }

  /**
   * Computes a structured network telemetry status summary
   */
  async getNetworkStatus(): Promise<NetworkStatusSummary> {
    try {
      await this.login();
      const siteId = await this.getResolvedSiteId();
      const clients = await this.getActiveClients();

      const wirelessClients = clients.filter((c) => c.wireless).length;
      const wiredClients = clients.filter((c) => !c.wireless).length;

      const totalActivityRate = clients.reduce((sum, c) => sum + (c.activity || 0), 0);
      const totalTrafficDown = clients.reduce((sum, c) => sum + (c.trafficDown || 0), 0);
      const totalTrafficUp = clients.reduce((sum, c) => sum + (c.trafficUp || 0), 0);

      return {
        controllerOnline: true,
        omadacId: this.omadacId,
        siteId,
        siteName: this.resolvedSiteName,
        totalClients: clients.length,
        wirelessClients,
        wiredClients,
        totalActivityRate,
        totalTrafficDown,
        totalTrafficUp,
        lastUpdated: new Date().toISOString(),
        error: null,
      };
    } catch (error: unknown) {
      let errMessage = error instanceof Error ? error.message : 'Unknown connection error';
      if (errMessage.includes('Unexpected token') || errMessage.includes('<!DOCTYPE') || errMessage.includes('returned HTML')) {
        errMessage = `Controller at ${this.baseUrl} returned HTML instead of API data. Verify controller address and port.`;
      }
      return {
        controllerOnline: false,
        omadacId: this.omadacId,
        siteId: this.siteNameOrId,
        siteName: this.resolvedSiteName,
        totalClients: 0,
        wirelessClients: 0,
        wiredClients: 0,
        totalActivityRate: 0,
        totalTrafficDown: 0,
        totalTrafficUp: 0,
        lastUpdated: new Date().toISOString(),
        error: errMessage,
      };
    }
  }

  /**
   * Retrieves top clients sorted by real-time activity (bytes/sec) or total traffic
   */
  async getTopClients(limit = 10, sortBy: 'activity' | 'traffic' | 'uptime' = 'activity'): Promise<OmadaClientDevice[]> {
    const clients = await this.getActiveClients();

    const sorted = [...clients].sort((a, b) => {
      if (sortBy === 'traffic') {
        const aTraffic = (a.trafficDown || 0) + (a.trafficUp || 0);
        const bTraffic = (b.trafficDown || 0) + (b.trafficUp || 0);
        return bTraffic - aTraffic;
      }
      if (sortBy === 'uptime') {
        return (b.uptime || 0) - (a.uptime || 0);
      }
      return (b.activity || 0) - (a.activity || 0);
    });

    return sorted.slice(0, limit);
  }

  /**
   * Reads the WAN ports from the gateway detail (`portStats`); [] when unavailable.
   */
  private async getGatewayWanPorts(siteId: string, gatewayMac: string): Promise<RawGatewayPort[]> {
    try {
      const res = await this.authenticatedFetch<{ portStats?: RawGatewayPort[] }>(
        `/api/v2/sites/${encodeURIComponent(siteId)}/gateways/${encodeURIComponent(gatewayMac)}`
      );
      const ports = res.errorCode === 0 && Array.isArray(res.result?.portStats) ? res.result.portStats : [];
      // mode (WAN/LAN combo ports) or type: 0 = WAN
      return ports.filter((p) => (typeof p.mode === 'number' ? p.mode : p.type) === 0);
    } catch {
      return [];
    }
  }

  /**
   * Fetches WAN uplink status and Internet telemetry. Fields the controller does not
   * report are left undefined / 'Unknown' rather than guessed.
   */
  async getWanStatus(): Promise<WanStatusInfo | undefined> {
    try {
      const [devices, clients] = await Promise.all([
        this.getDevices('gateway'),
        this.getActiveClients().catch(() => [] as OmadaClientDevice[]),
      ]);
      const gw = devices[0];
      if (!gw) {
        return undefined;
      }

      const siteId = await this.getResolvedSiteId();
      const wanPorts = await this.getGatewayWanPorts(siteId, gw.mac);

      // Site-wide client throughput (bytes/s) as the uplink rate estimate
      const totalRxRate = clients.reduce((sum, c) => sum + (c.activity ?? 0), 0);
      const totalTxRate = clients.reduce((sum, c) => sum + (c.uploadActivity ?? 0), 0);

      const toWanPort = (p: RawGatewayPort | undefined, index: number): WanPortInfo => {
        let online: boolean;
        if (typeof p?.internetState === 'number') {
          online = p.internetState === 1;
        } else if (typeof p?.status === 'number') {
          online = p.status === 1;
        } else {
          // No WAN port telemetry: best available signal is the gateway's own connection state
          online = isDeviceOnline(gw);
        }

        return {
          port: p?.port ?? index + 1,
          name: p?.name || `WAN ${index + 1}`,
          type: 'wan',
          online,
          ip: p?.ip || 'Unknown',
          gateway: p?.gateway || 'Unknown',
          dns: [p?.dns1, p?.dns2].filter((d): d is string => typeof d === 'string' && d.length > 0),
          proto: WAN_PROTO_LABELS[(p?.proto || '').toLowerCase()] ?? 'Unknown',
          latencyMs: typeof p?.latency === 'number' ? p.latency : undefined,
          packetLossPercent: typeof p?.loss === 'number' ? p.loss : undefined,
          rxRate: index === 0 ? totalRxRate : 0,
          txRate: index === 0 ? totalTxRate : 0,
          uptime: typeof p?.uptime === 'number' ? p.uptime : gw.uptime || 0,
          isPrimary: index === 0,
        };
      };

      return {
        gatewayModel: gw.model || 'Omada SDN Gateway',
        primaryWan: toWanPort(wanPorts[0], 0),
        backupWan: wanPorts.length > 1 ? toWanPort(wanPorts[1], 1) : undefined,
        dualWanMode: 'Failover',
      };
    } catch {
      return undefined;
    }
  }

  /**
   * Fetches recent real-time NOC event logs (roaming, DHCP, security alerts)
   */
  async getNocEvents(): Promise<NocEventItem[]> {
    try {
      const siteId = await this.getResolvedSiteId();
      interface RawEventItem {
        id?: string;
        time?: number | string;
        type?: 'roam' | 'dhcp' | 'alert' | 'poe' | 'system';
        level?: number;
        content?: string;
        extra?: string;
      }
      const res = await this.authenticatedFetch<{ data: RawEventItem[] }>(
        `/api/v2/sites/${encodeURIComponent(siteId)}/events?currentPage=1&currentPageSize=20`
      );
      if (res.result && Array.isArray(res.result.data)) {
        return res.result.data.map((e, idx) => ({
          id: e.id || `evt-${idx}`,
          timestamp: e.time ? new Date(e.time).toISOString() : new Date().toISOString(),
          type: e.type || 'system',
          severity: e.level === 3 ? 'critical' : e.level === 2 ? 'warning' : 'info',
          title: e.content || 'Network Event',
          detail: e.extra || e.content || '',
        }));
      }
      return [];
    } catch {
      return [];
    }
  }
}

// Global cached client instance for server-side Next.js route handlers & MCP tools
let globalOmadaClient: OmadaClient | null = null;

export function getOmadaClient(): OmadaClient {
  if (!globalOmadaClient) {
    globalOmadaClient = new OmadaClient();
  }
  return globalOmadaClient;
}
