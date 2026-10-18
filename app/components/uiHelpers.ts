import { useSyncExternalStore } from 'react';
import { isDeviceOnline } from '@/lib/omada/formatters';

/** Placeholder rendered wherever the controller did not report a value. */
export const MISSING_VALUE = '—';

export type DeviceStatus = 'online' | 'offline' | 'unknown';

/**
 * Classify an Omada device/topology node. Nodes that carry neither `status` nor
 * `statusCategory` are "unknown" rather than silently treated as online or offline.
 */
export function getDeviceStatus(device: { status?: number; statusCategory?: number } | null | undefined): DeviceStatus {
  if (!device || (typeof device.status !== 'number' && typeof device.statusCategory !== 'number')) {
    return 'unknown';
  }
  return isDeviceOnline(device) ? 'online' : 'offline';
}

/**
 * Format a PHY link rate reported by Omada in Kbps (e.g. 866700 -> "866.7 Mbps", 2402000 -> "2.4 Gbps").
 */
export function formatLinkRateKbps(kbps: number | undefined | null): string {
  if (typeof kbps !== 'number' || !Number.isFinite(kbps) || kbps <= 0) return MISSING_VALUE;
  const mbps = kbps / 1000;
  if (mbps >= 1000) return `${parseFloat((mbps / 1000).toFixed(2))} Gbps`;
  if (mbps >= 1) return `${parseFloat(mbps.toFixed(1))} Mbps`;
  return `${parseFloat(kbps.toFixed(0))} Kbps`;
}

/**
 * Legacy copy path for insecure contexts (plain-HTTP LAN access), where
 * `navigator.clipboard` is undefined.
 */
function copyViaTextarea(text: string): boolean {
  if (typeof document === 'undefined' || typeof document.execCommand !== 'function' || !document.body) {
    return false;
  }
  const previousFocus = document.activeElement as HTMLElement | null;
  const textarea = document.createElement('textarea');
  textarea.value = text;
  textarea.setAttribute('readonly', '');
  textarea.setAttribute('aria-hidden', 'true');
  textarea.style.position = 'fixed';
  textarea.style.top = '0';
  textarea.style.left = '0';
  textarea.style.opacity = '0';
  textarea.style.pointerEvents = 'none';
  document.body.appendChild(textarea);
  try {
    textarea.focus();
    textarea.select();
    return document.execCommand('copy');
  } catch {
    return false;
  } finally {
    document.body.removeChild(textarea);
    previousFocus?.focus?.();
  }
}

/**
 * Copy text to the clipboard. Uses the async Clipboard API when available (HTTPS/localhost)
 * and falls back to a hidden textarea + execCommand('copy'). Resolves to whether it succeeded.
 */
export async function copyText(text: string): Promise<boolean> {
  try {
    if (typeof navigator !== 'undefined' && typeof navigator.clipboard?.writeText === 'function') {
      await navigator.clipboard.writeText(text);
      return true;
    }
  } catch {
    // Permission denied or document not focused: try the legacy path below.
  }
  return copyViaTextarea(text);
}

const subscribeNoop = () => () => {};

/**
 * `false` during SSR and hydration, `true` afterwards. Lets components render
 * locale/timezone-dependent text without causing a hydration mismatch.
 */
export function useIsClient(): boolean {
  return useSyncExternalStore(
    subscribeNoop,
    () => true,
    () => false
  );
}
