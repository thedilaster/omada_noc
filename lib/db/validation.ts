import { normalizeMac } from '@/lib/omada/formatters';

const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/**
 * Returns true when the value is a canonical 8-4-4-4-12 hex UUID string.
 * Guards Postgres UUID columns, which raise 22P02 (and a 500) on malformed input.
 */
export function isUuid(value: unknown): value is string {
  return typeof value === 'string' && UUID_PATTERN.test(value);
}

/**
 * Converts any MAC notation ("aa:bb:..", "AA-BB-..", "aabb.ccdd.eeff") into the canonical
 * stored form "AA-BB-CC-DD-EE-FF" (Omada's own notation). Returns null when the input
 * does not contain exactly 12 hex digits.
 */
export function toCanonicalMac(mac: string | undefined | null): string | null {
  const hex = normalizeMac(mac);
  if (hex.length !== 12) return null;
  return hex.match(/.{2}/g)!.join('-');
}

/**
 * Parses an integer query parameter, falling back to `fallback` for missing or
 * non-numeric input and clamping the result into [min, max].
 */
export function parseBoundedInt(
  raw: string | null | undefined,
  fallback: number,
  min: number,
  max: number
): number {
  const parsed = raw === null || raw === undefined || raw.trim() === '' ? NaN : Number(raw);
  const value = Number.isFinite(parsed) ? Math.floor(parsed) : fallback;
  return Math.min(max, Math.max(min, value));
}
